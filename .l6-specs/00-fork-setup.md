# 00 - Fork Setup

**Date:** 2026-04-03

---

## Overview

L6 Claw is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code) that extends it with OpenClaw-like agentic capabilities. Many of these extensions are inappropriate for merging into T3 Code given its different vision. However, T3 Code is undergoing active development and this fork wishes to inherit its features by regularly merging from upstream.

This spec covers the foundational fork setup: rebranding, migration isolation, development conventions, and documentation structure. Everything here exists to make the fork sustainable as the upstream evolves.

---

## Rebranding

### User-Visible Name

The application is rebranded from "T3 Code" to "L6 Claw" in all user-facing surfaces:

- Browser tab title
- Sidebar logo aria-label
- Settings panel descriptions and messages
- Desktop app window titles, dialog messages, and product name
- Desktop update notification messages
- Mac menu bar application name (Electron launcher `CFBundleDisplayName`)
- Any other presentational elements that show "T3 Code" — a search for `\bT3\b` is recommended

### What Does NOT Change

- No variable names, type names, or filenames are renamed. This would create unnecessary merge conflicts with upstream.
- No package names change (`@t3tools/*` stays as-is).
- No internal identifiers change.
- Environment variable names (`T3CODE_HOME`, `T3CODE_PORT`, etc.) remain unchanged for compatibility.
- The T3 Code branding in the README body (installation instructions, etc.) remains untouched.
- `LEGACY_USER_DATA_DIR_NAME` in the desktop app retains the old "T3 Code" name (used for data migration from the original directory).

### Branding Constant

The web app uses a single `APP_BASE_NAME` constant in `apps/web/src/branding.ts`. Changing this value propagates the rebrand to all UI locations that reference it. Locations that use hardcoded strings need individual changes.

---

## README

A new section is added at the very top of `README.md`, before the existing T3 Code content. This section:

1. Introduces L6 Claw as a fork built on T3 Code, with a link to the upstream repo
2. Briefly explains the fork's purpose
3. Lists all implemented specs as bullet points, each linking to its `.l6-specs/*.md` file
4. Gratefully acknowledges the upstream project

The rest of the T3 Code README content remains completely unaltered below this section.

---

## Fork Migrations

### Problem

T3 Code uses Effect SQL Migrator with strictly sequential integer IDs. The migrator tracks a single high-water mark: it finds the highest `migration_id` in the database and only runs migrations with IDs strictly greater than that value. It never backtracks.

This means:

- Fork migrations cannot use high IDs (e.g. 9001) because that would cause all subsequently-added upstream migrations to be silently skipped
- Fork migrations cannot share the same ID sequence as upstream because every upstream merge would require renumbering

### Solution

Fork-specific migrations use a **separate migration runner** with its own tracking table (`effect_sql_fork_migrations`), completely independent of the upstream tracking table (`effect_sql_migrations`).

- Upstream migrations are registered in `apps/server/src/persistence/Migrations.ts` (unchanged from upstream)
- Fork migrations are registered in `apps/server/src/persistence/ForkMigrations.ts` (new file)
- Fork migration files live in `apps/server/src/persistence/ForkMigrations/` (new directory)
- Fork migration IDs start at 1 and increment independently
- The `MigrationsLive` layer runs upstream migrations first, then fork migrations sequentially

### Idempotency

Fork migrations must be idempotent (check before altering) because:

- A database may have had a fork migration's changes applied manually or via a previous numbering scheme
- The fork tracking table is new, so existing databases won't have any fork migration history

The established pattern (from upstream migration 017) is to check `PRAGMA table_info(...)` before issuing `ALTER TABLE ADD COLUMN`.

### Database Location

The SQLite database is at `<stateDir>/state.sqlite` where `stateDir` is:

- Dev mode (`--dev-url` set): `<baseDir>/dev/`
- Production mode: `<baseDir>/userdata/`

Dev and production instances have completely independent databases and settings.

---

## Default Data Directory

The default base directory is changed from `~/.t3` to `~/.l6` so that L6 Claw operates as a completely separate application from T3 Code, with its own database, settings, worktrees, and logs.

The `T3CODE_HOME` environment variable and `--base-dir` CLI flag can still override this, but when neither is set, L6 Claw defaults to `~/.l6` rather than the upstream `~/.t3`.

---

## Development Conventions (CLAUDE.md)

The following rules are added to `CLAUDE.md` for AI agents working on this fork:

### Migrations

- Migrations added in this fork use the fork migrations mechanism (`ForkMigrations.ts`), never the upstream migrations file.

### Surgical Changes

- Code changes should be surgical and self-contained to minimise conflicts with the upstream branch.

### PR Target

- PRs target the fork repo (https://github.com/LachlanStuart/l6claw), not the upstream repo.

### Spec Files

- All features added in this fork must have a spec in `.l6-specs/` that enables re-implementation from scratch.
- Specs explain purpose/motivation from the user's perspective and detail user-observable behaviour.
- Specs may include recommendations for settings file structure and database migrations for data compatibility.
- Specs should avoid referencing specific code unless it directly affects user experience. The purpose is to survive a complete codebase rewrite.
- If a feature already has a spec, it must be kept up to date when the feature changes.

### Spec Diffs

- Specs may optionally have a `.diff` file alongside them, showing the changes from the first implementation.
- The diff should exclude the spec `.md` files themselves — it only covers code changes.
- The diff is guidance for locating relevant code areas, not an exact patch.
- Diffs are not updated for minor changes but may be regenerated if a feature is re-implemented from scratch.

### README

- The L6 Claw README section includes a bullet-point list of implemented specs, each linking to its markdown file. This list must be updated with each new spec.
