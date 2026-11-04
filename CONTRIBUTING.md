# Contributing to ThunderAI Privacy

Thank you for your interest in contributing to ThunderAI Privacy!
This page explains how to report issues, help with translations and open pull requests.

ThunderAI Privacy is a companion add-on for [ThunderAI](https://github.com/micz/ThunderAI):
the menus, the prompts and the AI model configuration live in ThunderAI, which drives
this add-on through cross-extension messaging. A change that needs a new menu entry, a
prompt change or a change in what ThunderAI sends to the model belongs (at least partly)
to the [ThunderAI repository](https://github.com/micz/ThunderAI).

## Reporting bugs and requesting features

Please open an issue using the [bug report or feature request templates](https://github.com/micz/ThunderAI-Privacy/issues/new/choose).
Before opening a new issue, check whether a similar one already exists.

Issues about ThunderAI itself (prompts, providers, menus) belong to the [ThunderAI issue tracker](https://github.com/micz/ThunderAI/issues).

## Translations

Translations are managed on [Weblate](https://hosted.weblate.org/engage/thunderai/).
Please **do not edit the locale files directly**: the only file edited by hand is `_locales/en/messages.json`.
If your change adds or modifies user-facing strings, update only the English file; the other languages will be updated through Weblate.

More information: [How to translate ThunderAI](https://micz.it/thunderbird-addon-thunderai/translate/).

## Release notes and changelog

Please **do not edit `CHANGELOG.md`**: it is generated automatically from the release notes and committed by a GitHub workflow.
If your change needs to be mentioned in the release notes, edit only `options/mztap-release-notes.html`.

## No experimental APIs

ThunderAI Privacy is a standard WebExtension: it does not use Thunderbird
[experimental APIs](https://developer.thunderbird.net/add-ons/mailextensions/experiments)
and does not ask for full permissions. Please keep it that way: if a feature seems to need
privileged access, open an issue to discuss it before writing the code.

## Branches

| Branch | Purpose |
| ------ | ------- |
| `main` | Released code. It always matches the latest version published on [addons.thunderbird.net](https://addons.thunderbird.net/thunderbird/addon/thunderai-privacy/). |
| `dev`  | Ongoing development. The next release is built from here. |

### Which branch should my pull request target?

**Target `dev`** for almost everything: new features, improvements, refactoring, documentation and non-urgent bug fixes.

**Target `main` only for urgent bug fixes** to the released version, for example:

- a crash or a feature that is completely broken;
- a regression introduced by the latest release;
- a change in ThunderAI's messaging contract that makes the companion stop working;
- a security or privacy issue.

If you are not sure, target `dev` and explain the urgency in the pull request: the fix can still be moved to `main` if needed.

> Pull requests opened on `main` are automatically retargeted to `dev`, unless the source branch name starts with `hotfix/`.
> For an urgent fix, name your branch like `hotfix/short-description`.

## Opening a pull request

1. Fork the repository and create your branch:
   - from `dev` for regular changes: `git switch -c my-feature origin/dev`
   - from `main` for urgent fixes: `git switch -c hotfix/short-description origin/main`
2. Keep the pull request focused on a single change. Smaller pull requests are reviewed faster.
3. Test your change in Thunderbird (see below).
4. Open the pull request against the correct branch and fill in the template.

If GitHub reports conflicts, please update your branch by merging or rebasing the target branch into it.

### Testing your change

ThunderAI Privacy requires **Thunderbird 153.0 or later (64-bit)** and a compatible ThunderAI build.

To load your local copy without packaging it:

1. In Thunderbird, open *Tools → Developer Tools → Debug Add-ons*.
2. Click *Load Temporary Add-on…* and select the `manifest.json` file in your working copy.
3. Load ThunderAI the same way (or install it from the add-on page), then download the model and turn the protection on from the settings.
4. Use *Reload* after each change.

The automated contract and lifecycle checks run with Node.js 22+:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
```

See [`tests/README.md`](tests/README.md) for details. These checks mock the extension APIs and the local model; they do not measure detection quality, so please also test in Thunderbird.

If your change touches the messaging contract with ThunderAI, mention in the pull request which ThunderAI version you tested with: a contract change needs a matching change in the ThunderAI repository.

## License

ThunderAI Privacy is released under the [GNU General Public License v3.0](LICENSE).
By contributing, you agree that your contributions will be licensed under the same license.
