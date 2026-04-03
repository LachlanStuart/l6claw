# 01 - Remote CLI

**Date:** 2026-04-02

## Re-implementation Notes

If this feature needs to be re-implemented (e.g. after rebasing onto a new upstream), a reference diff is available at `.l6-specs/01-remote-cli.diff`. This diff shows the changes made during the original implementation and is intended as **guidance for locating relevant areas of the codebase** — not as a precise patch to apply. File line numbers and exact code will likely differ after an upstream merge, but the diff makes it clear which files were touched and what shape the changes took.

---

## Quick Start (for CLI users)

Set your connection details once as environment variables — this avoids repeating them on every call:

```bash
export T3CODE_URL=ws://100.x.y.z:3773   # Tailnet IP of the L6 Claw host
export T3CODE_TOKEN=<token>              # From Settings → API Access in the L6 Claw UI
```

**List all threads:**

```bash
l6claw-cli threads              # Human-readable table
l6claw-cli threads --json       # Machine-readable JSON array
```

**Send a message (fire and forget):**

```bash
l6claw-cli send \
  --project "my-project" --thread "Fix the login bug" \
  --text "Run the test suite and report results." \
  --sender "Build Server"
```

**Send a message and wait for the agent's response:**

```bash
l6claw-cli send \
  --thread-id abc123-def4-5678-9012-abcdef345678 \
  --text "What is the status of the refactor?" \
  --sender "Orchestrator" \
  --wait
```

The `--wait` flag blocks until the agent finishes and prints its response text to stdout. Exit code 0 = success, 1 = error/timeout/interrupted. Use `--timeout <seconds>` to override the default 24-hour wait.

Run `l6claw-cli --help` or `l6claw-cli <command> --help` for full flag documentation.

---

## Overview

A standalone CLI tool (`l6claw-cli`) that enables remote agents to interact with L6 Claw threads over the network. The CLI connects to the L6 Claw WebSocket server and uses the existing RPC protocol to list threads and send messages.

The CLI acts as a security boundary: it exposes an allowlist of safe operations and does not permit approvals, runtime mode changes, settings mutations, thread deletion, or any other privileged operations. The remote agent can read thread state and send messages — nothing more.

## Terminology

| Term        | Definition                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project** | A workspace/repo. Has a title, workspace root directory, and zero or more threads.                                                                |
| **Thread**  | A conversation within a project. Has a title, messages, and an optional active provider session. This is the primary entity the CLI addresses.    |
| **Session** | The runtime provider state attached to a thread (Codex/Claude subprocess). Not directly addressable by the CLI.                                   |
| **Turn**    | A single user-message-to-agent-response cycle. A turn is triggered by sending a message.                                                          |
| **Sender**  | A free-form string identifying who sent an API message. Displayed in the UI next to the timestamp. Null for messages sent from the web interface. |

---

## CLI Interface Contract

### Binary Name

```
l6claw-cli
```

Built as a standalone Bun-compiled binary with no external runtime dependencies. Uses `@effect/cli` for command/option parsing, consistent with the rest of the codebase.

### Global Options

| Flag               | Env Var        | Required | Description                                                       |
| ------------------ | -------------- | -------- | ----------------------------------------------------------------- |
| `--url <url>`      | `T3CODE_URL`   | Yes      | WebSocket URL of the L6 Claw server (e.g. `ws://100.64.1.2:3773`) |
| `--token <string>` | `T3CODE_TOKEN` | Yes      | Auth token for the WebSocket connection                           |

Flag values take precedence over environment variables.

### Connection

The CLI connects via WebSocket with the auth token as a query parameter:

```
ws://<host>:<port>/?token=<auth-token>
```

If the token is invalid or missing (when the server has auth configured), the connection is rejected with HTTP 401.

### Command: `threads`

List all threads across all projects.

```
l6claw-cli threads [--json]
```

**Options:**

| Flag     | Default | Description                           |
| -------- | ------- | ------------------------------------- |
| `--json` | `false` | Output as JSON array instead of table |

**Table output format:**

```
PROJECT          THREAD                                                       ID                                   STATUS
my-project       Fix the login bug                                            abc123-def4-5678-9012-abcdef345678   running
my-project       Implement caching layer                                      def456-abc1-2345-6789-fedcba987654   ready
other-project    Set up CI pipeline for the new monorepo structure that we...  789abc-def0-1234-5678-abcdef012345   idle
```

**Table output rules:**

- Thread titles are truncated to 60 characters with `...` suffix if they exceed that length
- Archived threads (where `archivedAt` is non-null) are excluded
- Deleted threads (where `deletedAt` is non-null) are excluded
- Status is derived from the thread's session status if a session exists, otherwise `"idle"`

**JSON output format:**

```json
[
  {
    "projectName": "my-project",
    "threadTitle": "Fix the login bug",
    "threadId": "abc123-def4-5678-9012-abcdef345678",
    "sessionStatus": "running"
  }
]
```

**JSON output rules:**

- Thread titles are NOT truncated in JSON output (full title is included)
- Same exclusion rules as table output (no archived, no deleted)
- Array is sorted by project name (ascending), then thread title (ascending)

### Command: `send`

Send a message to a thread, triggering the agent to act.

```
l6claw-cli send --thread-id <id> --text <message> --sender <name> [--wait] [--timeout <seconds>]
l6claw-cli send --project <name> --thread <name> --text <message> --sender <name> [--wait] [--timeout <seconds>]
```

**Options:**

| Flag                  | Required                                                    | Default            | Description                                                                 |
| --------------------- | ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| `--thread-id <id>`    | One of `--thread-id` or (`--project` + `--thread`) required |                    | Target thread by ID                                                         |
| `--project <name>`    | See above                                                   |                    | Target project by name (case-insensitive match)                             |
| `--thread <name>`     | See above                                                   |                    | Target thread by title (case-insensitive match, must pair with `--project`) |
| `--text <message>`    | Yes                                                         |                    | Message text to send                                                        |
| `--sender <name>`     | Yes                                                         |                    | Sender identity displayed in the UI (max 32 characters)                     |
| `--wait`              | No                                                          | `false`            | Block until the agent finishes responding                                   |
| `--timeout <seconds>` | No                                                          | `86400` (24 hours) | Maximum wait time in seconds (only applies when `--wait` is set)            |

**Thread resolution:**

Regardless of whether `--thread-id` or `--project`+`--thread` is used, the CLI always fetches the full thread snapshot first to:

1. Validate the thread exists
2. Read the thread's current `runtimeMode` (echoed back in the command to avoid changing it)
3. Check the thread does not already have an active turn running

**When using `--project` + `--thread`:**

1. Find the project where `project.title` matches `--project` (case-insensitive)
2. Find the thread where `thread.title` matches `--thread` (case-insensitive) within that project
3. If zero matches: exit 1 with error message
4. If multiple matches: exit 1 with error listing the ambiguous matches

**When using `--thread-id`:**

1. Find the thread where `thread.id` matches `--thread-id`
2. If not found: exit 1 with error message

**Pre-send validation:**

- If the resolved thread has an active turn in progress: exit 1 with error `"Thread has an active turn in progress"`. The CLI does not queue or interrupt — the caller must wait and retry.

**Fire-and-forget mode (no `--wait`):**

Dispatches the command and prints acknowledgment to stdout:

```json
{ "status": "accepted", "turnId": null }
```

Note: `turnId` is null because turn IDs are assigned asynchronously by the provider, not at command dispatch time. Exit code 0.

**Wait mode (`--wait`):**

Dispatches the command, subscribes to server push events, and blocks until the turn completes:

- **Success:** prints each assistant message text to stdout (one per line, in order), exit code 0
- **Error:** prints any assistant text collected so far to stdout, prints error info to stderr as `{"status": "error", "turnId": "<id>"}`, exit code 1
- **Timeout:** prints any assistant text collected so far to stdout, prints to stderr as `{"status": "timeout", "turnId": "<id>"}`, exit code 1
- **Interrupted:** same pattern, stderr `{"status": "interrupted", "turnId": "<id>"}`, exit code 1

The CLI must subscribe to push events **before** dispatching the command to prevent race conditions. A single turn may produce multiple assistant messages (the agent may speak, run tools, then speak again). All are collected in event order.

**Security constraint:** The `runtimeMode` is always echoed from the thread's current state — the CLI never changes it. The `interactionMode` is always set to `"default"`. This ensures the CLI cannot escalate a thread's permissions.

---

## Sender Field on Messages

Messages now carry an optional `sender` field:

| Field    | Type             | Default | Constraint                                           |
| -------- | ---------------- | ------- | ---------------------------------------------------- |
| `sender` | `string \| null` | `null`  | Max 32 characters, truncated server-side if exceeded |

Messages sent from the web UI have `sender: null` and render exactly as they do without this feature. Messages sent via the CLI (or any future API client) carry the sender string provided by the caller.

### Sender Indicator in the UI

**Location:** User messages in the messages timeline.

**Rendering rule:** If `message.sender` is non-null and `message.role` is `"user"`, display the sender name inline, immediately to the left of the timestamp.

**Styling:**

- No border, no background, no pill/badge
- Muted accent colour (distinct from the timestamp colour but similarly understated)
- Same font size and weight as the timestamp
- The sender text and timestamp together form a single visual line

**When `sender` is null:** No change to existing rendering.

---

## Auth Token

### Token Lifecycle

| Priority    | Source                                                 | Persistence                                      |
| ----------- | ------------------------------------------------------ | ------------------------------------------------ |
| 1 (highest) | `T3CODE_AUTH_TOKEN` env var or `--auth-token` CLI flag | Never persisted (runtime only)                   |
| 2           | `authToken` field in `settings.json`                   | Persisted (user opted in)                        |
| 3 (lowest)  | Auto-generated on startup                              | In-memory only (ephemeral, changes each restart) |

**Auto-generation:** On startup, if no token is available from priorities 1 or 2, generate a cryptographically random 32-byte hex string and hold it in memory for the session.

**Persistence opt-in:** The UI provides a checkbox to persist the current token. When checked, the token is written to `settings.json`. When unchecked, the token is removed from `settings.json` (continues working for current session, regenerated on next restart).

### API Access Section in Settings

**Location:** Settings view in the web app.

**Contents:**

| Element              | Description                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| **Endpoint URL**     | Read-only text showing `ws://<host>:<port>` computed from the server's actual bind address and port |
| **Auth Token**       | Read-only text field, masked by default, with reveal and copy buttons                               |
| **Persist checkbox** | "Persist across restarts" — toggles whether the token is saved to `settings.json`                   |

The token field is always read-only in the UI. To use a custom token, set it via the `T3CODE_AUTH_TOKEN` env var or `--auth-token` CLI flag.

### Desktop Runtime Requirement

When L6 Claw runs as the desktop app, the embedded server must follow the same stable port selection rules as the standalone server instead of reserving a fresh ephemeral port on each launch.

- If `T3CODE_HOST` is set, the desktop app must bind the embedded server to that host/interface.
- If `T3CODE_HOST` is unset, the desktop app must use the normal desktop default host `127.0.0.1`.
- If `T3CODE_PORT` is set, the desktop app must bind the embedded server to that port.
- If `T3CODE_PORT` is unset, the desktop app must use the normal desktop default port `3773`.
- Restarting the desktop app must not change the host or port unless the configured values change.

This host override must work when the desktop app is launched through the normal project task runner (`bun run start:desktop`), not only when Electron is started directly.

This requirement exists so local helper processes and external automation can reconnect to the desktop-hosted WebSocket endpoint without rediscovering a new port after every restart.

---

## Security Model

The CLI is a **security boundary** that exposes only safe operations to remote agents.

### Allowed Operations

| Operation                | Risk                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| List threads (read-only) | None — read-only snapshot of project/thread metadata and messages                                                                 |
| Send user message        | Low — equivalent to typing in the chat. The thread's existing runtime mode governs whether the agent needs approval for tool use. |

### Explicitly Disallowed Operations

The CLI does not expose and must not be extended to expose:

| Operation                      | Why Disallowed                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Approve/decline tool execution | Remote agent must not be able to bypass human approval gates                      |
| Change runtime mode            | Remote agent must not escalate a thread from `approval-required` to `full-access` |
| Delete/archive threads         | Destructive operation, local user only                                            |
| Modify settings                | Server configuration is local user only                                           |
| Create/delete projects         | Workspace management is local user only                                           |
| Write files                    | Direct filesystem access is local user only                                       |
| Terminal access                | Shell access is local user only                                                   |

### Trust Model

- Anyone with the auth token is trusted to perform allowed operations
- The token is the sole authentication mechanism
- Network security (Tailnet WireGuard encryption, ACLs) is assumed to provide transport security
- The sender field is self-declared and trusted — there is no server-side identity verification beyond the token

---

## Error Handling

### CLI Exit Codes

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | Success                                                                                                |
| 1    | Error (connection failure, auth failure, timeout, command rejected, thread not found, ambiguous match) |

### Error Output

All errors are printed to stderr as human-readable messages. In `--wait` mode, structured status is also printed to stderr as JSON (see `send` command spec above).

### Connection Errors

| Scenario                    | Behavior                                                            |
| --------------------------- | ------------------------------------------------------------------- |
| Server unreachable          | Exit 1 with "Connection failed: <url>"                              |
| Auth rejected (401)         | Exit 1 with "Authentication failed: invalid token"                  |
| Connection lost during wait | Exit 1 with partial output + `{"status": "error", "turnId": "..."}` |

### Send Errors

| Scenario                   | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| Thread not found           | Exit 1 with "Thread not found: <id or name>"        |
| Ambiguous name match       | Exit 1 with "Multiple threads match: <list>"        |
| Thread has active turn     | Exit 1 with "Thread has an active turn in progress" |
| Command rejected by server | Exit 1 with server error message                    |

---

## Data Compatibility

### settings.json

**New field:**

| Field       | Type     | Presence                                               | Description                                                                                                     |
| ----------- | -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `authToken` | `string` | Optional — only present when user has opted to persist | The auth token for WebSocket connections. When absent, the server generates an ephemeral token on each startup. |

This field is added or removed by the UI "Persist across restarts" checkbox. It is never auto-written by the server.

### Database Migration

A fork migration adds a `sender` column (`TEXT`, nullable) to the `projection_thread_messages` table. This migration should be idempotent (check if the column exists before altering).

---

## Future Considerations (Not In Scope)

These are documented for context but are explicitly out of the initial implementation:

- **Read-only thread inspection commands** (e.g., `l6claw-cli thread <id>` to view messages, tool calls, activities) — noted as a likely future addition
- **REST API** — if needed later, can be added as HTTP routes on the existing server
- **Polling endpoint for async turns** — a status endpoint could supplement the fire-and-forget mode
- **Thread creation via CLI** — remote agents can only send to existing threads
- **Multiple API keys with named identities** — current model uses a single token with self-declared sender names
