---
name: l6claw-browser-agent
description: Use when a task needs a browser controlled through the repo's l6claw-browser-agent CLI, especially for website interaction, persistent browsing sessions, or one-shot browser automation from this codebase
---

# L6 Claw Browser Agent

## Overview

Use `tools/browser-agent/` when a task should be executed in a real browser through the repo's standalone browser-use wrapper.

## Quick Reference

- Preferred command from the repo root: `uv run --project tools/browser-agent l6claw-browser-agent`
- One-shot default: `uv run --project tools/browser-agent l6claw-browser-agent "Open example.com and summarize the page"`
- Interactive mode: `uv run --project tools/browser-agent l6claw-browser-agent --interactive "Open example.com and await further instructions"`
- Headless mode: add `--headless` only when the user explicitly asks for it
- Default profile mode: add `--profile`
- In this repo, prefer launching from the repository root with `--project tools/browser-agent` instead of `cd tools/browser-agent` first. That preserved the required `BROWSER_AGENT_*` environment more reliably in practice.
- The browser agent can be slow on real sites, and the local model may take up to 3 minutes before producing any output. Do not assume a stall early and do not repeatedly poll or relaunch the command during that window.
- Wait for the agent's own `<<EOF>>` turn marker before assuming a turn has completed.

## Environment

- The browser-agent runtime expects `BROWSER_AGENT_API_KEY`, `BROWSER_AGENT_URL`, and `BROWSER_AGENT_MODEL` to already be available in the environment that launches it.
- Do not manually re-export or restate those values in prompts unless the runtime is actually missing them.
- If `BROWSER_AGENT_URL` is a bare LM Studio host, the wrapper normalizes it to include `/v1`.
- If a PTY-backed launch does not inherit the `BROWSER_AGENT_*` variables, verify that first before retrying. If needed, explicitly export the already-present values into the launch command rather than starting more sessions.

## Interactive Protocol

- In one-shot mode, the process exits after the initial prompt finishes.
- In `--interactive` mode, follow-up turns are sent on `stdin`.
- Every message sent to the browser agent must be suffixed with a line containing only `<<EOF>>`.
- After sending a turn, wait for the browser agent to emit its own standalone `<<EOF>>` line before sending the next turn.
- Treat that returned `<<EOF>>` as the end-of-turn marker for the browser agent's response stream.
- Output is line-oriented with `AGENT:`, `INFO:`, and `ERROR:` prefixes.
- For benchmarking or other multi-turn work, prefer a single interactive session over multiple one-shot launches. Do not start another session while one is still unresolved.
- If the first turn has produced no output yet, wait up to 3 minutes before intervening unless there is a clear fatal error.
- If the session becomes unusable or the launch path was wrong, clean up the broken process tree before retrying. Check for existing `l6claw-browser-agent`, `uv run --project tools/browser-agent`, and related `tee`/helper processes so redundant sessions are not left behind.
- If launch or interaction still looks broken after one careful retry and cleanup, stop and escalate to the user instead of spawning more sessions.

## Logging

Before long-running verification, tell the user which log file you will tee output into so they can watch it live.
