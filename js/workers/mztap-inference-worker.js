/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { loadTransformersRuntime, supportsWebGpuFp16 } from '../mztap-transformers-runtime.js';
import { PRIVACY_MODEL, PRIVACY_TASK as TASK } from '../mztap-privacy-config.js';
import { createRedactionSession } from '../mztap-privacy-redaction.js';

let optionsPromise;
let classifierPromise;
let queue = Promise.resolve();
const getOptions = () => optionsPromise ??= selectPrivacyBackend();

async function selectPrivacyBackend() {
    if (await supportsWebGpuFp16()) {
        return { dtype: 'fp16', device: 'webgpu' };
    }
    // This model's fp16 export stores half-precision weights but computes in
    // fp32, including on WASM. Both backends can use the same cached artifact.
    return { dtype: 'fp16', device: 'wasm' };
}

async function loadPrivacyRuntime() {
    const module = await loadTransformersRuntime();
    // This feature runs inference in its own worker. Avoid additional ORT
    // proxy/blob workers and keep its single-threaded CPU execution policy local.
    module.env.backends.onnx.wasm.numThreads = 1;
    module.env.backends.onnx.wasm.proxy = false;
    return module;
}

async function isDownloaded() {
    const options = await getOptions();
    const { ModelRegistry, env } = await loadPrivacyRuntime();
    const cache = await caches.open(env.cacheKey);
    const prefix = `${env.remoteHost}${PRIVACY_MODEL}/resolve/main/`;
    // 4.3.1 registry discovery can omit tokenizer files when metadata is missing.
    // Require them locally before discovery to avoid network access/incomplete
    // cache acceptance. Recheck these URL keys whenever Transformers.js changes.
    for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
        if (!await cache.match(prefix + file)) return false;
    }
    return ModelRegistry.is_pipeline_cached(TASK, PRIVACY_MODEL, options);
}

async function getClassifier() {
    classifierPromise ??= (async () => {
        if (!await isDownloaded()) {
            const error = new Error('Privacy model download required');
            error.code = 'privacy_download_required';
            throw error;
        }
        const [{ pipeline }, options] = await Promise.all([loadPrivacyRuntime(), getOptions()]);
        return pipeline(TASK, PRIVACY_MODEL, options);
    })().catch(error => { classifierPromise = null; throw error; });
    return classifierPromise;
}

// Share expensive model state, never entity histories or placeholder mappings.
const sessions = new Map();
const releasedSessions = new Set();
const cancelledMasks = new Set();

async function handle({ id, command, text, sessionId, maskId }) {
    switch (command) {
        case 'options': return getOptions();
        case 'cached': return isDownloaded();
        case 'createSession': {
            if (typeof sessionId !== 'string' || sessions.has(sessionId) || releasedSessions.has(sessionId)) {
                throw new Error('Invalid privacy session');
            }
            sessions.set(sessionId, { redaction: createRedactionSession(getClassifier), delivered: new Set() });
            return true;
        }
        case 'disposeSession':
            releasedSessions.delete(sessionId);
            return true;
        case 'cancelMask':
            cancelledMasks.delete(maskId);
            return true;
        case 'size': {
            const options = await getOptions();
            const { ModelRegistry } = await loadPrivacyRuntime();
            const files = await ModelRegistry.get_pipeline_files(TASK, PRIVACY_MODEL, options);
            const metadata = await Promise.all(files.map(file => ModelRegistry.get_file_metadata(PRIVACY_MODEL, file)));
            if (metadata.some(file => !file.exists || !Number.isFinite(file.size))) {
                throw new Error('Model files or download sizes are not available yet.');
            }
            return metadata.reduce((size, file) => size + file.size, 0);
        }
        case 'download': {
            const options = await getOptions();
            const { pipeline } = await loadPrivacyRuntime();
            const classifier = await pipeline(TASK, PRIVACY_MODEL, { ...options,
                progress_callback: info => postMessage({ id, event: 'progress', info }),
            });
            await classifier.dispose();
            return true;
        }
        case 'mask': {
            const entry = sessions.get(sessionId);
            if (!entry) throw new Error('Privacy session is closed');
            const { redaction, delivered } = entry;
            const result = await redaction.mask(text, {
                isCancelled: () => entry.disposed || cancelledMasks.has(maskId),
                onProgress: info => postMessage({ id, event: 'progress', info }),
            });
            if (entry.disposed || cancelledMasks.has(maskId)) throw new Error('Privacy session is closed');
            const mappings = redaction.getMappings().filter(([placeholder]) => !delivered.has(placeholder));
            for (const [placeholder] of mappings) delivered.add(placeholder);
            return { text: result.text, mappings };
        }
        default: throw new Error('Unknown privacy worker command');
    }
}

self.onmessage = ({ data }) => {
    if (data.command === 'cancelMask') cancelledMasks.add(data.maskId);
    if (data.command === 'disposeSession') {
        // Cancel queued work immediately, without terminating other sessions.
        // The tombstone lasts until all earlier queued requests have settled.
        const entry = sessions.get(data.sessionId);
        if (entry) entry.disposed = true;
        sessions.delete(data.sessionId);
        releasedSessions.add(data.sessionId);
    }
    // One pipeline per worker, isolated redaction sessions. Serialize requests so
    // inference and follow-up mappings cannot race each other.
    queue = queue.then(async () => {
        try {
            postMessage({ id: data.id, result: await handle(data) });
        } catch (error) {
            postMessage({ id: data.id, error: {
                message: error instanceof Error ? error.message : String(error),
                code: error.code, limit: error.limit,
            } });
        }
    });
};
