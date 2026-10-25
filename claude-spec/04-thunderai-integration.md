# ThunderAI integration

| Responsibility | Owner |
|---|---|
| Menus, prompts, message extraction, providers/API credentials | ThunderAI |
| Before/after hook dispatch, progress/Stop, processed provider history | ThunderAI |
| Activation switch (`ai_processing_enabled`) | ThunderAI; Privacy's settings page mirrors it |
| Readiness (platform, model), model/runtime/downloads, diagnostics | Privacy (a download can be started from ThunderAI) |
| Detection, placeholders, mappings, response restoration | Privacy |

ThunderAI's `ProcessingWorker` applies hooks to all provider workers for chat actions,
follow-ups and special commands (including automatic and batch features). Response
text/thinking is buffered while processing is active. Thinking is separated before
restoration; structured results are restored before parsing/storing/Sparks actions.
Postprocessed replies remain local and never re-enter provider conversation history.

ChatGPT Web is not covered: the restored answer could only be shown outside the site's
page, so while the switch is on ThunderAI blocks a prompt on that connection with a notice
before opening the site, rather than sending it unprocessed.

Without an active processor, ThunderAI hooks return unchanged content. Active failures
abort; there is no silent bypass. Exact wire messages and lifecycle semantics are in
[03-data-contracts.md](03-data-contracts.md). Load both repositories as temporary
add-ons; a ThunderAI build implementing API v1 is required (target ThunderAI 5.2.0).

## Manual checks

Use fictional values and verify CPU/WebGPU, model download/partial cache/deletion,
long inputs, follow-up placeholder reuse, inline/dedicated thinking, JSON escaping,
cancellation/timeout, concurrent commands and companion
restart/uninstall/deactivation. Inspect outgoing bodies and ensure restored originals
do not return in provider history. Focused JSON restoration and service
lifecycle checks live in `tests/`; see `tests/README.md`. They mock extension APIs
and inference/model management and do not replace Thunderbird/CPU/WebGPU testing.
