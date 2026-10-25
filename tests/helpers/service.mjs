/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// Actual service/views in an isolated extension environment. Only inference and
// model management are mocked; no detector tests or model downloads live here.
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { restorePrivacyResponse } from '../../js/mztap-privacy-filter.js';
import { restorePrivacyPlaceholders } from '../../js/mztap-placeholders.js';

export const MAIN_ID = 'thunderai@micz.it';
export const PRIVACY_ID = 'thunderai-privacy@micz.it';
export const TOKEN = '[PII_12345678_NAME_1]';
export const turn = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export async function until(predicate) {
    for (let count = 0; count < 100; ++count) {
        if (predicate()) return;
        await turn();
    }
    throw new Error('Service did not settle');
}

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function dispatch(event, message, sender) {
    for (const listener of event.listeners) {
        const result = listener(message, sender);
        if (result !== undefined) return result;
    }
}

// `enabled` is ThunderAI's "Use ThunderAI Privacy" switch (`main`), which the
// service reads and writes through getSetting / setSetting.
export async function serviceHarness({ enabled = true } = {}) {
    const local = { do_debug: false };
    const main = { enabled, locked: false, available: true };
    // `download`: (progress_callback) => promise, to drive a background download.
    const controls = { downloaded: true, permission: true };
    const settingRequests = [], relayed = [], readiness = [], openedSettings = [],
        engines = [], windows = [], removed = [], progress = [];
    const extensionURL = 'moz-extension://privacy/';
    const browser = {
        i18n: { getMessage: key => key },
        storage: { local: {
            async get(keys) {
                if (typeof keys === 'string') return { [keys]: local[keys] };
                return { ...keys, ...local };
            },
            async set(values) {
                await controls.write?.(values);
                Object.assign(local, values);
            }
        } },
        runtime: {
            id: PRIVACY_ID,
            getURL: path => extensionURL + path,
            getManifest: () => ({ version: '1.0.0' }),
            getPlatformInfo: async () => ({ arch: 'x86-64' }),
            onMessage: event(), onMessageExternal: event(),
            async openOptionsPage() { openedSettings.push(true); },
            async sendMessage(target, message) {
                // The one-argument form reaches this add-on's own pages.
                if (typeof target === 'object') {
                    relayed.push(target);
                    return undefined;
                }
                if (target !== MAIN_ID) throw new Error('Unexpected recipient');
                if (message.action === 'aiProcessing.getSetting' || message.action === 'aiProcessing.setSetting') {
                    settingRequests.push(message);
                    if (!main.available) throw new Error('Could not establish connection. Receiving end does not exist.');
                    if (controls.setting) return controls.setting(message);
                    if (message.action === 'aiProcessing.setSetting') {
                        if (main.locked) return { ok: false, error: { code: 'ai_processing_setting_locked', message: 'Locked by policy' } };
                        main.enabled = message.enabled;
                    }
                    return { ok: true, protocol: 1, enabled: main.enabled, locked: main.locked };
                }
                if (message.action === 'aiProcessing.readinessChanged') {
                    readiness.push(message);
                    return { ok: true };
                }
                if (message.action === 'aiProcessing.progress') {
                    progress.push(message);
                    return { ok: true };
                }
                throw new Error('Unexpected outgoing action');
            }
        },
        permissions: { contains: async () => controls.permission },
        windows: {
            onRemoved: event(),
            async create(options) {
                const win = { id: windows.length + 1, ...options };
                windows.push(win);
                await controls.openWindow?.();
                return win;
            },
            async remove(id) { removed.push(id); }
        }
    };
    const context = vm.createContext({ browser, crypto: webcrypto, TextEncoder,
        console, URL, setTimeout, clearTimeout, setInterval: () => 0 });
    const mockFilter = new vm.SyntheticModule([
        'createPrivacySession', 'restorePrivacyResponse', 'isPrivacyModelDownloaded', 'deletePrivacyModel',
        'downloadPrivacyModel', 'disposePrivacyModelManager'
    ], function () {
        this.setExport('createPrivacySession', () => {
            const engine = {
                disposed: false, cancellations: 0,
                async mask(text, options) {
                    if (controls.mask) return controls.mask(text, options);
                    if (!controls.downloaded) {
                        const error = new Error('Missing model');
                        error.code = 'privacy_download_required';
                        throw error;
                    }
                    options.onProgress?.({ current: 1, total: 1 });
                    return { text: text.replaceAll('Alice', TOKEN) };
                },
                restore: text => restorePrivacyPlaceholders(text, [[TOKEN, 'Alice']]),
                getMappings: () => [[TOKEN, 'Alice']],
                cancel() { ++engine.cancellations; },
                dispose() { engine.disposed = true; }
            };
            engines.push(engine);
            return engine;
        });
        this.setExport('restorePrivacyResponse', restorePrivacyResponse);
        this.setExport('isPrivacyModelDownloaded', async () => controls.downloaded);
        this.setExport('downloadPrivacyModel', async progressCallback => {
            if (controls.download) await controls.download(progressCallback);
            controls.downloaded = true;
        });
        this.setExport('disposePrivacyModelManager', () => {});
        this.setExport('deletePrivacyModel', async () => {
            await controls.deleteModel?.();
            controls.downloaded = false;
        });
    }, { context });
    await mockFilter.link(() => {});
    const modules = new Map();
    async function load(url) {
        if (url.pathname.endsWith('/mztap-privacy-filter.js')) return mockFilter;
        if (modules.has(url.href)) return modules.get(url.href);
        let source = await readFile(url, 'utf8');
        if (url.pathname.endsWith('/mztap-service.js')) {
            // Test-only observation of retention counts, not a production API.
            source += '\nexport const retentionCounts = () => [...sessions.values()].map(record => ({ contexts: record.context ? 1 : 0, pending: record.calls.size }));';
        }
        const module = new vm.SourceTextModule(source, { context, identifier: url.href });
        modules.set(url.href, module);
        await module.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
        return module;
    }
    const module = await load(new URL('../../js/mztap-service.js', import.meta.url));
    await module.evaluate();
    module.namespace.initializePrivacyService();
    const settings = message => dispatch(browser.runtime.onMessage, message,
        { id: PRIVACY_ID, url: extensionURL + 'options/mztap-options.html' });
    // Wait for startup before changing controls for a test.
    await settings({ action: 'privacy.getState' });
    settingRequests.length = 0;
    const hello = await external({ action: 'aiProcessing.hello', protocol: 1 });
    function external(message, sender = { id: MAIN_ID }) {
        return dispatch(browser.runtime.onMessageExternal, message, sender);
    }
    function call(operation, fields = {}) {
        return external({ action: `aiProcessing.${operation}`, protocol: 1,
            instanceId: hello.instanceId, sessionId: 'session', callId: webcrypto.randomUUID(), ...fields });
    }
    async function create(sessionId = 'session') {
        const result = await call('createSession', { sessionId });
        if (!result.ok) throw new Error(JSON.stringify(result));
    }
    const before = (fields = {}) => call('before', {
        requestId: webcrypto.randomUUID(), input: { message: 'Alice', instructions: {}, extraBody: {} }, ...fields
    });
    return { browser, local, main, controls, settingRequests, relayed, readiness, openedSettings, engines, windows, removed, progress,
        settings, external, call, create, before,
        counts: () => JSON.parse(JSON.stringify(module.namespace.retentionCounts())),
        view(action, win, fields = {}, senderURL = win.url) {
            return dispatch(browser.runtime.onMessage, { action, id: new URL(win.url).searchParams.get('id'), ...fields },
                { id: PRIVACY_ID, url: senderURL });
        },
        closeWindow(id) {
            for (const listener of browser.windows.onRemoved.listeners) listener(id);
        }
    };
}
