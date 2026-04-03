# AGENTS.md

## L6 Claw Fork Conventions

This is a fork of T3 Code. The following rules apply to all work on this fork:

### Migrations

Migrations added in this fork **must** use the fork migrations mechanism in `apps/server/src/persistence/ForkMigrations.ts`. Never add entries to the upstream `Migrations.ts` migration list. Fork migrations use a separate tracking table (`effect_sql_fork_migrations`) with independent numbering, so they never conflict with upstream migrations.

### Surgical Changes

Code changes should be surgical and self-contained to minimise merge conflicts with the upstream branch. Prefer appending to files over inserting into the middle. Avoid renaming variables, filenames, or restructuring upstream code.

### PR Target

PRs must target the fork repo https://github.com/LachlanStuart/l6claw — **not** the upstream repo.

### Spec Files

All features added in this fork must have a high-level spec in `.l6-specs/` that enables re-implementation from scratch. Spec files are numbered (e.g. `00-fork-setup.md`, `01-remote-cli.md`).

Specs should:

- Explain the purpose and motivation from the user's perspective
- Detail user-observable behaviour so the UX is preserved even if re-implemented completely differently
- Optionally include recommendations for settings file structure and database migrations for data compatibility
- Avoid referencing specific code unless it directly affects user experience — the purpose is to survive a complete codebase rewrite

If a feature already has a spec, the spec must be kept up to date when the feature changes.

### Spec Diffs

Specs may optionally have a `.diff` file alongside them showing changes from the first implementation. This diff is guidance for locating relevant code areas, not an exact patch. The diff should exclude the spec `.md` files themselves — it only covers code changes. Diffs are not updated for minor changes but may be regenerated if a feature is re-implemented from scratch.

### README

The L6 Claw section at the top of `README.md` includes a bullet-point list of implemented specs, each linking to its `.l6-specs/*.md` file. This list must be updated with each new spec.

---

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
