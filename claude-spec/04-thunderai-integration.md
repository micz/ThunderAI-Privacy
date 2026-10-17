# ThunderAI integration

| Responsibility | Owner |
|---|---|
| Menus, prompts, message extraction, providers/API credentials | ThunderAI |
| Before/after hook dispatch, progress/Stop, processed provider history | ThunderAI |
| Privacy activation/settings, model/runtime/downloads | Privacy |
| Detection, placeholders, mappings, response restoration | Privacy |
| Web custom-input and processed-response views | Privacy extension pages |

ThunderAI's `ProcessingWorker` applies hooks to all provider workers for chat actions,
follow-ups and special commands (including automatic and batch features). Response
text/thinking is buffered while processing is active. Thinking is separated before
restoration; structured results are restored before parsing/storing/Sparks actions.
Postprocessed replies remain local and never re-enter provider conversation history.

For ChatGPT Web, the before hook runs before DOM insertion. Custom input is collected
in Privacy's own window, outside the site's DOM. The after hook runs when extracting text for Thunderbird
reply/replace or a companion-owned view/diff; original values and diff baselines are never
written back into the site. Direct typing into ChatGPT, existing conversations and
project/custom-GPT content are outside this protection.

Without an active processor, ThunderAI hooks return unchanged content. Active failures
abort; there is no silent bypass. Exact wire messages and lifecycle semantics are in
[03-data-contracts.md](03-data-contracts.md). Load both repositories as temporary
add-ons; a ThunderAI build implementing API v1 is required (target ThunderAI 5.2.0).

## Manual checks

Use fictional values and verify CPU/WebGPU, model download/partial cache/deletion,
long inputs, follow-up placeholder reuse, inline/dedicated thinking, JSON escaping,
Web reply/replace/view/diff, cancellation/timeout, concurrent commands and companion
restart/uninstall/deactivation. Inspect outgoing bodies and ensure restored originals
do not return in provider history. No automated test suite is shipped.
