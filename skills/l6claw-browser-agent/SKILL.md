---
name: l6claw-browser-agent
description: Use when a task needs a browser controlled through the repo's l6claw-browser-agent CLI, especially for website interaction, persistent browsing sessions, or one-shot browser automation from this codebase
---

# L6 Claw Browser Agent

## Overview

Use `tools/browser-agent/` when a task should be executed in a real browser through the repo's standalone browser-use wrapper.

## Quick Reference

- Command: `uv run l6claw-browser-agent`
- One-shot default: `uv run l6claw-browser-agent "Open example.com and summarize the page"`
- Interactive mode: `uv run l6claw-browser-agent --interactive "Open example.com and await further instructions"`
- Headless mode: add `--headless`
- Default profile mode: add `--profile`

## Required Environment

- `BROWSER_AGENT_API_KEY`
- `BROWSER_AGENT_URL`
- `BROWSER_AGENT_MODEL`

If `BROWSER_AGENT_URL` is a bare LM Studio host, the wrapper normalizes it to include `/v1`.

## Interactive Protocol

- In one-shot mode, the process exits after the initial prompt finishes.
- In `--interactive` mode, follow-up turns are sent on `stdin`.
- Each turn ends with a line containing only `<<EOF>>`.
- Output is line-oriented with `AGENT:`, `INFO:`, and `ERROR:` prefixes.

## Logging

Before long-running verification, tell the user which log file you will tee output into so they can watch it live.
