# Bundled runtime assets

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

## Downloaded model data

Repository: `onnx-community/nym-pii-multilingual-ONNX` (MIT).
Immutable revision: `7ce7f1a4dfc55a8037c3ae539b538fee2d44e5f0`.
Source: https://huggingface.co/onnx-community/nym-pii-multilingual-ONNX/tree/7ce7f1a4dfc55a8037c3ae539b538fee2d44e5f0

| File | SHA-256 |
|---|---|
| `config.json` | `44d8be23e7152dffc1bbe77a639b7ed4631592cafe29a443d1704bbe8cdd4bd3` |
| `tokenizer_config.json` | `14b147f2a4f939d9b12ab36e9633917040dd948fa78ce283b03402e4cf2c9cba` |
| `tokenizer.json` | `e977adcc6faffc532cb774decca6a9e4f44ad6075930d625dee7cb1ac3aa6121` |
| `onnx/model_fp16.onnx` | `6d94ad6d48f77cc36446bac693e674e99ae892f8e79f164a298fb02e91f321bb` |
| `onnx/model_fp16.onnx_data` | `0210921bfeacb8ac7de05cf3cde62cc179ce9d8f37ad944efb7686160b5442bf` |

Config hashes were calculated from this revision; tokenizer/ONNX hashes are the
Hub's published LFS SHA-256 identifiers. This is a provenance manifest, not a
claim of runtime digest verification. No model weights were downloaded for these
changes. Revision changes require reviewing/updating this table and the constant
in `mztap-privacy-config.js`. The runtime URL template is locked as well as pipeline
options: 4.3.1's preflight discovery does not always propagate `revision`.

Cache checks accept only the pinned revision; older `/resolve/main/` caches require
an explicit download. Model deletion intentionally removes this model's cached
files across all revisions, including obsolete `main` entries, and no other model.
