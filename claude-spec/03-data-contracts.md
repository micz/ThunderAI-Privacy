# Data contracts

The messaging interface between **ThunderAI** and **Privacy**. This is the
contract you must keep stable (or change on both sides).

## Incoming messages (`runtime.onMessageExternal`)

Sender: the ThunderAI add-on (`thunderai@micz.it`). Handled in
[`mztap-background.js`](../mztap-background.js), dispatched on `message.action`.

### `checkPresence`

- **Payload**: none.
- **Response**: the Privacy version string (e.g. `"1.0.0"`), from
  `browser.runtime.getManifest().version`.
- **Purpose**: lets ThunderAI detect that Privacy is installed and which
  version, so it can enable/adjust Privacy-dependent features.

## Outgoing messages

None: Privacy sends no messages to ThunderAI.

## Changing the contract

Adding or changing an action requires **both repos**:

1. **Here**: handle it in `mztap-background.js` and document it in this file.
2. **ThunderAI**: send it with
   `runtime.sendMessage('thunderai-privacy@micz.it', {action: ...})`, and gate it
   on the Privacy version returned by `checkPresence` when older versions don't
   support it.

See [`04-thunderai-integration.md`](04-thunderai-integration.md).
