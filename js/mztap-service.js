/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { prefs_default } from './mztap-options-default.js';
import { tapLogger } from './mztap-logger.js';
import { createPrivacySession, restorePrivacyResponse, isPrivacyModelDownloaded, deletePrivacyModel } from './mztap-privacy-filter.js';
import { maskPrivacyExtraBody } from './mztap-extra-body.js';
import { PRIVACY_PLACEHOLDER_INSTRUCTIONS } from './mztap-privacy-instructions.js';
import { initializePrivacyViews, collectPrivacyInput, showPrivacyResult, closePrivacyViews } from './mztap-views.js';

const MAIN_ID = 'thunderai@micz.it';
const PROTOCOL = 1;
const instanceId = crypto.randomUUID();
const sessions = new Map();
let prefs = { ...prefs_default };
let deleting = false;
const logger = new tapLogger('processing', false);
const ready = browser.storage.local.get(prefs_default).then(value => { prefs = value; logger.changeDebug(prefs.do_debug); });
const text = key => browser.i18n.getMessage(key) || key;
function fail(code, key) { const error = new Error(text(key)); error.code = code; throw error; }

export async function getPlatformSupport() {
    const { arch } = await browser.runtime.getPlatformInfo();
    return { supported: ['x86-64', 'aarch64', 'arm64'].includes(arch), arch };
}
async function assertPlatform() {
    if (!(await getPlatformSupport()).supported) fail('PLATFORM_UNSUPPORTED', 'privacy_platform_unsupported');
}
function status() {
    return { ok: true, protocol: PROTOCOL, instanceId, enabled: prefs.privacy_filter_enabled,
        version: browser.runtime.getManifest().version };
}
async function announce() {
    let timer;
    try {
        const result = await Promise.race([
            browser.runtime.sendMessage(MAIN_ID, { action: 'aiProcessing.register', ...status() }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(text('privacy_main_unavailable'))), 5000); }),
        ]);
        if (!result?.ok || result.protocol !== PROTOCOL) fail('PROTOCOL_UNSUPPORTED', 'privacy_main_unavailable');
    } finally { clearTimeout(timer); }
}
function dispose(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) return;
    record.disposed = true;
    closePrivacyViews(record);
    record.session.dispose();
    record.contexts.clear();
    sessions.delete(sessionId);
}
function check(record, requestId) {
    if (record.disposed || deleting) fail('SESSION_EXPIRED', 'privacy_session_expired');
    if (record.cancelled.has(requestId)) fail('CANCELLED', 'privacy_cancelled');
}
const audit = (record, message) => { if (record.audit) logger.log(message); };
function restoreHtml(session, value) {
    const mappings = new Map(session.getMappings());
    const escape = original => original.replace(/[&<>"']/g, char =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    return value.replace(/\[PII_[0-9a-f]{8}_[A-Z0-9_]+\]/g,
        placeholder => mappings.has(placeholder) ? escape(mappings.get(placeholder)) : placeholder);
}
function assertContext(record, message) {
    if (typeof message.requestId !== 'string' || typeof message.context?.token !== 'string' ||
        record.contexts.get(message.context.token) !== message.requestId) fail('SESSION_EXPIRED', 'privacy_session_expired');
}
async function before(record, message) {
    const input = message.input;
    if (typeof input?.message !== 'string' || typeof message.requestId !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
    const output = { message: '', instructions: {}, extraBody: {} };
    let phase = 'prompt', counter = 0;
    const mask = async value => {
        check(record, message.requestId);
        if (typeof value !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
        const phaseId = `${phase}:${++counter}`;
        const result = await record.session.mask(value, { onProgress: info => {
            if (record.disposed || record.cancelled.has(message.requestId)) return;
            const progress = { ...info, phase: phaseId };
            audit(record, `Local filtering progress: ${JSON.stringify(progress)}`);
            void browser.runtime.sendMessage(MAIN_ID, { action: 'aiProcessing.progress', protocol: PROTOCOL,
                instanceId, sessionId: message.sessionId, requestId: message.requestId, callId: message.callId, progress }).catch(() => {});
        } });
        check(record, message.requestId);
        return result.text;
    };
    audit(record, 'Local filtering started');
    output.message = PRIVACY_PLACEHOLDER_INSTRUCTIONS + await mask(input.message);
    for (const [key, value] of Object.entries(input.instructions || {})) {
        phase = `instruction:${key}`;
        output.instructions[key] = await mask(value);
    }
    for (const [key, value] of Object.entries(input.extraBody || {})) {
        if (typeof value !== 'string') fail('INVALID_REQUEST', 'privacy_invalid_request');
        phase = `extraBody:${key}`;
        let body;
        try { body = JSON.parse(value); } catch { output.extraBody[key] = value; continue; }
        output.extraBody[key] = JSON.stringify(await maskPrivacyExtraBody(body, { mask: async item => ({ text: await mask(item) }) }));
    }
    check(record, message.requestId);
    const token = crypto.randomUUID();
    record.contexts.set(token, message.requestId);
    audit(record, `Prepared input: ${JSON.stringify(output)}`);
    audit(record, `Placeholder map: ${JSON.stringify(Object.fromEntries(record.session.getMappings()))}`);
    return { input: output, context: { token } };
}
async function after(record, message) {
    assertContext(record, message);
    const output = message.output;
    if (typeof output?.content !== 'string' || typeof output?.thinking !== 'string' ||
        !['text', 'html', 'json'].includes(message.format)) fail('INVALID_REQUEST', 'privacy_invalid_request');
    audit(record, `Raw response before restoration: ${JSON.stringify(output)}`);
    const restore = message.format === 'json' ? value => restorePrivacyResponse(value, record.session) :
        message.format === 'html' ? value => restoreHtml(record.session, value) : value => record.session.restore(value);
    const restored = { content: restore(output.content), thinking: record.session.restore(output.thinking),
        ...(typeof output.error === 'string' ? { error: record.session.restore(output.error) } : {}) };
    if (message.view) await showPrivacyResult(record, message.requestId, restored.content, message.view);
    return { output: restored };
}
async function external(message) {
    await ready;
    if (message.action === 'checkPresence') return browser.runtime.getManifest().version;
    if (message.protocol !== PROTOCOL) fail('PROTOCOL_UNSUPPORTED', 'privacy_main_unavailable');
    if (message.action === 'aiProcessing.hello') return status();
    if (message.instanceId !== instanceId) fail('SESSION_EXPIRED', 'privacy_session_expired');
    const operation = message.action.slice('aiProcessing.'.length);
    if (operation === 'createSession') {
        await assertPlatform();
        if (!prefs.privacy_filter_enabled || deleting) fail('MODEL_NOT_READY', 'privacy_download_required');
        if (typeof message.sessionId !== 'string' || sessions.has(message.sessionId)) fail('INVALID_REQUEST', 'privacy_invalid_request');
        sessions.set(message.sessionId, { session: createPrivacySession({ shared: true }), contexts: new Map(),
            cancelled: new Set(), queue: Promise.resolve(), lastUsed: Date.now(), disposed: false, audit: prefs.do_debug });
        return {};
    }
    const record = sessions.get(message.sessionId);
    if (!record) fail('SESSION_EXPIRED', 'privacy_session_expired');
    record.lastUsed = Date.now();
    if (operation === 'disposeSession') { dispose(message.sessionId); return {}; }
    if (operation === 'cancel') {
        record.cancelled.add(message.requestId);
        closePrivacyViews(record, message.requestId);
        if (record.activeRequest === message.requestId) record.session.cancel();
        return {};
    }
    const job = record.queue.then(async () => {
        check(record, message.requestId);
        record.activeRequest = message.requestId;
        try {
            if (operation === 'before') return await before(record, message);
            if (operation === 'after') return await after(record, message);
            if (operation === 'collectInput') {
                const values = await collectPrivacyInput(record, message.requestId, message.fields);
                check(record, message.requestId);
                return { values };
            }
            fail('INVALID_REQUEST', 'privacy_invalid_request');
        } finally { record.activeRequest = null; }
    });
    record.queue = job.catch(() => {});
    return job;
}

async function settings(message) {
    await ready;
    if (message.action === 'privacy.getState') return { ...prefs, ...await getPlatformSupport() };
    if (message.action === 'privacy.setEnabled') {
        if (typeof message.enabled !== 'boolean') fail('INVALID_REQUEST', 'privacy_invalid_request');
        if (message.enabled) {
            await assertPlatform();
            if (!await isPrivacyModelDownloaded()) fail('MODEL_NOT_READY', 'privacy_download_required');
        }
        const previous = prefs.privacy_filter_enabled;
        prefs.privacy_filter_enabled = message.enabled;
        await browser.storage.local.set({ privacy_filter_enabled: message.enabled });
        try { await announce(); }
        catch (error) {
            if (message.enabled) {
                prefs.privacy_filter_enabled = previous;
                await browser.storage.local.set({ privacy_filter_enabled: previous });
                throw error;
            }
        }
        return {};
    }
    if (message.action === 'privacy.setDebug') {
        if (typeof message.enabled !== 'boolean') fail('INVALID_REQUEST', 'privacy_invalid_request');
        prefs.do_debug = message.enabled;
        logger.changeDebug(prefs.do_debug);
        await browser.storage.local.set({ do_debug: prefs.do_debug });
        await announce().catch(() => {});
        return {};
    }
    if (message.action === 'privacy.deleteModel' && message.confirmed === true) {
        deleting = true;
        try {
            for (const id of sessions.keys()) dispose(id);
            await deletePrivacyModel();
        } finally { deleting = false; }
        return {};
    }
    fail('INVALID_REQUEST', 'privacy_invalid_request');
}
function errorResponse(error) {
    logger.log(`Processing failed: ${error.message}`);
    let code = error.code;
    let message = error.message;
    if (code === 'privacy_download_required') { code = 'MODEL_NOT_READY'; message = text('privacy_download_required'); }
    else if (code === 'privacy_cancelled') { code = 'CANCELLED'; message = text('privacy_cancelled'); }
    else if (!code) {
        code = 'INFERENCE_FAILED';
        message = /out of memory|bad_alloc|memory allocation failed/i.test(error.message) ? text('privacy_memory_error') : text('privacy_inference_error');
    }
    return { ok: false, error: { code, message } };
}
export function initializePrivacyService() {
    initializePrivacyViews();
    browser.runtime.onMessageExternal.addListener((message, sender) => {
        if (sender.id !== MAIN_ID) return Promise.resolve({ ok: false, error: { code: 'INVALID_SENDER' } });
        if (!message || typeof message.action !== 'string') return Promise.resolve({ ok: false });
        return external(message).then(result => typeof result === 'string' ? result :
            ({ ok: true, protocol: PROTOCOL, instanceId, callId: message.callId, ...result }), errorResponse);
    });
    browser.runtime.onMessage.addListener((message, sender) => {
        if (!message?.action?.startsWith('privacy.')) return;
        if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(''))) return Promise.resolve({ ok: false });
        return settings(message).then(result => ({ ok: true, ...result }), errorResponse);
    });
    void ready.then(() => announce()).catch(() => {});
    setInterval(() => {
        for (const [id, record] of sessions) if (!record.activeRequest && Date.now() - record.lastUsed > 86400000) dispose(id);
    }, 60000);
}
