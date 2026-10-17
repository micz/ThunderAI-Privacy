# ThunderAI integration

Privacy is a **companion add-on** to ThunderAI. This document draws the boundary
between the two so you always change the right repository.

- **ThunderAI** (main add-on): https://github.com/micz/ThunderAI — ID
  `thunderai@micz.it`
- **Privacy** (this repo): ID `thunderai-privacy@micz.it`

## Responsibility split

| Concern | Lives in | This repo? |
|---|---|---|
| Prompt text / prompt settings | ThunderAI | ❌ |
| LLM/model calls, API keys | ThunderAI | ❌ |
| Menus & user actions | ThunderAI | ❌ |
| Detecting Privacy & its version | ThunderAI (via `checkPresence`) | ✅ replies |

## Message boundary

ThunderAI → Privacy, via `runtime.sendMessage('thunderai-privacy@micz.it', ...)`:

- `checkPresence` → version string back.

Privacy → ThunderAI: none.

Exact payloads: [`03-data-contracts.md`](03-data-contracts.md).

## On the ThunderAI side

ThunderAI detects Sparks with `checkSparksPresence()` in `js/mzta-utils.js`
(`checkPresence` + a minimum version, `sparks_min`). Privacy is meant to be
detected the same way, with its own minimum version.

## Checklist: adding a new action

1. **Privacy** — `mztap-background.js`: handle the new `message.action`.
2. **Privacy** — document it in [`03-data-contracts.md`](03-data-contracts.md).
3. **Privacy** — bump `manifest.json` version, add the release-notes /
   `CHANGELOG.md` entry.
4. **ThunderAI** — send the action, gated on the Privacy version.
5. File/track the issue in **this** repo
   (https://github.com/micz/ThunderAI-Privacy/issues); link the ThunderAI
   issue for the ThunderAI side, if there is one.
