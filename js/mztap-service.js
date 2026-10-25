/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { prefs_default } from './mztap-options-default.js';
import { tapLogger } from './mztap-logger.js';
import {
    createPrivacySession,
    restorePrivacyResponse,
    isPrivacyModelDownloaded,
    downloadPrivacyModel,
    disposePrivacyModelManager,
    deletePrivacyModel
} from './mztap-privacy-filter.js';
import { PRIVACY_MODEL_ORIGINS } from './mztap-privacy-config.js';
import { maskPrivacyExtraBody } from './mztap-extra-body.js';
import { PRIVACY_PLACEHOLDER_INSTRUCTIONS } from './mztap-privacy-instructions.js';
import {
    initializePrivacyViews,
    collectPrivacyInput,
    showPrivacyResult,
    closePrivacyViews
} from './mztap-views.js';
import { pseudonymizePrivacyIdentifier } from './mztap-identifiers.js';
import {
    restorePrivacyPlaceholders,
    restoreExactPrivacyPlaceholders
} from './mztap-placeholders.js';

const MAIN_ID = 'thunderai@micz.it';
const PROTOCOL = 1;
const instanceId = crypto.randomUUID();
const sessions = new Map();
let prefs = { ...prefs_default };
let deleting = false;
let settingsQueue = Promise.resolve();
const logger = new tapLogger('processing', false);
const ready = browser.storage.local.get(prefs_default).then(value => {
    prefs = value;
    logger.changeDebug(prefs.do_debug);
});
const text = key => browser.i18n.getMessage(key) || key;
function fail(code, key) {
    const error = new Error(text(key));
    error.code = code;
    throw error;
}

export async function getPlatformSupport() {
    const { arch } = await browser.runtime.getPlatformInfo();
    return { supported: ['x86-64', 'aarch64', 'arm64'].includes(arch), arch };
}
async function assertPlatform() {
    if (!(await getPlatformSupport()).supported) {
        fail('PLATFORM_UNSUPPORTED', 'privacy_platform_unsupported');
    }
}
function status() {
    return {
        ok: true,
        protocol: PROTOCOL,
        instanceId,
        version: browser.runtime.getManifest().version,
        ...modelStatus()
    };
}

// Model readiness, cached here so discovery never starts a worker. Refreshed at
// startup, after a download and after a deletion; an evicted cache still blocks at
// the first mask (MODEL_NOT_READY), never bypasses.
const model = { ready: false, downloading: false, progress: null, loaded: null, total: null, error: null };
function modelStatus() {
    const { ready, downloading, progress, loaded, total, error } = model;
    return { ready, downloading, progress, loaded, total, error };
}
function announceModel() {
    const state = modelStatus();
    void browser.runtime.sendMessage({ action: 'privacyModel.changed', ...state }).catch(() => {});
    void browser.runtime.sendMessage(MAIN_ID, { action: 'aiProcessing.readinessChanged',
        protocol: PROTOCOL, instanceId, ...state }).catch(() => {});
}
async function checkModel() {
    try {
        return (await getPlatformSupport()).supported && await isPrivacyModelDownloaded();
    } finally {
        // The background keeps no idle model worker around.
        disposePrivacyModelManager();
    }
}
async function refreshModel() {
    if (model.downloading) return;
    let readyNow = false;
    try {
        readyNow = !deleting && await checkModel();
    } catch (error) {
        logger.log(`Model check failed: ${error.message}`);
    }
    if (readyNow !== model.ready) {
        model.ready = readyNow;
        announceModel();
    }
}
// Started from this add-on's settings page or from ThunderAI; it runs here, in the
// background, so it survives closing either page. Not awaited by its callers.
async function startDownload() {
    if (model.downloading) return;
    await assertPlatform();
    if (deleting) fail('MODEL_NOT_READY', 'privacy_download_required');
    if (!await browser.permissions.contains({ origins: PRIVACY_MODEL_ORIGINS })) {
        fail('PERMISSION_REQUIRED', 'privacy_permission_required');
    }
    Object.assign(model, { downloading: true, progress: 0, error: null });
    announceModel();
    void downloadPrivacyModel(event => {
        if (event.status !== 'progress_total') return;
        const percent = Math.floor(event.progress);
        if (percent === model.progress) return;
        model.progress = percent;
        model.loaded = event.loaded;
        model.total = event.total;
        announceModel();
    }).then(() => {
        model.ready = true;
    }, error => {
        logger.log(`Model download failed: ${error.message}`);
        model.error = error.code === 'privacy_download_required' ? text('privacy_download_required') :
            text('privacy_download_failed');
    }).finally(() => {
        disposePrivacyModelManager();
        Object.assign(model, { downloading: false, progress: null, loaded: null, total: null });
        announceModel();
    });
}
// Activation is ThunderAI's ai_processing_enabled preference; this add-on only
// reads and writes it. A refusal (a policy lock) keeps ThunderAI's code and message.
async function askMain(action, fields = {}) {
    let timer;
    try {
        const result = await Promise.race([
            browser.runtime.sendMessage(MAIN_ID, { action, protocol: PROTOCOL, ...fields }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(text('privacy_main_unavailable'))), 5000);
            }),
        ]).catch(() => fail('MAIN_UNAVAILABLE', 'privacy_main_unavailable'));
        if (result?.ok === false && typeof result.error?.code === 'string') {
            const error = new Error(result.error.message || text('privacy_main_unavailable'));
            error.code = result.error.code;
            throw error;
        }
        if (!result?.ok || result.protocol !== PROTOCOL ||
            typeof result.enabled !== 'boolean' || typeof result.locked !== 'boolean') {
            fail('PROTOCOL_UNSUPPORTED', 'privacy_main_unavailable');
        }
        return { enabled: result.enabled, locked: result.locked };
    } finally {
        clearTimeout(timer);
    }
}
async function mainSetting() {
    try {
        return { ...await askMain('aiProcessing.getSetting'), main_available: true };
    } catch {
        return { enabled: false, locked: false, main_available: false };
    }
}
function dispose(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) return;
    record.disposed = true;
    closePrivacyViews(record);
    record.session.dispose();
    record.context = null;
    record.calls.clear();
    sessions.delete(sessionId);
}
function check(record, message) {
    if (record.disposed || deleting) fail('SESSION_EXPIRED', 'privacy_session_expired');
    if (record.calls.get(message.callId)?.cancelled) fail('CANCELLED', 'privacy_cancelled');
}
function audit(record, message) {
    if (record.audit) logger.log(message);
}
function restoreHtml(session, value) {
    const escape = original => original.replace(/[&<>"']/g, char =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    return restorePrivacyPlaceholders(value, session.getMappings(), escape);
}
function assertContext(record, message) {
    if (typeof message.requestId !== 'string' ||
        typeof message.context?.token !== 'string' ||
        record.context?.token !== message.context.token ||
        record.context.requestId !== message.requestId) {
        fail('SESSION_EXPIRED', 'privacy_session_expired');
    }
}
async function before(record, message) {
    const input = message.input;
    if (typeof input?.message !== 'string' || typeof message.requestId !== 'string') {
        fail('INVALID_REQUEST', 'privacy_invalid_request');
    }
    const output = { message: '', instructions: {}, extraBody: {} };
    let phase = 'prompt', counter = 0;
    const mask = async value => {
        check(record, message);
        if (typeof value !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
        const phaseId = `${phase}:${++counter}`;
        const result = await record.session.mask(value, {
            onProgress: info => {
                if (record.disposed || record.calls.get(message.callId)?.cancelled) return;
                const progress = { ...info, phase: phaseId };
                audit(record, `Local filtering progress: ${JSON.stringify(progress)}`);
                void browser.runtime.sendMessage(MAIN_ID, {
                    action: 'aiProcessing.progress',
                    protocol: PROTOCOL,
                    instanceId,
                    sessionId: message.sessionId,
                    requestId: message.requestId,
                    callId: message.callId,
                    progress
                }).catch(() => {});
            }
        });
        check(record, message);
        return result.text;
    };
    audit(record, 'Local filtering started');
    output.message = PRIVACY_PLACEHOLDER_INSTRUCTIONS + await mask(input.message);
    for (const [key, value] of Object.entries(input.instructions || {})) {
        phase = `instruction:${key}`;
        if (typeof value !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
        output.instructions[key] = ['chatgpt_prompt_cache_key', 'chatgpt_safety_identifier'].includes(key) ?
            await pseudonymizePrivacyIdentifier(key, value) : await mask(value);
    }
    for (const [key, value] of Object.entries(input.extraBody || {})) {
        if (typeof value !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
        phase = `extraBody:${key}`;
        let body;
        try {
            body = JSON.parse(value);
        } catch {
            fail('INVALID_JSON', 'privacy_invalid_json');
        }
        output.extraBody[key] = JSON.stringify(await maskPrivacyExtraBody(body, { mask: async item => ({ text: await mask(item) }) },
            { maskIdentifier: pseudonymizePrivacyIdentifier }));
    }
    check(record, message);
    const token = crypto.randomUUID();
    record.context = { token, requestId: message.requestId };
    audit(record, `Prepared input: ${JSON.stringify(output)}`);
    audit(record, `Placeholder map: ${JSON.stringify(Object.fromEntries(record.session.getMappings()))}`);
    return { input: output, context: { token } };
}
async function after(record, message) {
    assertContext(record, message);
    const output = message.output;
    if (typeof output?.content !== 'string' ||
        typeof output?.thinking !== 'string' ||
        !['text', 'html', 'json'].includes(message.format)) {
        fail('INVALID_REQUEST', 'privacy_invalid_request');
    }
    audit(record, `Raw response before restoration: ${JSON.stringify(output)}`);
    const restore = message.format === 'json' ? value => restorePrivacyResponse(value, record.session) :
        message.format === 'html' ? value => restoreHtml(record.session, value) : value => record.session.restore(value);
    const restoreDisplay = value => restoreExactPrivacyPlaceholders(value, record.session.getMappings());
    const restored = {
        content: restore(output.content),
        thinking: restoreDisplay(output.thinking),
        ...(typeof output.error === 'string' ? { error: restoreDisplay(output.error) } : {})
    };
    if (message.view) await showPrivacyResult(record, message.requestId, restored.content, message.view);
    check(record, message);
    return { output: restored };
}
async function external(message) {
    await ready;
    if (message.action === 'checkPresence') return browser.runtime.getManifest().version;
    if (message.protocol !== PROTOCOL) fail('PROTOCOL_UNSUPPORTED', 'privacy_main_unavailable');
    // ThunderAI's switch changed (whoever wrote it): refresh the open settings pages.
    if (message.action === 'aiProcessing.settingChanged') {
        if (typeof message.enabled !== 'boolean' || typeof message.locked !== 'boolean') {
            fail('INVALID_REQUEST', 'privacy_invalid_request');
        }
        void browser.runtime.sendMessage({ action: 'privacyState.changed',
            enabled: message.enabled, locked: message.locked }).catch(() => {});
        return {};
    }
    // ThunderAI's options page buttons and its autodownload policy.
    if (message.action === 'aiProcessing.downloadModel') {
        await startDownload();
        return modelStatus();
    }
    if (message.action === 'aiProcessing.openSettings') {
        await browser.runtime.openOptionsPage();
        return {};
    }
    // Discovery and new sessions must not race model deletion. Existing
    // hooks/cancellation never wait for settings.
    if (['aiProcessing.hello', 'aiProcessing.createSession'].includes(message.action)) {
        await settingsQueue;
    }
    if (message.action === 'aiProcessing.hello') return status();
    if (message.instanceId !== instanceId) fail('SESSION_EXPIRED', 'privacy_session_expired');
    const operation = message.action.slice('aiProcessing.'.length);
    if (typeof message.callId !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
    if (operation === 'createSession') {
        await assertPlatform();
        // ThunderAI asks only while its switch is on. Creation stays lazy: a missing
        // model blocks the first mask rather than the session.
        if (deleting) {
            fail('MODEL_NOT_READY', 'privacy_download_required');
        }
        if (typeof message.sessionId !== 'string' || sessions.has(message.sessionId)) {
            fail('INVALID_REQUEST', 'privacy_invalid_request');
        }
        sessions.set(message.sessionId, {
            session: createPrivacySession({ shared: true }),
            context: null,
            calls: new Map(),
            queue: Promise.resolve(),
            lastUsed: Date.now(),
            disposed: false,
            audit: prefs.do_debug
        });
        return {};
    }
    const record = sessions.get(message.sessionId);
    if (!record) fail('SESSION_EXPIRED', 'privacy_session_expired');
    record.lastUsed = Date.now();
    if (operation === 'disposeSession') {
        dispose(message.sessionId);
        return {};
    }
    if (operation === 'cancel') {
        const call = record.calls.get(message.callId);
        if (!call || call.requestId !== message.requestId) return {};
        call.cancelled = true;
        if (record.context?.requestId === message.requestId) record.context = null;
        closePrivacyViews(record, message.requestId);
        if (record.activeCall === message.callId) record.session.cancel();
        return {};
    }
    if (!['before', 'after', 'collectInput'].includes(operation) ||
        typeof message.requestId !== 'string' || record.calls.has(message.callId)) {
        fail('INVALID_REQUEST', 'privacy_invalid_request');
    }
    record.calls.set(message.callId, { requestId: message.requestId, cancelled: false });
    const job = record.queue.then(async () => {
        try {
            check(record, message);
            record.activeCall = message.callId;
            record.activeRequest = message.requestId;
            // Only the latest prepared turn can be restored; mappings remain
            // conversation-wide. Failed replacement preparation retires it too.
            if (operation === 'before') record.context = null;
            if (operation === 'before') return await before(record, message);
            if (operation === 'after') return await after(record, message);
            if (operation === 'collectInput') {
                const values = await collectPrivacyInput(record, message.requestId, message.fields);
                check(record, message);
                return { values };
            }
            fail('INVALID_REQUEST', 'privacy_invalid_request');
        } finally {
            record.activeRequest = null;
            record.activeCall = null;
            record.calls.delete(message.callId);
            record.lastUsed = Date.now();
        }
    });
    record.queue = job.catch(() => {});
    return job;
}

async function settings(message) {
    await ready;
    if (message.action === 'privacy.getState') {
        return { ...prefs, ...await getPlatformSupport(), ...await mainSetting(), model: modelStatus() };
    }
    if (message.action === 'privacy.download') {
        await startDownload();
        return { model: modelStatus() };
    }
    if (message.action === 'privacy.setEnabled') {
        if (typeof message.enabled !== 'boolean') fail('INVALID_REQUEST', 'privacy_invalid_request');
        // Readiness is this add-on's to judge: ThunderAI is asked to switch on
        // only once the platform and the model can actually process. ThunderAI's
        // own switch is disabled by the same readiness (hello's `ready`).
        if (message.enabled) {
            await assertPlatform();
            await refreshModel();
            if (!model.ready) fail('MODEL_NOT_READY', 'privacy_download_required');
        }
        return await askMain('aiProcessing.setSetting', { enabled: message.enabled });
    }
    if (message.action === 'privacy.setDebug') {
        if (typeof message.enabled !== 'boolean') fail('INVALID_REQUEST', 'privacy_invalid_request');
        await browser.storage.local.set({ do_debug: message.enabled });
        prefs.do_debug = message.enabled;
        logger.changeDebug(prefs.do_debug);
        return {};
    }
    if (message.action === 'privacy.deleteModel' && message.confirmed === true) {
        if (model.downloading) fail('MODEL_BUSY', 'privacy_delete_downloading');
        // The model goes only once the protection is off: deleting it must never leave
        // ThunderAI switched on and blocked. An unreachable ThunderAI does not hold it
        // back: with the model gone, a switch left on still blocks (fail-closed).
        if ((await mainSetting()).enabled) fail('PRIVACY_ACTIVE', 'privacy_delete_disable_first');
        deleting = true;
        model.ready = false;
        announceModel();
        try {
            for (const id of sessions.keys()) dispose(id);
            await deletePrivacyModel();
        } finally {
            deleting = false;
            await refreshModel();
        }
        return { model: modelStatus() };
    }
    fail('INVALID_REQUEST', 'privacy_invalid_request');
}
function enqueueSettings(message) {
    const job = settingsQueue.then(() => settings(message));
    settingsQueue = job.catch(() => {});
    return job;
}
function errorResponse(error) {
    logger.log(`Processing failed: ${error.message}`);
    let code = error.code;
    let message = error.message;
    if (code === 'privacy_download_required') {
        code = 'MODEL_NOT_READY';
        message = text('privacy_download_required');
    } else if (code === 'privacy_cancelled') {
        code = 'CANCELLED';
        message = text('privacy_cancelled');
    } else if (code === 'TEXT_UNSUPPORTED') {
        message = text('privacy_text_unsupported');
    } else if (code === 'UNRESTORED_PLACEHOLDER') {
        message = text('privacy_unrestored_placeholder');
    } else if (!code) {
        code = 'INFERENCE_FAILED';
        message = /out of memory|bad_alloc|memory allocation failed/i.test(error.message) ? text('privacy_memory_error') : text('privacy_inference_error');
    }
    return { ok: false, error: { code, message } };
}
export function initializePrivacyService() {
    initializePrivacyViews();
    browser.runtime.onMessageExternal.addListener((message, sender) => {
        if (sender.id !== MAIN_ID) {
            return Promise.resolve({ ok: false, error: { code: 'INVALID_SENDER' } });
        }
        if (!message || typeof message.action !== 'string') {
            return Promise.resolve({ ok: false });
        }
        return external(message).then(result => typeof result === 'string' ? result : ({
            ok: true,
            protocol: PROTOCOL,
            instanceId,
            callId: message.callId,
            ...result
        }), errorResponse);
    });
    browser.runtime.onMessage.addListener((message, sender) => {
        if (!message?.action?.startsWith('privacy.')) return;
        if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(''))) {
            return Promise.resolve({ ok: false });
        }
        return enqueueSettings(message).then(result => ({ ok: true, ...result }), errorResponse);
    });
    // Discovery waits for the first readiness check. The announcement also tells a
    // running ThunderAI that this instance started (its autodownload policy).
    settingsQueue = ready.then(async () => {
        model.ready = await checkModel().catch(() => false);
        announceModel();
    }).catch(() => {});
    setInterval(() => {
        for (const [id, record] of sessions) {
            if (!record.activeRequest && Date.now() - record.lastUsed > 86400000) dispose(id);
        }
    }, 60000);
}
