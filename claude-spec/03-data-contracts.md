# Data contracts: processing API v1

Only `thunderai@micz.it` is accepted by `runtime.onMessageExternal`. ThunderAI
accepts only `thunderai-privacy@micz.it`. `checkPresence` still returns the manifest
version string. Processing actions use `action: 'aiProcessing.<operation>'` and
`protocol: 1`. A fresh `instanceId` identifies each companion background startup.

## Incoming actions

| Operation | Additional fields | Success payload |
|---|---|---|
| `hello` | none | enabled, version |
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

Input is `{message, instructions, extraBody}`: a string message plus maps of string
provider instructions and serialized extra-body JSON. The companion preserves the
map keys. It never receives provider credentials/configuration through this envelope.
Output is `{content, thinking, error?}` with string fields. The after hook validates
opaque `context: {token}` against the original request in the session. Formats are
`text`, `json` (JSON-string-safe restoration) and `html` (escaped originals).
Optional `view: {original: string, diff: boolean}` on `after` opens the restored
result/diff in Privacy's own window. `collectInput` accepts `[{info: string}]`, opens
a companion-owned input form and returns string `values` for ThunderAI to assemble
the prompt. Closing the form or cancelling/disposing the session rejects the wait;
user input has no processing deadline. These views never run in the provider DOM.

## Outgoing actions

`register` carries `{ok: true, protocol: 1, instanceId, enabled, version}` at
startup and after settings changes. ThunderAI acknowledges `{ok: true, protocol: 1}`.
It also discovers with `hello` when opening sessions, so either startup order works.

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

Explicit deactivation affects new sessions; existing ones retain restoration.
Unexpected disconnect/uninstall is not an instruction to bypass active processing.
ThunderAI remembers active registration and blocks until the companion is available
or explicitly disabled in its own settings. No second activation switch exists.

## Internal settings

Only this extension's pages may call `privacy.getState`, `privacy.setEnabled`,
`privacy.setDebug` and `privacy.deleteModel` (requires `confirmed: true`). State lives
in local storage, not sync. Enabling requires a supported 64-bit platform, complete
model cache and successful registration with ThunderAI. Model deletion closes active
sessions but leaves activation unchanged: requests block rather than bypass filtering.

Update both repositories when changing this contract. The corresponding ThunderAI
spec is `claude-spec/08-ai-processing.md`.

`privacyView.data` and `privacyView.submit` are internal-only view messages, checked
against the exact companion page URL and a random view ID. The background owns view
data, closes session windows on disposal and rejects abandoned input forms.
