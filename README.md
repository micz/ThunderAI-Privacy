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
add-ons. In ThunderAI Privacy settings, download the model and enable filtering.
Activation requires a compatible ThunderAI. If the companion disappears while active,
ThunderAI blocks rather than silently sending unfiltered data. Explicitly disable
filtering in Privacy before removing it if you want to resume unprocessed requests.
Model caches are extension-local: an older built-in ThunderAI cache is not shared.

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
