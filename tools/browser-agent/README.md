# Browser Agent CLI

Standalone `uv` project that exposes the `l6claw-browser-agent` command described in [`.l6-specs/02-browser-agent-cli.md`](../../.l6-specs/02-browser-agent-cli.md).

## Install

Local run:

```bash
uv run l6claw-browser-agent --help
```

Global install as a `uv` tool:

```bash
uv tool install ./tools/browser-agent
```

## Required Environment

```bash
export BROWSER_AGENT_API_KEY=...
export BROWSER_AGENT_URL=http://127.0.0.1:26478
export BROWSER_AGENT_MODEL=...
```

## Examples

Visible ephemeral session:

```bash
uv run l6claw-browser-agent "Open example.com and tell me what you see"
```

Headless session:

```bash
uv run l6claw-browser-agent --headless "Open Google and search for images of lobsters"
```

Default-profile session:

```bash
uv run l6claw-browser-agent --profile "Open github.com and tell me whether I appear to be signed in"
```

Interactive mode:

```bash
uv run l6claw-browser-agent --interactive "Open example.com and await further instructions"
```

In interactive mode, follow-up turns use stdin blocks terminated by `<<EOF>>`.
