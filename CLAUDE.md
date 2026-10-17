# CLAUDE.md

Guidance for AI agents working in the **ThunderAI Privacy** repository.

## What this project is

ThunderAI Privacy is a **Thunderbird MailExtension** (add-on) that acts as a
companion for the main **ThunderAI** add-on, adding privacy features to it.

Unlike its sibling companion **ThunderAI Sparks**, Privacy is a **standard
WebExtension**: it does **not** use Thunderbird
[experimental APIs](https://developer.thunderbird.net/add-ons/mailextensions/experiments),
it has no `experiment_apis` in the manifest and it does not ask for full
permissions. Keep it that way: if a feature seems to need privileged access,
discuss it before adding an experiment.

> **IMPORTANT — the split between the two add-ons.**
> All menus, prompts, AI model configuration and message extraction live in the
> **ThunderAI** add-on (a separate repository: https://github.com/micz/ThunderAI).
> ThunderAI drives Privacy through cross-extension messaging. A feature that
> needs a user-facing entry point, a prompt change or a change in what ThunderAI
> sends to the model is (at least partly) a **ThunderAI** change.

## The repositories

| | ThunderAI | ThunderAI Sparks | ThunderAI Privacy (this repo) |
|---|---|---|---|
| Extension ID | `thunderai@micz.it` | `thunderai-sparks@micz.it` | `thunderai-privacy@micz.it` |
| Role | LLM prompting, settings, menus, message extraction | Executor for experimental-API features | Privacy features |
| Experimental APIs? | No | **Yes** | **No** |
| Issue tracker | Yes | ThunderAI's, `Sparks` label | Its own |

Unlike Sparks, issues for Privacy are filed in **this** repo:
https://github.com/micz/ThunderAI-Privacy/issues

## How the two add-ons communicate

1. Privacy registers `browser.runtime.onMessageExternal` (see
   [`mztap-background.js`](mztap-background.js)).
2. ThunderAI sends a message to `thunderai-privacy@micz.it` with an `action`:
   - `checkPresence` → manifest version string.
   - `aiProcessing.*` → versioned async session/before/after/cancel/dispose hooks.
3. Privacy sends registration and progress to ThunderAI; both validate exact IDs.

The full contract is in [`claude-spec/03-data-contracts.md`](claude-spec/03-data-contracts.md).

## Layout

```
manifest.json              MV2 manifest; registers the background script
mztap-background.js        Cross-extension message listener (the entry point)
js/
  mztap-logger.js          tapLogger — debug logging gated on the do_debug pref
  mztap-i18n.js            __MSG_*__ DOM localization helper (vendored)
  mztap-options.js         Options-manager helper (vendored, MPL-2.0)
  mztap-options-default.js Local defaults: do_debug/ privacy_filter_enabled false
  mztap-service.js         Versioned hook service, companion-owned settings/sessions
  mztap-privacy-*.js       Detection, mappings, model management and restoration
  workers/                Shared local inference worker
  lib/transformers/       Bundled JS/WASM runtime (see VENDORS.md)
options/                   Options UI + release-notes page
pages/privacy-web/         Companion-owned Web input/result/diff windows
_locales/<lang>/messages.json   Translations (default_locale: en)
images/                    Icons
```

See [`claude-spec/`](claude-spec/) for detailed architecture docs.

## Conventions

- **Manifest v2**, background is an ES module (`"type": "module"`), top-level
  `await` is used in the background script.
- **Version** is read at runtime from the manifest
  (`browser.runtime.getManifest().version`) — do not hardcode it. When bumping a
  release, change `manifest.json` `version`, add a `<h2>` block at the top of
  [`options/mztap-release-notes.html`](options/mztap-release-notes.html) and the
  same block at the top of [`CHANGELOG.md`](CHANGELOG.md) (note: CHANGELOG uses
  HTML `<h2>`/`<ul>`, not markdown headings).
- **Naming**: files/vars are prefixed `mztap` / `tap` (ThunderAI Privacy).
- **License**: GPL-3.0 for the add-on's own files (keep the header block on new
  source files, with both authors: `Mic (m@micz.it), Nico Martin
  (mail@nico.dev)`); some vendored helpers (`mztap-options.js`, `mztap-i18n.js`)
  carry their own upstream licenses — leave those headers intact.
- **Localization**: user-facing strings go through `_locales`; the `en` locale is
  the source of truth. Translations are contributed (often via Weblate) — don't
  hand-edit non-`en` locales unless asked.
- **Logging**: use `tapLogger`; verbose logs are gated behind the `do_debug`
  storage pref so they stay silent in production.
- **Preferences**: every new pref gets its default in
  [`js/mztap-options-default.js`](js/mztap-options-default.js).
- **Keep spec files up to date**: when a change affects something described in
  `claude-spec/`, update the relevant file.

## Testing / running

There is no build step and no automated test suite. To exercise it manually you
load it as a temporary add-on in Thunderbird (153+, 64-bit) alongside an API v1
ThunderAI build. The manifest is authoritative for minimum compatibility.

## Gotchas

- No `strict_max_version` in the manifest: as a standard WebExtension, Privacy
  is not bound to a Thunderbird release the way Sparks is.
- A change to the message contract needs changes in **both** repos: the handler
  here and the sender in ThunderAI.
