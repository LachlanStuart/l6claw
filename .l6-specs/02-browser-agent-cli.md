# 02 - Browser Agent CLI

**Date:** 2026-04-04

---

## Overview

L6 Claw includes a standalone browser-agent CLI for long-lived browser automation sessions driven by a local language model. The tool is intended to be launched by L6 Claw as a subprocess, but it is also usable directly from a terminal.

The key user-visible behavior is continuity: the browser session starts once when the CLI starts, remains available across multiple prompts, and keeps website state until the process exits.

This feature exists so L6 Claw can delegate browser work to a separate agent process without embedding browser automation directly into the main app runtime.

---

## Installation And Invocation

The browser agent is packaged as a standalone Python project managed with `uv`.

It must support both:

- local execution with `uv run`
- global installation as a `uv tool`

The installed command is:

```bash
l6claw-browser-agent
```

This binary name is part of the feature contract so other tools can invoke it predictably.

### CLI Contract

The public command-line interface is:

```bash
l6claw-browser-agent [--headless | --profile] [--interactive] "<initial prompt>"
```

Rules:

- `--headless` starts a headless ephemeral browser session
- `--profile` starts a visible session using the machine's default browser profile
- `--interactive` keeps the process alive after the initial prompt and enables follow-up turns over standard input
- if neither flag is provided, the CLI starts a visible ephemeral browser session
- `--headless` and `--profile` are mutually exclusive
- after any flags, the positional argument is the initial prompt for the browser agent
- the initial prompt is required
- without `--interactive`, the CLI executes the initial prompt, emits `<<EOF>>`, and exits
- with `--interactive`, the initial prompt is executed as turn 1 before the REPL begins reading additional turns from standard input

Example:

```bash
l6claw-browser-agent --headless "Open Google and search for images of lobsters"
```

---

## Model Configuration

The CLI reads its model connection details from environment variables:

- `BROWSER_AGENT_API_KEY`
- `BROWSER_AGENT_URL`
- `BROWSER_AGENT_MODEL`

These variable names are part of the public contract and must remain stable unless the spec is updated.

If any required variable is missing, the CLI fails at startup with a clear error and does not start a browser session.

The model endpoint is expected to be compatible with either the OpenAI Chat Completions API or an Anthropic-style API, so local model servers such as LM Studio can be used.

---

## Session Modes

The CLI supports three startup modes:

### Default

A visible browser window using an ephemeral session. This is the default behavior when no explicit mode flag is provided.

### Headless

A headless browser using an ephemeral session. This is selected by a startup flag.

### Default Profile

A visible browser window using the machine's default browser profile. This is selected by a startup flag. The specific local profile is not configurable in v1: the behavior is simply "use the default profile".

Mode is chosen when the process starts and does not change at runtime.

---

## REPL Contract

The CLI behaves as a plain-text REPL over standard input and standard output only when `--interactive` is provided.

### Input

- Requests are sent as free-form text
- A request may span multiple lines
- A request ends when the CLI receives a line containing only `<<EOF>>`
- Empty requests are ignored

This delimiter is part of the subprocess contract so L6 Claw can send long natural-language instructions safely.

The required initial prompt on the command line is always processed as turn 1. In interactive mode, subsequent turns are read from standard input using the same `<<EOF>>` framing.

### Output

The CLI emits intentional text messages from the browser agent while a request is running. This allows a supervising agent to observe progress and intervene if the browser agent appears to be going off track.

Output remains text-first rather than JSON-first.

Each emitted line is prefixed by a channel label:

- `AGENT:` for browser-agent messages intended for the supervisor
- `INFO:` for lifecycle or status messages
- `ERROR:` for failures

When a request is fully complete, the CLI emits a line containing only `<<EOF>>` to mark the end of that turn's output.

---

## Session Lifetime

The browser session is process-scoped:

- starting the CLI starts a session
- in interactive mode, subsequent prompts reuse that same session
- cookies, logged-in state, open tabs, and navigation context persist across prompts while the process remains alive
- ending the process ends the browser session

Persistence across CLI restarts is not required beyond whatever the default-profile mode naturally preserves through the local browser profile.

---

## Failure Behavior

Startup failures are fatal and terminate the process immediately.

Request-level failures are reported to the caller but should not end the REPL unless the browser session has become unusable. In the normal case, a failed request is followed by another prompt in the same process.

Interrupting the process shuts down the session and exits cleanly.

Automatic hidden recovery from browser crashes is not part of this feature in v1.

---

## Intended Use From L6 Claw

L6 Claw can launch the CLI either as a one-shot subprocess for a single browser task or, with `--interactive`, as a long-lived subprocess for chat-like browser work rather than a structured RPC server.

The important compatibility points are:

- stable command name: `l6claw-browser-agent`
- stable flags and positional-argument behavior
- stable environment variable names for model connection
- stable `<<EOF>>` request/response framing
- stable mode selection via startup flags

---

## Example Interaction

Example startup:

```bash
l6claw-browser-agent --interactive "Open Google Maps and search for coffee near Alexanderplatz Berlin"
```

Example output for the initial prompt:

```text
INFO: Starting visible ephemeral browser session
AGENT: Opening Google Maps and searching for coffee near Alexanderplatz Berlin.
AGENT: I can see several nearby coffee shops. Five Elephant, Röststätte, and The Barn all appear in the results area.
<<EOF>>
```

Example follow-up turns over standard input:

```text
Zoom in and tell me which one appears closest to the station entrance.
<<EOF>>
```

```text
AGENT: Zooming in and checking the markers nearest the Alexanderplatz station entrances.
AGENT: From the currently visible map results, The Barn appears closest to one of the southwest station exits.
<<EOF>>
```

```text
Open the top result and tell me its opening hours today.
<<EOF>>
```

```text
AGENT: Opening the top result details panel.
AGENT: The top result shown in this session lists today's opening hours as 8:00 AM to 6:00 PM.
<<EOF>>
```

This example is illustrative of the contract rather than a guaranteed real-world result. What must remain consistent is the startup behavior, turn framing, and text-streaming interaction pattern.

Any future implementation may change internal code structure completely as long as these user-visible and integration-visible behaviors remain intact.
