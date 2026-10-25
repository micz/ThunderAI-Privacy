# ![ThunderAI-Privacy icon](images/icon-32px.png "ThunderAI-Privacy") ThunderAI-Privacy
ThunderAI Privacy is an add-on for Thunderbird, designed to add privacy features to ThunderAI.

> [!IMPORTANT]
> Privacy is a companion add-on: it does nothing on its own.
> To use it, you first need to install [ThunderAI](https://github.com/micz/ThunderAI).

> [!NOTE]
> If you need to open an issue, use this repository: https://github.com/micz/ThunderAI-Privacy/issues

<br>


## Features
* Local, best-effort personal-data detection with WebGPU or CPU/WASM.
* Masks ThunderAI prompts, follow-ups, provider instructions and automatic features.
* Restores responses locally; provider conversation history stays masked.
* Overlapping chunk processing for long inputs, with progress and cancellation.
* Companion-owned settings, model download/deletion and opt-in sensitive diagnostics.
* Companion-owned Web input and restored response/diff windows; originals stay out
  of the provider's page. Diagnostics log hook content, not provider HTTP requests.

Detection can miss data. Direct input into ChatGPT, existing conversations and
project/custom-GPT content are outside ThunderAI's protection.

<br>

## How it works
ThunderAI Privacy is a companion of ThunderAI: the menus, the prompts and the AI model configuration all live in ThunderAI.

ThunderAI talks to Privacy through cross-extension messaging, and Privacy only takes care of the privacy-related work it is asked to do.

<br>

## Installation
Install both add-ons from the [ThunderAI add-on page](https://micz.it/thunderbird-addon-thunderai/#privacy).
<br>

## Compatibility

| ThunderAI Privacy | Requires ThunderAI | Thunderbird |
|---|---|---|
| 1.0.0 | Processing API v1 build (target 5.2.0) | 153+ (64-bit) |

### Development setup

Load this repository's `manifest.json` and the sibling ThunderAI build as temporary
add-ons. Download the model (step 1 of ThunderAI Privacy settings, or "Download the
model" in ThunderAI's advanced options), then turn the protection on (step 2): it cannot
be turned on before the model is ready. The switch is ThunderAI's "Use ThunderAI
Privacy" option; the toggle in Privacy's settings is the same switch, so activation
requires a compatible ThunderAI. Hugging Face access is a required permission, so the
download needs no extra prompt and runs in the background. If the companion disappears while the switch is on, ThunderAI blocks rather
than silently sending unfiltered data. Switch it off before removing Privacy if you
want to resume unprocessed requests.
Model caches are extension-local: an older built-in ThunderAI cache is not shared.
The model is pinned to an immutable revision (see `VENDORS_INFO.md`). Old floating-main
downloads must be downloaded again explicitly. If Thunderbird evicts model cache
files, requests block until the model is downloaded again; filtering is not disabled.

### Disabling or uninstalling

Switch filtering off (in Privacy's settings or in ThunderAI's advanced options)
**before** disabling/removing the add-on if you want ThunderAI to resume unprocessed
new requests. If the companion disappears unexpectedly while the switch is on,
ThunderAI keeps requests blocked; re-enable Privacy, or switch off "Use ThunderAI
Privacy" in ThunderAI's advanced options to clear that requirement.

Nonempty provider prompt-cache/safety identifiers are pseudonymized with a local
installation key, preserving stability without sending their original values.
Clearing Privacy's storage changes those pseudonyms.

Recognizable changed or incomplete privacy placeholders in AI response content block
restoration/insertion with a specific error instead of guessing personal values.
This does not guarantee recognition if the AI rewrites the namespace itself.
Display-only reasoning and provider errors restore exact tokens but leave changed
fragments literal, without blocking otherwise usable content.

<br>

## Changelog
ThunderAI-Privacy's changes are logged [here](CHANGELOG.md).


<br>

## Privacy and Permissions
This add-on is a standard WebExtension: it does **not** use Thunderbird experimental APIs, so it does not ask for full permissions.

<br>

## Support this addon!
Are you using this addon in your Thunderbird?
<br>Consider to support the development making a small donation. [Click here!](https://www.paypal.com/donate/?business=UHN4SXPGEXWQL&no_recurring=1&item_name=Thunderbird+Addon+ThunderAI-Privacy&currency_code=EUR)
