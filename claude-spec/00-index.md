# claude-spec

Architecture and design documentation for **ThunderAI Privacy**, written for AI
agents (and humans) working in this repo.

Start with [`../CLAUDE.md`](../CLAUDE.md) for the high-level picture, then read
the docs here for detail.

## Documents

- [`01-overview.md`](01-overview.md) — what Privacy is, why it exists as a separate
  add-on, and its relationship to ThunderAI.
- [`02-architecture.md`](02-architecture.md) — components and the message flow
  between ThunderAI and Privacy.
- [`03-data-contracts.md`](03-data-contracts.md) — the exact message actions and
  payloads exchanged with ThunderAI.
- [`04-thunderai-integration.md`](04-thunderai-integration.md) — the companion-add-on
  boundary: what lives in ThunderAI (prompts, LLM, menus) vs. what lives here.

## The one thing to remember

> **Privacy is a companion of ThunderAI, and a standard WebExtension.** Menus,
> prompts and model configuration live in ThunderAI; Privacy only does the work
> ThunderAI asks for over cross-extension messaging. It uses no experimental
> APIs. See [`04-thunderai-integration.md`](04-thunderai-integration.md).
