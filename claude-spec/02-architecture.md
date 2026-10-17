# Architecture

## Components

```
manifest.json
  └─ background: mztap-background.js  (ES module, top-level await)
  └─ options_ui: options/mztap-options.html

js/
  mztap-logger.js           tapLogger(prefix, do_debug)
  mztap-i18n.js             __MSG_*__ DOM localizer (vendored)
  mztap-options.js          storage.sync get/set helper (vendored, MPL-2.0)
  mztap-options-default.js  { do_debug: false }

options/
  mztap-options.html/.css/mztap-options-page.js   Options page
  mztap-release-notes.html/.css/.js               Release-notes view

_locales/<lang>/messages.json                      i18n (default: en)
```

### `mztap-background.js` — the entry point

The only always-on code. Responsibilities:

1. Read the `do_debug` pref and build a `tapLogger`.
2. Register `runtime.onMessageExternal` and dispatch on `message.action`:
   - `checkPresence` → `Promise.resolve(PRIVACY_VERSION)`

`PRIVACY_VERSION` comes from `browser.runtime.getManifest().version` — never
hardcoded.

## End-to-end flow

```
ThunderAI (separate add-on)                      Privacy (this add-on)
────────────────────────────                     ─────────────────────
runtime.sendMessage(
  'thunderai-privacy@micz.it',
  { action: '<action>', ... })
                                  │
                                  ▼
                        onMessageExternal
                          │
                          └─ dispatch on message.action
                          │
                          └─ returns the response to ThunderAI
```

## Options / storage

- Prefs stored in `browser.storage.sync`. Only one pref today: `do_debug`.
- `mztap-options.js` (vendored options-manager) wires `.option-input` elements
  to `storage.sync` on `change`, and restores them on load.
- The options page and release-notes page are localized via the `__MSG_*__`
  helper in `mztap-i18n.js`.

## Error handling

- Errors are logged to the console with a `[ThunderAI Privacy]` prefix.
- Verbose diagnostic logs go through `tapLogger` and only print when `do_debug`
  is enabled.
