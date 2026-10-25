# Data contracts: processing API v1

Only `thunderai@micz.it` is accepted by `runtime.onMessageExternal`. ThunderAI
accepts only `thunderai-privacy@micz.it`. `checkPresence` still returns the manifest
version string. Processing actions use `action: 'aiProcessing.<operation>'` and
`protocol: 1`. A fresh `instanceId` identifies each companion background startup.

## Incoming actions

| Operation | Additional fields | Success payload |
|---|---|---|
| `hello` | none | version |
| `settingChanged` | enabled, locked (booleans) | acknowledgement; relayed to this add-on's pages as `privacyState.changed` |
| `createSession` | instanceId, sessionId, callId | acknowledgement |
| `before` | instanceId, sessionId, callId, requestId, input | input, context |
| `after` | instanceId, sessionId, callId, requestId, context, output, format, optional view | output |
| `collectInput` | instanceId, sessionId, callId, requestId, fields | values |
| `cancel` | instanceId, sessionId, callId, requestId | acknowledgement |
| `disposeSession` | instanceId, sessionId, callId | acknowledgement |

Success: `{ok: true, protocol: 1, instanceId, callId, ...payload}`.
Failure: `{ok: false, error: {code, message}}`. Errors never return unchanged input.
Codes include `PROTOCOL_UNSUPPORTED`, `SESSION_EXPIRED`, `MODEL_NOT_READY`,
`PLATFORM_UNSUPPORTED`, `CANCELLED`, `INVALID_REQUEST` and `INFERENCE_FAILED`.
`TEXT_UNSUPPORTED` identifies deterministic tokenizer/chunking/reserved-prefix
failures; editing the input is required rather than restarting Thunderbird.
`UNRESTORED_PLACEHOLDER` blocks output when a recognizable fragment of the mapped
session namespace remains after exact-token recognition in content, in all formats,
before any result/view is returned. Display-only thinking/provider error strings
restore known exact tokens once but leave changed fragments literal; they cannot
block otherwise valid content. They are never inserted or parsed as response content.
Changed tokens are never fuzzily matched to originals. It cannot detect arbitrary
model rewrites that erase/corrupt the namespace itself.

Input is `{message, instructions, extraBody}`: a string message plus maps of string
provider instructions and serialized extra-body JSON. The companion preserves the
map keys. It never receives provider credentials/configuration through this envelope.
Output is `{content, thinking, error?}` with string fields. The after hook validates
opaque `context: {token}` against the original request in the session. Formats are
`text`, `json` (JSON-string-safe restoration) and `html` (escaped originals).
JSON restoration accepts every valid root, including arrays and standalone strings,
and separately restores fenced blocks. String literals are escaped without changing
numeric spelling or formatting; ordinary summaries/translations retain text fallback.
Invalid extra-body/options/schema JSON is rejected with `INVALID_JSON`, never
returned unmasked. Cache keys and safety identifiers are installation-keyed HMAC
pseudonyms, not per-session placeholders: identical field/value pairs remain stable
across sessions/restarts, and top-level JSON overrides follow the same policy.
Optional `view: {original: string, diff: boolean}` on `after` opens the restored
result/diff in Privacy's own window. `collectInput` accepts `[{info: string}]`, opens
a companion-owned input form and returns string `values` for ThunderAI to assemble
the prompt. Closing the form or cancelling/disposing the session rejects the wait;
user input has no processing deadline. These views never run in the provider DOM.

## Outgoing actions

The activation switch is ThunderAI's `ai_processing_enabled` preference ("Use
ThunderAI Privacy" in its advanced options). This add-on keeps no activation flag:
its settings switch is a mirror, read with `getSetting` and written with `setSetting`
(`{protocol: 1, enabled}`). Both reply `{ok: true, protocol: 1, enabled, locked}`;
`locked` means a ThunderAI policy enforces the value, and `setSetting` is then refused
with `{ok: false, error: {code: 'ai_processing_setting_locked', message}}`, which the
settings page shows as is. Each call is bounded to 5 s; an absent or slow ThunderAI is
`MAIN_UNAVAILABLE`, a malformed reply `PROTOCOL_UNSUPPORTED`. ThunderAI sends
`settingChanged` whenever the preference changes, whoever wrote it. ThunderAI
discovers with `hello` before each new session, only while its switch is on.

`progress` includes protocol, instanceId, sessionId, requestId, callId and
`progress: {phase, current, total}`. ThunderAI renews timeouts only for matching,
monotonically advancing progress. Calls otherwise time out and request cancellation.
There is no HTTP-audit operation or capability negotiation in v1. Active v1 processing
buffers provider responses; diagnostics cover hook content, not actual HTTP bodies.

## Lifecycle

IDs and contexts are ephemeral. Mappings stay in the companion and are never synced,
persisted, returned to ThunderAI or sent to providers. One shared inference worker
uses isolated redaction sessions. Disposing a session cancels its queued work without
stopping peers. Sessions expire after 24 h idle; the worker closes 60 s after its last
lease is released. Restart invalidates old IDs; ThunderAI must start a fresh chat.
Only the latest prepared request/context is retained per session. A new preparation
retires the previous context, including when replacement preparation fails. Repeated
restoration/previews of the latest request remain supported. Conversation-wide
mappings are not retired with contexts, so follow-ups still restore earlier values.
Pending calls are keyed by `callId`; cancellation must match that call's `requestId`.
Cancellation flags exist only until their queued/in-flight calls settle. Late or
unknown cancellations retain no tombstones, and cancelling a queued call does not
interrupt another call's inference. Disposing clears all session bookkeeping/views.

Explicit deactivation affects new sessions; existing ones retain restoration.
Unexpected disconnect/uninstall is not an instruction to bypass active processing:
while ThunderAI's switch is on, it blocks until the companion is available again or
the switch is turned off (in either settings page).

## Internal settings

Only this extension's pages may call `privacy.getState`, `privacy.setEnabled`,
`privacy.setDebug` and `privacy.deleteModel` (requires `confirmed: true`). `do_debug`
lives in local storage, not sync. `privacy.getState` adds ThunderAI's `enabled` and
`locked` and `main_available` (false when `getSetting` fails: the switch is then shown
off and disabled). `privacy.setEnabled` forwards to `setSetting` and returns ThunderAI's
`{enabled, locked}`. Enabling requires a supported 64-bit platform and a complete model
cache, checked here before ThunderAI is asked; disabling is always forwarded. Model
deletion closes active sessions but leaves activation unchanged: requests block rather
than bypass filtering. Settings reads/mutations are serialized across extension windows,
including activation requests and model deletion. Discovery/new-session creation waits
for the settings queue, so it never races deletion. Existing hooks and cancellation
remain independent of that queue. Failed storage writes do not change the in-memory
setting; rejected operations do not poison the queue.

Update both repositories when changing this contract. The corresponding ThunderAI
spec is `claude-spec/09-ai-processing.md`.

`privacyView.data` and `privacyView.submit` are internal-only view messages, checked
against the exact companion page URL and a random view ID. The background owns view
data, closes session windows on disposal and rejects abandoned input forms.
