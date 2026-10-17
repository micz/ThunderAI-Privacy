/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { PRIVACY_MODEL, PRIVACY_MODEL_REVISION } from './mztap-privacy-config.js';
let runtimePromise;

// Used in extension pages AND dedicated workers. Workers have no browser.runtime
// API, so resolve executable assets relative to this trusted extension module.
export function loadTransformersRuntime() {
    runtimePromise ??= import('./lib/transformers/transformers.min.js').then(module => {
        // 4.3.1 requires a local source for cache-only/local_files_only loads.
        // Keep that source logically enabled, but forbid local-path fetches:
        // cached responses are read before fetch, and cache misses fail closed.
        module.env.allowLocalModels = true;
        module.env.allowRemoteModels = false;
        module.env.useFS = false;
        const fetchModel = module.env.fetch;
        const modelPrefix = `${module.env.remoteHost}${PRIVACY_MODEL}/resolve/${PRIVACY_MODEL_REVISION}/`;
        module.env.fetch = (input, init) => {
            let url;
            try {
                url = new URL(typeof input === 'string' ? input : input?.url || input?.href).href;
            } catch {
                // Relative/local model paths are never a permitted source.
            }
            if (!module.env.allowRemoteModels || !url?.startsWith(modelPrefix)) {
                throw new Error('Privacy model fetch blocked outside an explicit pinned-model download/metadata operation.');
            }
            return fetchModel(input, init);
        };
        // 4.3.1's registry/pipeline preflight helpers do not consistently forward
        // revision to config/tokenizer metadata discovery. Lock the URL template
        // too, so even those requests cannot consult a floating main revision.
        module.env.remotePathTemplate = `{model}/resolve/${PRIVACY_MODEL_REVISION}/`;
        module.env.useBrowserCache = true;
        module.env.useWasmCache = false;
        module.env.backends.onnx.wasm.wasmPaths = {
            mjs: new URL('./lib/transformers/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
            wasm: new URL('./lib/transformers/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
        };
        return module;
    });
    return runtimePromise;
}

// Probe capabilities in the calling context (e.g. the inference worker).
// Model-specific device and precision choices belong to the caller.
export async function supportsWebGpuFp16(gpu = globalThis.navigator?.gpu) {
    try {
        if (gpu?.requestAdapter) {
            const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
            return adapter?.features?.has('shader-f16') ?? false;
        }
    } catch {
        // Adapter acquisition may fail due to drivers, policies, or platform support.
    }
    return false;
}
