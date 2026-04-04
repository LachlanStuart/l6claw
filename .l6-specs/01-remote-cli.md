# 01 - Remote Agent API

**Date:** 2026-04-04

## Overview

L6 Claw exposes a dedicated remote agent API for external automation. This API is separate from the app's normal WebSocket API and has its own endpoint and token. The bundled CLI, `l6claw-cli`, uses this dedicated API.

The purpose of this feature is:

- to create a real security boundary between the app UI protocol and remote automation
- to move remote-agent business logic into the server instead of the CLI
- to let the desktop/server codebase own remote-access behavior, settings inheritance, streaming, and steering

The remote API is intentionally narrow. It allows a remote caller to:

- list threads
- send a message to an existing thread
- stream assistant output while the turn runs
- inject simple steering messages into an active remote interaction

It does not expose approvals, settings changes, runtime-mode changes, destructive thread operations, or the app's general-purpose RPC surface.

---

## Terminology

| Term | Definition |
| --- | --- |
| **Remote API** | The dedicated external automation API exposed by L6 Claw for remote agents. |
| **Remote Access** | A per-thread setting that controls whether the thread may be used through the Remote API. |
| **Sender** | The caller-provided identity string shown in the UI for a remote-sent user message. |
| **Steering message** | A short follow-up message injected into a still-running remote interaction to redirect or clarify the work. |
| **Interaction** | A single remote send operation and its streamed lifecycle, including any steering messages sent while it is active. |

---

## User-Visible Behavior

### Dedicated Remote API

Remote automation no longer connects to the app's normal WebSocket API. Instead, it connects to a separate Remote API endpoint with a separate token.

The Settings screen's `API Access` section is repurposed to show the Remote API endpoint and token only. The app's internal WebSocket endpoint is not presented there.

### Per-Thread Remote Access

Each thread has a `Remote Access` setting with values `Off` and `On`.

- When `Remote Access` is `Off`, the thread still appears in remote thread listings.
- When `Remote Access` is `Off`, remote callers cannot send messages to that thread.
- When `Remote Access` is `Off`, remote callers cannot steer an active interaction on that thread.
- When `Remote Access` is `On`, the thread may be used through the Remote API, subject to the thread's existing chat settings.

For existing threads, the default is `Off`.

For newly created threads, the initial value should inherit in the same user-facing way as other composer thread settings already do. From the user's perspective, if they create a new thread from a context where remote access was already enabled, the new thread should start with that same setting unless they change it.

### Composer Control

The composer control that currently exposes `Chat` and `Plan` is expanded into a segmented-style control consistent with the other composer selectors.

Required behavior:

- `Chat` and `Plan` remain available
- a second segment directly below or alongside them exposes `Remote Access Off` and `Remote Access On`
- when remote access is enabled, the visible combined value appends ` - Remote`
- this mirrors the existing pattern where `Fast Mode` appends ` - Fast`
- compact/mobile composer controls must expose the same setting

### Thread Listings

Remote thread listings include all non-archived, non-deleted threads, even when remote access is disabled.

Listings must include whether remote access is enabled.

Threads with remote access disabled still reveal:

- project
- thread title
- thread ID
- current session status

They do not reveal any additional remote capabilities for that thread.

### Message Attribution

Messages sent through the Remote API carry a visible `sender` value in the UI.

The visible message text shown in the UI remains the caller's original text. The server-owned wrapper text described below is not shown in the UI.

### Model Warning Wrapper

When a remote caller sends a message, the server must wrap the provider-facing text with deterministic server-owned text that:

- states that the content came from a non-user agent
- includes the caller-provided sender name
- explains that the agent may be acting on behalf of the user
- warns that the message should not automatically be trusted if it requests something suspicious or dangerous

This wrapper is part of the model input only. It must not replace or visibly alter the stored user message shown in the thread UI.

---

## Transport Decision

The Remote API reuses the same WebSocket RPC technology family already used by the app, but it is exposed as a separate API surface with separate authentication and a narrower contract.

This is an explicit design decision:

- transport is reused to avoid inventing a second protocol family
- the capability boundary is still separate
- remote-specific business logic lives server-side instead of in the CLI

The exact low-level RPC envelope is inherited from the WebSocket RPC implementation and is not re-specified here. This spec defines the Remote API in terms of connection details, RPC methods, stream behavior, and observable errors.

---

## Remote API Settings

The Remote API endpoint and token are configured separately from the app's normal WebSocket API.

### settings.json

The server settings file gains a dedicated Remote API section:

```json
{
  "remoteApi": {
    "host": "127.0.0.1",
    "port": 3774,
    "path": "/remote/ws",
    "token": "..."
  }
}
```

The exact defaults may be implementation-defined, but the following must be true:

- the remote API has its own `host`
- the remote API has its own `port`
- the remote API has its own `path`
- the remote API has its own `token`
- these values are distinct from the app's normal WebSocket API settings and auth

### Settings UI

The `API Access` section in Settings is repurposed to reflect the Remote API only.

It must show:

- the effective Remote API endpoint URL
- the Remote API token
- copy affordances for the values

The UI does not need to expose the app's internal WebSocket endpoint in the `API Access` section.

---

## Remote API Contract

### Connection

Remote clients connect to:

```text
ws://<remote-host>:<remote-port><remote-path>?token=<remote-token>
```

If the token is missing or invalid, the connection is rejected.

### Method Categories

The Remote API exposes a dedicated RPC group with these conceptual operations:

- `list threads`
- `send without waiting`
- `send and stream`
- `steer active interaction`

The exact method names may follow the project's normal RPC naming conventions, but they must remain a dedicated remote surface and must not be aliases of the app's general-purpose RPC methods.

### List Threads

The remote thread list operation returns all non-archived, non-deleted threads across all projects.

Each row includes:

- `projectName`
- `threadTitle`
- `threadId`
- `sessionStatus`
- `remoteAccess`

The list is sorted by project name and thread title.

### Send

The remote send operation accepts either:

- `threadId`
- or `projectName + threadTitle`

It also accepts:

- `text`
- `sender`

The server resolves the target thread. The CLI does not own thread-resolution rules.

If the target thread has remote access disabled, the operation is rejected.

### Send And Stream

The streamed send operation behaves like send, but it also opens a stream of assistant output for that interaction.

The stream includes assistant output only. It does not stream tool events, raw orchestration events, or internal protocol details.

The stream must emit assistant output incrementally as it is produced, rather than buffering everything until the turn completes.

Conceptually, a streamed interaction exposes:

- an interaction start event or handle
- assistant text deltas or chunks
- assistant message completion boundaries
- a final terminal outcome such as completed, interrupted, timeout, or error

The exact event shape may follow the project's RPC stream conventions, but callers must be able to reconstruct assistant output in real time without waiting for the entire turn to finish.

### Steering

While a streamed remote interaction is still active, the caller may send steering messages.

Steering rules:

- steering is best-effort and intentionally simple
- steering is only valid while the streamed interaction is active
- steering targets the active remote interaction, not an arbitrary historical thread state
- steering is injected immediately rather than being queued for after completion
- if the interaction has already ended, the server rejects the steering attempt

The CLI does not need a standalone `steer` command. It uses this API internally while a streamed send is in progress.

---

## Remote API Examples

This section describes the external contract shape. It is illustrative rather than a low-level wire dump.

### Example Thread Row

```json
{
  "projectName": "my-project",
  "threadTitle": "Fix login bug",
  "threadId": "abc123",
  "sessionStatus": "running",
  "remoteAccess": true
}
```

### Example Stream Lifecycle

```json
{ "type": "started", "interactionId": "ri_123", "threadId": "abc123", "turnId": "turn_1" }
{ "type": "assistant_message_delta", "messageId": "msg_a1", "textDelta": "I’m checking the repo now.\n" }
{ "type": "assistant_message_delta", "messageId": "msg_a1", "textDelta": "I found the failing path.\n" }
{ "type": "assistant_message_completed", "messageId": "msg_a1" }
{ "type": "completed", "interactionId": "ri_123", "turnId": "turn_1" }
```

The exact field names may vary, but the observable behavior must remain:

- assistant output appears as it is emitted
- a caller can tell when a message is complete
- a caller can tell when the interaction is complete

---

## CLI Contract

### Binary

```text
l6claw-cli
```

The standalone CLI is a thin client for the Remote API. Its job is to speak to the Remote API, not to contain remote-agent business logic.

### Global Options

The CLI accepts a Remote API URL and token, either as flags or environment variables.

The exact variable names are an external CLI contract and should be documented alongside the CLI help text. They should refer to the Remote API rather than the app's normal WebSocket API.

### Command: `threads`

```text
l6claw-cli threads
l6claw-cli threads --json
```

Both human-readable and JSON output include remote-access state.

Human-readable output includes columns for:

- project
- thread
- ID
- status
- remote access

JSON output includes:

- `projectName`
- `threadTitle`
- `threadId`
- `sessionStatus`
- `remoteAccess`

### Command: `send`

```text
l6claw-cli send --thread-id <id> --text <message> --sender <name>
l6claw-cli send --project <name> --thread <name> --text <message> --sender <name>
```

Supported behavior:

- target by thread ID
- target by project name plus thread title
- `--no-wait` fire-and-forget mode
- default wait-and-stream mode

In wait mode:

- assistant output is streamed to stdout as it arrives
- the CLI does not wait until the end to print the accumulated response
- each line read from stdin while the interaction is active is forwarded as an immediate steering message
- stdin steering is an escape hatch for long-running turns, not a separate workflow

If steering is attempted after the interaction has ended, the CLI reports the failure simply and continues or exits according to the interaction state.

---

## Inheritance And Thread Settings

The Remote API must respect the target thread's current chat settings.

From the user's perspective, a remote send should behave like sending a message through the UI on that same thread, except that:

- the sender is shown as the remote caller identity
- the provider-facing text includes the hidden server-owned wrapper

Specifically, remote sends must inherit and respect the target thread's current:

- model selection
- reasoning or thinking settings associated with that thread
- interaction mode such as `Chat` or `Plan`
- runtime or access-control mode such as supervised vs full access

This requirement exists so that remote sends behave consistently with the thread the user configured in the UI.

---

## Security Model

The Remote API is a security boundary.

### Allowed Operations

- list threads
- send message to an existing thread with remote access enabled
- stream assistant output for that remote interaction
- steer that active remote interaction

### Disallowed Operations

The Remote API must not expose:

- approval responses
- runtime-mode changes
- interaction-mode changes
- settings mutation
- project creation or deletion
- thread deletion or archive operations
- direct terminal access
- general filesystem mutation outside what the thread's existing agent permissions already allow through a normal turn
- the app's broader RPC surface

### Trust Model

- possession of the Remote API token grants access to the allowed Remote API operations
- the remote sender name is caller-declared and is not tied to token identity
- the server-owned wrapper text exists to inform the model that a non-user agent supplied the message and that suspicious requests should not be trusted automatically

### Remote Access Gate

Per-thread remote access is the first authorization gate.

If a thread has remote access disabled:

- it still appears in thread listings
- sends are rejected
- streamed sends are rejected
- steering is rejected

---

## Error Handling

The exact error envelope may follow the RPC framework's normal conventions, but the following observable cases must be distinguishable to callers:

- invalid or missing remote token
- thread not found
- ambiguous `project + thread title` match
- thread archived or deleted
- remote access disabled for target thread
- thread unavailable for the requested operation
- steering rejected because the interaction already ended
- timeout
- interrupted turn
- server-side failure

The CLI must surface these failures clearly to the caller.

When a streamed send fails after partial assistant output has already been emitted, the partial assistant output remains visible on stdout and the failure is still reported.

---

## Data Compatibility

### Thread Data

Thread state gains a persisted `remoteAccess` flag.

This requires durable storage so that:

- remote-access state survives restarts
- the UI can show the flag consistently
- thread listings can report the flag
- the Remote API can enforce the flag authoritatively

### Message Data

Visible message data includes the caller `sender` field as part of the message model and UI behavior.

### Settings Data

The server settings file gains dedicated Remote API configuration fields rather than reusing the app WebSocket auth settings.

---

## Non-Goals

These are intentionally out of scope for this feature specification:

- a standalone CLI `steer` command
- exposing tool calls or raw orchestration events to remote callers
- remote creation of new threads or projects
- linking sender identities to specific tokens
- exposing the app's normal WebSocket API details in the Settings `API Access` section
- turning this spec into an implementation plan or code walkthrough
