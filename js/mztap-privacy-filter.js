/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { PrivacyClient } from './mztap-privacy-client.js';
import { restorePrivacyPlaceholders } from './mztap-placeholders.js';

export { PRIVACY_MODEL } from './mztap-privacy-config.js';

let modelClient;
let commandPool;
const COMMAND_WORKER_IDLE_MS = 60000;

function acquireCommandClient() {
    if (!commandPool?.client.worker) commandPool = { client: new PrivacyClient(), users: 0, timer: null };
    const pool = commandPool;
    clearTimeout(pool.timer);
    ++pool.users;
    return { client: pool.client, release() {
        if (--pool.users === 0) {
            pool.timer = setTimeout(() => pool.client.close(), COMMAND_WORKER_IDLE_MS);
        }
    } };
}

function getModelClient() {
    if (!modelClient?.worker) modelClient = new PrivacyClient();
    return modelClient;
}

export function getPrivacyModelOptions() {
    return getModelClient().request('options');
}

export function isPrivacyModelDownloaded() {
    return getModelClient().request('cached');
}

export function getPrivacyModelSize() {
    return getModelClient().request('size');
}

export async function downloadPrivacyModel(progress_callback) {
    const client = getModelClient();
    await client.request('download', {}, progress_callback);
    if (!await client.request('cached')) throw new Error(browser.i18n.getMessage('privacy_download_required'));
}

export function disposePrivacyModelManager() {
    modelClient?.close();
    modelClient = null;
}

export async function deletePrivacyModel() {
    // The service disposes active sessions first. Close pooled and options workers
    // before deleting only this model's cache entries, never the whole cache.
    if (commandPool) { clearTimeout(commandPool.timer); commandPool.client.close(); commandPool = null; }
    disposePrivacyModelManager();
    const { loadTransformersRuntime } = await import('./mztap-transformers-runtime.js');
    const { PRIVACY_MODEL } = await import('./mztap-privacy-config.js');
    const { env } = await loadTransformersRuntime();
    const cache = await caches.open(env.cacheKey);
    const prefix = `${env.remoteHost}${PRIVACY_MODEL}/resolve/`;
    for (const request of await cache.keys()) {
        if (request.url.startsWith(prefix)) await cache.delete(request);
    }
}

export function createPrivacySession({ shared = false } = {}) {
    let client;
    let lease;
    let ready;
    let disposed = false;
    let generation = 0;
    const pendingMasks = new Set();
    const sessionId = crypto.randomUUID();
    const values = new Map();
    const restore = text => restorePrivacyPlaceholders(text, values);
    return {
        async mask(text, { onProgress = () => {} } = {}) {
            if (disposed) throw new Error('Privacy session is closed');
            const currentGeneration = generation;
            const maskId = crypto.randomUUID();
            if (!client) {
                if (shared) { lease = acquireCommandClient(); client = lease.client; }
                else client = new PrivacyClient();
            }
            try {
                ready ??= client.request('createSession', { sessionId });
                await ready;
                if (disposed || generation !== currentGeneration) throw new Error('Privacy filtering cancelled');
                pendingMasks.add(maskId);
                const result = await client.request('mask', { text, sessionId, maskId }, info => {
                    if (!disposed && generation === currentGeneration) onProgress(info);
                });
                if (disposed) throw new Error('Privacy session is closed');
                for (const [placeholder, value] of result.mappings) values.set(placeholder, value);
                // A completed mask may race with Stop. Keep delivered deltas in
                // sync even when its text must not be dispatched.
                if (generation !== currentGeneration) throw new Error('Privacy filtering cancelled');
                return { text: result.text, restore };
            } catch (error) {
                if (error.code === 'privacy_download_required') {
                    error.message = browser.i18n.getMessage('privacy_download_required');
                }
                throw error;
            } finally {
                pendingMasks.delete(maskId);
            }
        },
        cancel() {
            ++generation;
            for (const maskId of pendingMasks) {
                void client.request('cancelMask', { sessionId, maskId }).catch(() => {});
            }
        },
        restore,
        getMappings: () => [...values],
        dispose() {
            if (disposed) return;
            disposed = true;
            if (lease) {
                // Queued after any in-flight inference; disposal at the provider
                // boundary already suppresses dispatch. Other commands keep running.
                void client.request('disposeSession', { sessionId }).catch(() => {});
                lease.release();
            } else client?.close();
            values.clear();
        },
    };
}

// Restore string literals without reserializing numbers or changing formatting.
// All JSON roots are valid, including arrays and standalone strings. Special
// commands also return fenced JSON or ordinary summaries/translations.
export function restorePrivacyResponse(text, session) {
    function restoreJSON(json) {
        try {
            JSON.parse(json);
        } catch {
            return undefined;
        }
        return json.replace(/"(?:\\.|[^"\\])*"/g,
            literal => JSON.stringify(session.restore(JSON.parse(literal))));
    }
    const whole = restoreJSON(text);
    if (whole !== undefined) return whole;

    // Keep Markdown wrappers and prose outside JSON as ordinary text. Process
    // each fence separately, so multiple blocks cannot be mistaken for one root.
    const fences = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
    if (fences.length) {
        let end = 0;
        const parts = [];
        for (const match of fences) {
            parts.push(session.restore(text.slice(end, match.index)));
            const start = match[0].indexOf('\n') + 1;
            parts.push(match[0].slice(0, start), restoreJSON(match[1]) ?? session.restore(match[1]), '```');
            end = match.index + match[0].length;
        }
        parts.push(session.restore(text.slice(end)));
        return parts.join('');
    }

    // Preserve support for a single object/array embedded in explanatory prose.
    const candidates = [['{', '}'], ['[', ']']].map(([open, close]) => ({
        start: text.indexOf(open), end: text.lastIndexOf(close)
    })).filter(({ start, end }) => start >= 0 && end >= start).sort((a, b) => a.start - b.start);
    for (const { start, end } of candidates) {
        const restored = restoreJSON(text.slice(start, end + 1));
        if (restored !== undefined) {
            return session.restore(text.slice(0, start)) + restored + session.restore(text.slice(end + 1));
        }
    }
    return session.restore(text);
}
