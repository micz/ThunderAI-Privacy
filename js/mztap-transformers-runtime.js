/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
let runtimePromise;

// Used in extension pages AND dedicated workers. Workers have no browser.runtime
// API, so resolve executable assets relative to this trusted extension module.
export function loadTransformersRuntime() {
    runtimePromise ??= import('./lib/transformers/transformers.min.js').then(module => {
        module.env.allowLocalModels = false;
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
