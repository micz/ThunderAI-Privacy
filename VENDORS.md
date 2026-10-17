# Bundled runtime assets

file: js/lib/diff.js
source: https://cdn.jsdelivr.net/npm/diff@9.0.0/dist/diff.js
license: BSD-3-Clause (js/lib/LICENSE-diff)
purpose: companion-owned local response diff view

files: js/lib/transformers/transformers.min.js
source: https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js
version: 4.3.1 (upstream tag/commit 511bb61a7c46b73e33f1af3fb308fbd1afe98c02)
sha256: 8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743
upstream: https://github.com/huggingface/transformers.js
license: Apache-2.0 (js/lib/transformers/LICENSE-transformers)

Bundled ESM build, not transformers.web.min.js (which requires bare imports).
Includes the ModelRegistry and progress_total APIs used by model management.
On upgrade, re-check the mandatory tokenizer cache keys in mztap-inference-worker.js;
the offline cache guard depends on the pinned runtime's URL-key format.

files: js/lib/transformers/ort-wasm-simd-threaded.asyncify.mjs, js/lib/transformers/ort-wasm-simd-threaded.asyncify.wasm
source: https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.mjs
source: https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm
sha256 (mjs): 0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611
sha256 (wasm): 49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082
upstream: https://github.com/microsoft/onnxruntime
license: MIT (js/lib/transformers/LICENSE-onnxruntime)

The pinned ONNX Runtime dev build matches Transformers.js 4.3.1, including its
asyncify loader; do not replace its executable assets independently. Executable
assets ship locally; only model data is downloaded from Hugging Face.
The companion's wasm-unsafe-eval CSP permits WebAssembly compilation, not JS eval
or remote executable code. The model is `onnx-community/nym-pii-multilingual-ONNX`;
review its upstream model card/license when packaging or changing the model.
