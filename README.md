# L6 Claw (built on [T3 Code](https://github.com/pingdotgg/t3code))

L6 Claw is a personal fork of T3 Code that extends it with agentic capabilities for multi-agent orchestration and remote control. This fork regularly merges from upstream to inherit T3 Code's ongoing development, while maintaining its own feature set via self-contained, spec-driven additions.

Huge thanks to the T3 Code team for building and open-sourcing the foundation this project is built on.

### Implemented Features

- [00 - Fork Setup](.l6-specs/00-fork-setup.md) — Rebranding, fork migration isolation, and development conventions
- [01 - Remote CLI](.l6-specs/01-remote-cli.md) — CLI tool for remote agents to interact with threads over WebSocket

---

# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
