# Architecture

`mztap-background.js` starts `js/mztap-service.js`. The service validates external
senders/protocol/instance IDs, owns conversation records and opaque request contexts,
queues hooks per session, emits progress and routes settings from extension pages.
It never calls AI providers. Activation and `do_debug` default to false in
`mztap-options-default.js` and are stored locally, not synced.
One serialized settings queue covers changes from multiple options windows and
model deletion; discovery/new sessions wait for committed state, but existing hooks
and cancellation do not. Each session retains one latest context plus only its
queued/in-flight call records. Context retirement never clears conversation mappings.

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
- `mztap-identifiers.js`: stable HMAC pseudonyms for nonempty prompt-cache/safety
  identifiers, including top-level extra-body overrides. A random installation key
  is stored locally; neither original identifiers nor reversible mappings persist.
- `mztap-placeholders.js`: shared exact restoration and detection of leftover owned
  namespace fragments; changed tokens block rather than guessing original values.
- `mztap-privacy-instructions.js`: task-neutral placeholder guidance added after
  masking every outgoing message, including follow-ups.
- `mztap-transformers-runtime.js`: lazy bundled Transformers.js/ONNX Runtime loading.
  No executable assets are downloaded. See `VENDORS_INFO.md` for versions/licenses/hashes.

The model is `onnx-community/nym-pii-multilingual-ONNX`. A WebGPU adapter supporting
`shader-f16` selects GPU; otherwise single-threaded WASM runs on CPU. Both backends
use the same fp16-weight model with fp32 computation. GPU inference failure blocks
instead of retrying unpredictably on CPU. Unsupported 32-bit platforms are rejected
before inference/model download. The manifest currently requires Thunderbird 153.0.
The immutable model revision is defined in `mztap-privacy-config.js`; provenance
hashes are recorded in `VENDORS_INFO.md`. Pipeline/registry options and the runtime URL
template both pin it (4.3.1 preflight discovery does not always propagate options).
Inference passes `local_files_only: true`; download remains an explicit action.
Remote model access is disabled in the runtime except during serialized size and
download commands, with a `finally` reset even on failure. This also guards runtime
preflight helpers that do not forward `local_files_only` consistently.
Transformers.js requires `allowLocalModels: true` even for cache-only reads.
Filesystem access is disabled, and a guarded `env.fetch` rejects every local path
and every offline request. During explicit size/download operations it accepts
only URLs under the pinned model revision. Thus enabling the library's local-source
flag permits cache reads, not actual filesystem or extension-local model fetching.

Long inputs have no total privacy-token cap: windows contain at most 2048 model
tokens including special tokens, with up to 128 overlap tokens, preferred whole-word
boundaries and re-encoding checks. Words exceeding a window retain a Unicode-scalar
fallback. Decoded visible scalars must match the original text; whitespace-only
decoder changes are aligned back to original offsets, never sent as rewritten text.
Aligned spans merge over the original input; whole-input rules/repetition run afterwards. Safely aligned whitespace-only
predictions are ignored; other alignment failures block. Provider context limits
still apply, and overlap cannot guarantee complete detection.
Literal markup, including `<br>`, is classified and retained as supplied, not
silently converted to line breaks. Unsafe alignment/splitting/reserved-prefix input
returns `TEXT_UNSUPPORTED` with text-specific guidance, not a restart suggestion.

Rules complement model detection for complete emails, contact-formatted phones,
validated/labeled cards, English/German card endings and support/billing companies.
Repetition is restricted to suitable identifiers/names/addresses, with casing and
minimum-length guards. Placeholders use `[PII_<8-hex-session>_<LABEL>_<number>]`.
Restoration is single-pass. Valid JSON roots (including
arrays/strings) and individual fenced blocks use escaped string-literal restoration
without reserializing numbers or formatting. Non-JSON task output uses text fallback.
Recognizable leftover fragments of a mapped session's namespace (case changes,
missing brackets or unknown labels/indices) in content raise `UNRESTORED_PLACEHOLDER`
before output/actions/views. Display-only thinking/provider errors use exact-only
restoration, leaving changed fragments literal without blocking the content.
No fuzzy reconstruction is attempted; unrelated namespace
literals and placeholder-like strings inside restored originals are not expanded.
Changes that erase/corrupt the namespace itself cannot reliably be identified.

Invalid configuration JSON blocks before provider dispatch; no invalid JSON string
is returned unfiltered on the assumption that a provider parser will discard it.

## Options and model cache

`options/mztap-privacy-options.js` shows two steps: (1) the model (status, size, download
progress, confirmed deletion, refused while the protection is on), (2) the switch that
mirrors ThunderAI's, disabled until the model is ready; plus sensitive diagnostics. The
download itself runs in the background (`startDownload()` in `mztap-service.js`), so
it survives closing the page and ThunderAI can start it too; the Hugging Face hosts are
required manifest permissions for that reason. Cache completeness requires tokenizer files plus
the pinned runtime's pipeline cache check. There is no implicit download on inference.
Deletion removes only this model's URL entries, not unrelated browser cache data.
Checks accept only pinned-revision URL entries. Old floating-main downloads must
be explicitly downloaded again. Deletion removes this model across revisions to
clean obsolete caches as well; no other model's entries are touched. The recorded
SHA-256 table documents provenance; cached artifacts are not rehashed at runtime.

`do_debug` gates `tapLogger`. Diagnostics may contain original private values:
prepared hook content, mappings, local progress/failures and responses before
restoration. These are not serialized provider HTTP bodies; use developer tools to
inspect outgoing requests. The warning stays visible with logging on or off;
logging-session changes apply to new chats. Production is silent by default.
