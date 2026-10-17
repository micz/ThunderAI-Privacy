# Architecture

`mztap-background.js` starts `js/mztap-service.js`. The service validates external
senders/protocol/instance IDs, owns conversation records and opaque request contexts,
queues hooks per session, emits progress and routes settings from extension pages.
It never calls AI providers. Activation and `do_debug` default to false in
`mztap-options-default.js` and are stored locally, not synced.

## Engine

- `mztap-privacy-filter.js`: companion-local facade, mapping store, literal/text and
  JSON restoration, model management and shared-worker leases.
- `mztap-privacy-client.js`: worker RPC and fatal-worker failure handling.
- `workers/mztap-inference-worker.js`: one serialized classifier with isolated
  sessions, immediate cancellation/disposal tombstones and mapping deltas.
- `mztap-privacy-redaction.js`: token alignment, overlapping chunks, rule detection,
  stable placeholders and repetition masking.
- `mztap-extra-body.js`: recursive string filtering, fixed schema-key protection,
  top-level metadata-key masking and collision detection.
- `mztap-privacy-instructions.js`: task-neutral placeholder guidance added after
  masking every outgoing message, including follow-ups.
- `mztap-views.js` and `pages/privacy-web/`: companion-owned custom-input, restored
  result and diff windows, with session-scoped cleanup and internal sender checks.
- `mztap-transformers-runtime.js`: lazy bundled Transformers.js/ONNX Runtime loading.
  No executable assets are downloaded. See `VENDORS.md` for versions/licenses/hashes.

The model is `onnx-community/nym-pii-multilingual-ONNX`. A WebGPU adapter supporting
`shader-f16` selects GPU; otherwise single-threaded WASM runs on CPU. Both backends
use the same fp16-weight model with fp32 computation. GPU inference failure blocks
instead of retrying unpredictably on CPU. Unsupported 32-bit platforms are rejected
before inference/model download. The manifest currently requires Thunderbird 153.0.

Long inputs have no total privacy-token cap: windows contain at most 2048 model
tokens including special tokens, with up to 128 overlap tokens, Unicode-scalar-safe
boundaries and re-encoding checks. Aligned spans merge over the full normalized
input; whole-input rules/repetition run afterwards. Safely aligned whitespace-only
predictions are ignored; other alignment failures block. Provider context limits
still apply, and overlap cannot guarantee complete detection.

Rules complement model detection for complete emails, contact-formatted phones,
validated/labeled cards, English/German card endings and support/billing companies.
Repetition is restricted to suitable identifiers/names/addresses, with casing and
minimum-length guards. Placeholders use `[PII_<8-hex-session>_<LABEL>_<number>]`.
Restoration is single-pass; HTML originals are escaped and JSON strings remain valid.

## Options and model cache

`options/mztap-privacy-options.js` manages activation, model status/size/download,
confirmed deletion and sensitive diagnostics. The UI requests optional Hugging Face
permissions from user gestures. Cache completeness requires tokenizer files plus
the pinned runtime's pipeline cache check. There is no implicit download on inference.
Deletion removes only this model's URL entries, not unrelated browser cache data.

`do_debug` gates `tapLogger`. Diagnostics may contain original private values:
prepared hook content, mappings, local progress/failures and responses before
restoration. These are not serialized provider HTTP bodies; use developer tools to
inspect outgoing requests. The warning stays visible with logging on or off;
logging-session changes apply to new chats. Production is silent by default.
