# Overview

## What Privacy is

ThunderAI Privacy is a Thunderbird MailExtension that adds privacy features to
the **ThunderAI** add-on. It is a companion: it does nothing on its own, and it
is driven by ThunderAI over cross-extension messaging.

- Extension ID: `thunderai-privacy@micz.it`
- Manifest: v2, background ES module
- Homepage: https://micz.it/thunderbird-addon-thunderai/#privacy
- License: GPL-3.0 (own code)

## Not an experiment

The other ThunderAI companion, **ThunderAI Sparks**, exists because it needs
Thunderbird [Experiments](https://developer.thunderbird.net/add-ons/mailextensions/experiments)
(privileged access to the calendar backend). Privacy does **not**: it is a
standard WebExtension, with no `experiment_apis`, no full-permission request
and no `strict_max_version` tied to a Thunderbird release.

## Current features

| Feature | Trigger (from ThunderAI) | Privacy action |
|---|---|---|
| Presence/version detection | `checkPresence` | returns manifest version |

(See [`03-data-contracts.md`](03-data-contracts.md).)

## What Privacy does NOT do

- It does not build ThunderAI's menus.
- It does not store or manage ThunderAI's prompts or model configuration.

All of the above lives in **ThunderAI**. See
[`04-thunderai-integration.md`](04-thunderai-integration.md).
