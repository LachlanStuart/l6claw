# L6 Remote CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `sender` field to messages, persist auth tokens, and build a standalone CLI (`l6claw-cli`) for remote agents to list threads and send messages into T3 Code.

**Architecture:** Three tracks converge: (1) sender field flows through contracts → database → server → web UI, (2) auth token auto-generation with opt-in persistence via settings, (3) a new `packages/cli` package using `effect/unstable/cli` that connects via WebSocket to send commands and listen for events. The CLI compiles to a standalone binary via `bun build --compile`.

**Tech Stack:** Effect 4.0.0-beta.42, `effect/unstable/cli` (Command/Flag), Bun, SQLite, React, Vitest

**Spec:** `.l6-specs/l6-remote-cli.md`

---

### Task 1: Add `sender` field to contracts schemas

**Files:**
- Modify: `packages/contracts/src/orchestration.ts:159-169` (OrchestrationMessage)
- Modify: `packages/contracts/src/orchestration.ts:391-409` (ThreadTurnStartCommand)
- Modify: `packages/contracts/src/orchestration.ts:701-711` (ThreadMessageSentPayload)

- [ ] **Step 1: Add `sender` to `OrchestrationMessage`**

In `packages/contracts/src/orchestration.ts`, add `sender` field to OrchestrationMessage:

```typescript
export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  sender: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

The `withDecodingDefault(() => null)` ensures backward compatibility — existing persisted messages without a sender field decode cleanly to `null`.

- [ ] **Step 2: Add `sender` to `ThreadTurnStartCommand.message`**

In the same file, add optional `sender` to the message struct within `ThreadTurnStartCommand`:

```typescript
export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
    sender: Schema.optional(Schema.String),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});
```

Also check if there is a `ClientThreadTurnStartCommand` (line ~411) and add `sender` there too if it has its own message struct.

- [ ] **Step 3: Add `sender` to `ThreadMessageSentPayload`**

```typescript
export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  sender: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`

Expected: Contract changes propagate — expect type errors in server code (decider, projection) that reference these schemas without the new field. That's expected and will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/orchestration.ts
git commit -m "feat(contracts): add sender field to message schemas"
```

---

### Task 2: Database migration for `sender` column

**Files:**
- Create: `apps/server/src/persistence/Migrations/019_ProjectionThreadMessageSender.ts`
- Modify: `apps/server/src/persistence/Migrations.ts`

- [ ] **Step 1: Create migration file**

Create `apps/server/src/persistence/Migrations/019_ProjectionThreadMessageSender.ts`:

```typescript
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN sender TEXT
  `;
});
```

- [ ] **Step 2: Register migration**

In `apps/server/src/persistence/Migrations.ts`, add import and entry:

Add import after line 33:
```typescript
import Migration0019 from "./Migrations/019_ProjectionThreadMessageSender.ts";
```

Add entry to `migrationEntries` array after line 63:
```typescript
  [19, "ProjectionThreadMessageSender", Migration0019],
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/persistence/Migrations/019_ProjectionThreadMessageSender.ts apps/server/src/persistence/Migrations.ts
git commit -m "feat(server): add sender column migration for thread messages"
```

---

### Task 3: Add `sender` to persistence layer

**Files:**
- Modify: `apps/server/src/persistence/Services/ProjectionThreadMessages.ts:22-32`
- Modify: `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts:15-20,30-73,77-96,117-130`

- [ ] **Step 1: Add `sender` to `ProjectionThreadMessage` service schema**

In `apps/server/src/persistence/Services/ProjectionThreadMessages.ts`, add `sender` to the schema:

```typescript
export const ProjectionThreadMessage = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  sender: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  isStreaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 2: Add `sender` to SQL INSERT/UPSERT**

In `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts`, update the upsert query to include `sender`:

```typescript
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          sender,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${nextAttachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_messages
              WHERE message_id = ${row.messageId}
            )
          ),
          ${row.sender},
          ${row.isStreaming ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          sender = excluded.sender,
          is_streaming = excluded.is_streaming,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
```

- [ ] **Step 3: Add `sender` to SELECT query**

Update the list query to include `sender`:

```typescript
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          sender,
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, message_id ASC
      `,
```

- [ ] **Step 4: Add `sender` to row mapping**

In the `listByThreadId` method's row mapper (around line 118), add `sender`:

```typescript
      Effect.map((rows) =>
        rows.map((row) => ({
          messageId: row.messageId,
          threadId: row.threadId,
          turnId: row.turnId,
          role: row.role,
          text: row.text,
          isStreaming: row.isStreaming === 1,
          sender: row.sender ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(row.attachments !== null ? { attachments: row.attachments } : {}),
        })),
      ),
```

Also update the `ProjectionThreadMessageDbRowSchema` mapping at the top of the file (around line 15) to include `sender`:

```typescript
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    sender: Schema.NullOr(Schema.String),
  }),
);
```

- [ ] **Step 5: Run typecheck**

Run: `bun typecheck`

Expected: Persistence layer should compile. Server-side orchestration code may still have type errors (decider, projection pipeline) — addressed in next task.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/Services/ProjectionThreadMessages.ts apps/server/src/persistence/Layers/ProjectionThreadMessages.ts
git commit -m "feat(server): add sender to message persistence layer"
```

---

### Task 4: Pass `sender` through orchestration decider and projection

**Files:**
- Modify: `apps/server/src/orchestration/decider.ts:343-361`
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:626-657`

- [ ] **Step 1: Pass `sender` from command to event in decider**

In `apps/server/src/orchestration/decider.ts`, in the `thread.turn.start` case (around line 343), update the `userMessageEvent` payload to include `sender`. The sender is truncated to 32 characters:

```typescript
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          sender: command.message.sender
            ? command.message.sender.slice(0, 32)
            : null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
```

- [ ] **Step 2: Pass `sender` through projection pipeline**

In `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`, in the `thread.message-sent` handler of `applyThreadMessagesProjection` (around line 626-657), pass `sender` to the upsert call:

Find the `yield* projectionThreadMessageRepository.upsert({...})` call and add `sender`:

```typescript
  yield* projectionThreadMessageRepository.upsert({
    messageId: event.payload.messageId,
    threadId: event.payload.threadId,
    turnId: event.payload.turnId,
    role: event.payload.role,
    text: nextText,
    ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
    sender: event.payload.sender ?? null,
    isStreaming: event.payload.streaming,
    createdAt: existingMessage?.createdAt ?? event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
  });
```

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`

Expected: Server should now compile cleanly (or have only web-side errors remaining).

- [ ] **Step 4: Run tests**

Run: `bun run test`

Expected: All existing tests should pass. The sender field defaults to null so existing test data is backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/decider.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
git commit -m "feat(server): propagate sender through orchestration decider and projection"
```

---

### Task 5: Add `sender` to web app types and store

**Files:**
- Modify: `apps/web/src/types.ts:43-52`
- Modify: `apps/web/src/store.ts:96-116`

- [ ] **Step 1: Add `sender` to `ChatMessage` interface**

In `apps/web/src/types.ts`:

```typescript
export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  sender?: string | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}
```

- [ ] **Step 2: Map `sender` in store's `mapMessage`**

In `apps/web/src/store.ts`, update the `mapMessage` function (around line 96-116) to include `sender`:

```typescript
function mapMessage(message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    sender: message.sender ?? null,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`

Expected: Web app should compile cleanly. The `sender` field is optional on `ChatMessage` so existing rendering code is unaffected.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/store.ts
git commit -m "feat(web): add sender field to ChatMessage type and store mapping"
```

---

### Task 6: Render sender indicator in messages timeline

**Files:**
- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx:432-434`

- [ ] **Step 1: Add sender display next to timestamp**

In `apps/web/src/components/chat/MessagesTimeline.tsx`, find the user message timestamp rendering (around line 432-434):

Replace:
```tsx
                  <p className="text-right text-[10px] text-muted-foreground/30">
                    {formatTimestamp(row.message.createdAt, timestampFormat)}
                  </p>
```

With:
```tsx
                  <p className="text-right text-[10px] text-muted-foreground/30">
                    {row.message.sender && (
                      <span className="text-primary/40">{row.message.sender} · </span>
                    )}
                    {formatTimestamp(row.message.createdAt, timestampFormat)}
                  </p>
```

The `text-primary/40` class gives a muted accent colour that's distinct from the timestamp's `text-muted-foreground/30` but similarly understated. The `·` separator visually links sender and timestamp. If no sender (null/undefined), nothing extra renders.

- [ ] **Step 2: Verify render**

Run: `bun dev` (in apps/web) and send a message from the UI. Confirm:
- Normal UI messages render exactly as before (no sender badge)
- No visual regressions

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/chat/MessagesTimeline.tsx
git commit -m "feat(web): render sender indicator on user messages"
```

---

### Task 7: Add `authToken` to ServerSettings and ServerConfig schemas

**Files:**
- Modify: `packages/contracts/src/settings.ts:74-92,144-155`
- Modify: `packages/contracts/src/server.ts:68-77`

- [ ] **Step 1: Add `authToken` to `ServerSettings`**

In `packages/contracts/src/settings.ts`, add `authToken` to the ServerSettings schema:

```typescript
export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(() => "local" as const satisfies ThreadEnvMode),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),

  // Auth
  authToken: Schema.optional(Schema.String),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
});
```

- [ ] **Step 2: Add `authToken` to `ServerSettingsPatch`**

```typescript
export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  authToken: Schema.optionalKey(Schema.NullOr(Schema.String)),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
    }),
  ),
});
```

Note: `Schema.NullOr(Schema.String)` allows the patch to set `authToken: null` to explicitly remove it (unpersist), while omitting the key entirely means "don't change."

- [ ] **Step 3: Add endpoint info to `ServerConfig`**

In `packages/contracts/src/server.ts`, add `host`, `port`, and `authToken` to the `ServerConfig` schema so the web app can display connection info:

```typescript
export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  settings: ServerSettings,
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  authToken: Schema.optional(Schema.String),
});
```

- [ ] **Step 4: Run typecheck**

Run: `bun typecheck`

Expected: Contract changes propagate. May see errors in server's `serverGetConfig` handler since it now needs to include host/port/authToken — that's expected, fixed in next task.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/server.ts
git commit -m "feat(contracts): add authToken to settings and endpoint info to server config"
```

---

### Task 8: Implement auth token auto-generation and persistence on server

**Files:**
- Modify: `apps/server/src/main.ts:220-240,280-290`
- Modify: `apps/server/src/wsServer.ts:904-917`

- [ ] **Step 1: Resolve authToken from settings on startup**

In `apps/server/src/main.ts`, after the existing `authToken` resolution (around line 233-239), add a fallback that reads from persisted settings and auto-generates if needed.

Find the section where `authToken` is resolved:
```typescript
const authToken = resolveOptionPrecedence(
  input.authToken,
  Option.fromUndefinedOr(env.authToken),
  Option.flatMap(bootstrapEnvelope, (bootstrap) =>
    Option.fromUndefinedOr(bootstrap.authToken),
  ),
);
```

Below this, add settings fallback and auto-generation. The persisted settings file is loaded at this point via the existing settings infrastructure. Since settings loading is async (Effect), we need to load the settings authToken before building the final config. Find where settings are loaded early (or add a synchronous file read for just the authToken), or restructure to:

```typescript
// After existing resolution
const authTokenFromFlags = resolveOptionPrecedence(
  input.authToken,
  Option.fromUndefinedOr(env.authToken),
  Option.flatMap(bootstrapEnvelope, (bootstrap) =>
    Option.fromUndefinedOr(bootstrap.authToken),
  ),
);

// Read persisted authToken from settings.json if flags/env didn't provide one.
// Use NodeFileSystem (already available in the server's Effect context) to read
// the settings file before the full settings service starts up.
const settingsAuthToken = Option.isNone(authTokenFromFlags)
  ? yield* fileSystem.readFileString(pathService.resolve(stateDir, "settings.json")).pipe(
      Effect.map((raw) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return Option.fromUndefinedOr(parsed.authToken as string | undefined);
      }),
      Effect.orElseSucceed(() => Option.none<string>()),
    )
  : Effect.succeed(Option.none<string>());

const resolvedSettingsToken = yield* settingsAuthToken;

// Auto-generate if nothing provided
const authToken = Option.isSome(authTokenFromFlags)
  ? authTokenFromFlags
  : Option.isSome(resolvedSettingsToken)
    ? resolvedSettingsToken
    : Option.some(
        Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
```

Note: The exact implementation may need adjustment based on whether the startup flow is already in an Effect.gen context. Check `makeServerProgram` or `ServerConfigLive` for the right place. The key outcome: `authToken` is always `Option.some(string)` — never `Option.none`.

- [ ] **Step 2: Include host/port/authToken in `serverGetConfig` response**

In `apps/server/src/wsServer.ts`, update the `serverGetConfig` handler (around line 904-917) to include endpoint info:

```typescript
      case WS_METHODS.serverGetConfig: {
        const keybindingsConfig = yield* keybindingsManager.loadConfigState;
        const settings = yield* serverSettingsManager.getSettings;
        const providers = yield* Ref.get(providersRef);
        return {
          cwd,
          keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors,
          settings,
          host,
          port,
          authToken,
        };
      }
```

`host`, `port`, and `authToken` are already in scope as destructured from `serverConfig` at the top of the `createServer` function.

- [ ] **Step 3: Run typecheck and tests**

Run: `bun typecheck && bun run test`

Expected: All passing.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/main.ts apps/server/src/wsServer.ts
git commit -m "feat(server): auto-generate auth token and expose endpoint info in config"
```

---

### Task 9: Add API Access section to settings UI

**Files:**
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

- [ ] **Step 1: Add API Access section to GeneralSettingsPanel**

In `apps/web/src/components/settings/SettingsPanels.tsx`, inside the `GeneralSettingsPanel` function (starts at line 515), add state for token visibility and the API Access section. Add this after existing state declarations (around line 545):

```tsx
const [isTokenRevealed, setIsTokenRevealed] = useState(false);
```

Then add the API Access section JSX inside the panel's return statement. Find a suitable location in the rendered output (e.g., after the provider settings section, before the "Restore defaults" section). Add:

```tsx
{/* API Access */}
<div className="space-y-4">
  <h3 className="text-sm font-medium">API Access</h3>
  <p className="text-xs text-muted-foreground">
    Connection details for remote agents using l6claw-cli.
  </p>

  <div className="space-y-3">
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Endpoint URL</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs">
          {serverConfigQuery.data
            ? `ws://${serverConfigQuery.data.host || "localhost"}:${serverConfigQuery.data.port ?? 3773}`
            : "Loading..."}
        </code>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            const url = serverConfigQuery.data
              ? `ws://${serverConfigQuery.data.host || "localhost"}:${serverConfigQuery.data.port ?? 3773}`
              : "";
            void navigator.clipboard.writeText(url);
          }}
        >
          Copy
        </Button>
      </div>
    </div>

    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Auth Token</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-1.5 text-xs font-mono">
          {isTokenRevealed
            ? (serverConfigQuery.data?.authToken ?? "—")
            : "••••••••••••••••••••••••••••••••"}
        </code>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setIsTokenRevealed((v) => !v)}
        >
          {isTokenRevealed ? "Hide" : "Reveal"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(
              serverConfigQuery.data?.authToken ?? "",
            );
          }}
        >
          Copy
        </Button>
      </div>
    </div>

    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id="persist-token"
        checked={settings.authToken !== undefined}
        onChange={(e) => {
          if (e.target.checked) {
            updateSettings({
              authToken: serverConfigQuery.data?.authToken ?? undefined,
            });
          } else {
            updateSettings({ authToken: null as unknown as undefined });
          }
        }}
        className="size-3.5 rounded border-border"
      />
      <label htmlFor="persist-token" className="text-xs text-muted-foreground">
        Persist across restarts
      </label>
    </div>
  </div>
</div>
```

Note: The exact persist/unpersist semantics depend on how the settings patch handles `null` vs `undefined`. The `ServerSettingsPatch` has `authToken: Schema.optionalKey(Schema.NullOr(Schema.String))` — sending `null` should remove the key from the persisted settings (via `stripDefaultServerSettings`), while sending the token string persists it. Verify this behavior during implementation and adjust the onChange handler accordingly. The `useUpdateSettings` hook may need its `splitPatch` function updated to route `authToken` to server settings.

- [ ] **Step 2: Ensure `authToken` is routed as a server setting**

In `apps/web/src/hooks/useSettings.ts`, the `splitPatch` function determines which settings keys go to the server vs client localStorage. Since `authToken` is in `ServerSettings`, it should be automatically detected by the `SERVER_SETTINGS_KEYS` set. Verify this — if keys are hardcoded rather than derived from the schema, add `"authToken"` to the server keys set.

- [ ] **Step 3: Run typecheck and verify in browser**

Run: `bun typecheck`

Then `bun dev` and open the settings page. Verify:
- Endpoint URL shows the correct ws:// address
- Auth token is masked, revealable, copyable
- Persist checkbox works

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx apps/web/src/hooks/useSettings.ts
git commit -m "feat(web): add API Access section to settings panel"
```

---

### Task 10: Scaffold `packages/cli` package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/main.ts` (minimal placeholder)

- [ ] **Step 1: Create package.json**

Create `packages/cli/package.json`:

```json
{
  "name": "@t3tools/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "l6claw-cli": "./dist/l6claw-cli"
  },
  "scripts": {
    "build": "bun build --compile src/main.ts --outfile dist/l6claw-cli",
    "dev": "bun run src/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@t3tools/contracts": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create minimal main.ts**

Create `packages/cli/src/main.ts`:

```typescript
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

const cli = Command.make("l6claw-cli", {}).pipe(
  Command.withDescription("Remote CLI for T3 Code"),
  Command.withHandler(() => Effect.log("l6claw-cli: no command specified. Use --help.")),
);

Command.run(cli, { name: "l6claw-cli", version: "0.0.1" });
```

- [ ] **Step 4: Install dependencies and verify**

Run: `bun install`

Then: `bun run packages/cli/src/main.ts --help`

Expected: CLI help output showing "l6claw-cli" with description.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): scaffold l6claw-cli package"
```

---

### Task 11: Implement WebSocket client module

**Files:**
- Create: `packages/cli/src/ws/protocol.ts`
- Create: `packages/cli/src/ws/client.ts`

- [ ] **Step 1: Create protocol types**

Create `packages/cli/src/ws/protocol.ts`:

```typescript
/**
 * Wire protocol types matching T3 Code WebSocket format.
 * Kept minimal — only what the CLI needs.
 */

/** Client → Server request envelope */
export interface WsRequest {
  readonly id: string;
  readonly body: Record<string, unknown> & { readonly _tag: string };
}

/** Server → Client response envelope */
export interface WsResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

/** Server → Client push envelope */
export interface WsPush {
  readonly type: "push";
  readonly sequence: number;
  readonly channel: string;
  readonly data: unknown;
}

export type WsMessage = WsResponse | WsPush;

export function isPush(msg: WsMessage): msg is WsPush {
  return "type" in msg && msg.type === "push";
}

export function isResponse(msg: WsMessage): msg is WsResponse {
  return "id" in msg && !("type" in msg);
}
```

- [ ] **Step 2: Create WebSocket client**

Create `packages/cli/src/ws/client.ts`:

```typescript
/**
 * Thin WebSocket client for T3 Code.
 * Handles connection, auth, request/response, and push event listening.
 */
import { Effect, Queue, Deferred, Duration, Scope, Ref } from "effect";
import type { WsRequest, WsResponse, WsPush, WsMessage } from "./protocol.ts";
import { isPush, isResponse } from "./protocol.ts";

export class WsConnectionError {
  readonly _tag = "WsConnectionError";
  constructor(readonly message: string) {}
}

export class WsRequestError {
  readonly _tag = "WsRequestError";
  constructor(readonly message: string) {}
}

export interface T3WsClient {
  /** Send an RPC request and await the response */
  readonly request: (
    tag: string,
    params?: Record<string, unknown>,
  ) => Effect.Effect<unknown, WsRequestError>;
  /** Subscribe to push events. Returns a queue that receives all pushes. */
  readonly pushEvents: Queue.Dequeue<WsPush>;
  /** Close the connection */
  readonly close: Effect.Effect<void>;
}

/**
 * Connect to T3 Code WebSocket and return a client.
 * Must be used within an Effect.scoped context — connection closes on scope finalization.
 */
export const connect = (
  url: string,
  token: string,
): Effect.Effect<T3WsClient, WsConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    const wsUrl = `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

    // Pending request map: id → Deferred<WsResponse>
    const pending = yield* Ref.make(new Map<string, Deferred.Deferred<WsResponse, WsRequestError>>());
    const pushQueue = yield* Queue.unbounded<WsPush>();

    // Connect
    const ws = yield* Effect.async<WebSocket, WsConnectionError>((resume) => {
      const socket = new WebSocket(wsUrl);
      socket.onopen = () => resume(Effect.succeed(socket));
      socket.onerror = (event) => {
        const msg = "message" in event ? String((event as ErrorEvent).message) : "WebSocket connection failed";
        resume(Effect.fail(new WsConnectionError(msg)));
      };
      // Handle rejection (401, 400) — onclose fires without onopen
      socket.onclose = (event) => {
        if (event.code === 1006) {
          resume(Effect.fail(new WsConnectionError(
            event.reason || "Connection rejected (check token and URL)"
          )));
        }
      };
    });

    // Message dispatcher
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsMessage;
        if (isPush(msg)) {
          Effect.runSync(Queue.offer(pushQueue, msg));
        } else if (isResponse(msg)) {
          Effect.runSync(
            Ref.get(pending).pipe(
              Effect.flatMap((map) => {
                const deferred = map.get(msg.id);
                if (deferred) {
                  map.delete(msg.id);
                  return Deferred.succeed(deferred, msg);
                }
                return Effect.void;
              }),
            ),
          );
        }
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onclose = () => {
      // Reject all pending requests
      Effect.runSync(
        Ref.get(pending).pipe(
          Effect.flatMap((map) => {
            const effects = [...map.values()].map((d) =>
              Deferred.fail(d, new WsRequestError("Connection closed")),
            );
            map.clear();
            return Effect.all(effects, { discard: true });
          }),
        ),
      );
    };

    // Finalize on scope close
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        ws.close();
      }),
    );

    let requestCounter = 0;

    const request = (
      tag: string,
      params?: Record<string, unknown>,
    ): Effect.Effect<unknown, WsRequestError> =>
      Effect.gen(function* () {
        const id = `cli-${++requestCounter}`;
        const deferred = yield* Deferred.make<WsResponse, WsRequestError>();
        yield* Ref.update(pending, (map) => new Map(map).set(id, deferred));

        const envelope: WsRequest = {
          id,
          body: { _tag: tag, ...params },
        };
        ws.send(JSON.stringify(envelope));

        const response = yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: Duration.seconds(30),
            onTimeout: () => new WsRequestError("Request timed out"),
          }),
        );

        if (response.error) {
          return yield* Effect.fail(new WsRequestError(response.error.message));
        }
        return response.result;
      });

    return {
      request,
      pushEvents: pushQueue,
      close: Effect.sync(() => ws.close()),
    } satisfies T3WsClient;
  });
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/cli && bun run typecheck`

Expected: Compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/ws/
git commit -m "feat(cli): implement WebSocket client module"
```

---

### Task 12: Implement `threads` command

**Files:**
- Create: `packages/cli/src/commands/threads.ts`
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 1: Create threads command**

Create `packages/cli/src/commands/threads.ts`:

```typescript
import { Effect, Scope } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { connect, WsConnectionError } from "../ws/client.ts";

interface ThreadRow {
  projectName: string;
  threadTitle: string;
  threadId: string;
  sessionStatus: string;
}

function resolveThreads(snapshot: {
  projects: Array<{ id: string; title: string; deletedAt?: string | null }>;
  threads: Array<{
    id: string;
    projectId: string;
    title: string;
    archivedAt?: string | null;
    deletedAt?: string | null;
    session?: { status: string } | null;
  }>;
}): ThreadRow[] {
  const projectMap = new Map(
    snapshot.projects
      .filter((p) => !p.deletedAt)
      .map((p) => [p.id, p.title]),
  );

  return snapshot.threads
    .filter((t) => !t.archivedAt && !t.deletedAt && projectMap.has(t.projectId))
    .map((t) => ({
      projectName: projectMap.get(t.projectId)!,
      threadTitle: t.title,
      threadId: t.id,
      sessionStatus: t.session?.status ?? "idle",
    }))
    .sort((a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.threadTitle.localeCompare(b.threadTitle),
    );
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
}

function formatTable(rows: ThreadRow[]): string {
  if (rows.length === 0) return "No threads found.";

  const headers = { project: "PROJECT", thread: "THREAD", id: "ID", status: "STATUS" };
  const projW = Math.max(headers.project.length, ...rows.map((r) => r.projectName.length));
  const threadW = Math.max(headers.thread.length, ...rows.map((r) => truncate(r.threadTitle, 60).length));
  const idW = Math.max(headers.id.length, ...rows.map((r) => r.threadId.length));

  const pad = (s: string, w: number) => s.padEnd(w);
  const header = `${pad(headers.project, projW)}  ${pad(headers.thread, threadW)}  ${pad(headers.id, idW)}  ${headers.status}`;
  const lines = rows.map(
    (r) =>
      `${pad(r.projectName, projW)}  ${pad(truncate(r.threadTitle, 60), threadW)}  ${pad(r.threadId, idW)}  ${r.sessionStatus}`,
  );
  return [header, ...lines].join("\n");
}

const urlFlag = Flag.string("url").pipe(
  Flag.withDescription("WebSocket URL of the T3 Code server (e.g. ws://100.64.1.2:3773). Overrides T3CODE_URL."),
  Flag.optional,
);
const tokenFlag = Flag.string("token").pipe(
  Flag.withDescription("Auth token for the WebSocket connection. Overrides T3CODE_TOKEN."),
  Flag.optional,
);
const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Output as JSON array instead of table."),
  Flag.optional,
);

export const threadsCommand = Command.make("threads", { url: urlFlag, token: tokenFlag, json: jsonFlag }).pipe(
  Command.withDescription("List all threads across all projects."),
  Command.withHandler(({ url: urlFlag, token: tokenFlag, json }) =>
    Effect.gen(function* () {
      const url = urlFlag ?? process.env.T3CODE_URL;
      const token = tokenFlag ?? process.env.T3CODE_TOKEN;
      if (!url || !token) {
        console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
        process.exit(1);
      }
      const scope = yield* Scope.make();
      const client = yield* connect(url, token).pipe(Effect.provideService(Scope.Scope, scope));

      try {
        const snapshot = (yield* client.request("orchestration.getSnapshot")) as {
          projects: Array<{ id: string; title: string; deletedAt?: string | null }>;
          threads: Array<{
            id: string;
            projectId: string;
            title: string;
            archivedAt?: string | null;
            deletedAt?: string | null;
            session?: { status: string } | null;
          }>;
        };

        const rows = resolveThreads(snapshot);

        if (json === true) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          console.log(formatTable(rows));
        }
      } finally {
        yield* Scope.close(scope, Effect.void);
      }
    }).pipe(
      Effect.catchAll((err) => {
        const msg = err instanceof WsConnectionError ? err.message :
                    "message" in err ? (err as { message: string }).message :
                    "Unknown error";
        return Effect.sync(() => {
          console.error(`Error: ${msg}`);
          process.exit(1);
        });
      }),
    ),
  ),
);

```

- [ ] **Step 2: Wire threads command into main.ts**

Replace `packages/cli/src/main.ts`:

```typescript
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { threadsCommand } from "./commands/threads.ts";

const cli = Command.make("l6claw-cli", {}).pipe(
  Command.withDescription("Remote CLI for T3 Code"),
  Command.withSubcommands([threadsCommand]),
  Command.withHandler(() =>
    Effect.sync(() => {
      console.error("No command specified. Use --help.");
      process.exit(1);
    }),
  ),
);

Command.run(cli, { name: "l6claw-cli", version: "0.0.1" });
```

- [ ] **Step 3: Test manually**

Run: `T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> bun run packages/cli/src/main.ts threads`

Expected: Table listing of threads from a running T3 Code server.

Run: `T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> bun run packages/cli/src/main.ts threads --json`

Expected: JSON array output.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): implement threads command"
```

---

### Task 13: Implement `send` command (fire-and-forget)

**Files:**
- Create: `packages/cli/src/commands/send.ts`
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 1: Create send command**

Create `packages/cli/src/commands/send.ts`:

```typescript
import { Effect, Scope, Queue } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { connect, WsConnectionError, type WsRequestError } from "../ws/client.ts";
import type { WsPush } from "../ws/protocol.ts";

const urlFlag = Flag.string("url").pipe(
  Flag.withDescription("WebSocket URL of the T3 Code server. Overrides T3CODE_URL."),
  Flag.optional,
);
const tokenFlag = Flag.string("token").pipe(
  Flag.withDescription("Auth token for the WebSocket connection. Overrides T3CODE_TOKEN."),
  Flag.optional,
);
const threadIdFlag = Flag.string("thread-id").pipe(
  Flag.withDescription("Target thread by ID."),
  Flag.optional,
);
const projectFlag = Flag.string("project").pipe(
  Flag.withDescription("Target project by name (case-insensitive)."),
  Flag.optional,
);
const threadFlag = Flag.string("thread").pipe(
  Flag.withDescription("Target thread by title (case-insensitive, must pair with --project)."),
  Flag.optional,
);
const textFlag = Flag.string("text").pipe(
  Flag.withDescription("Message text to send."),
);
const senderFlag = Flag.string("sender").pipe(
  Flag.withDescription("Sender identity displayed in the UI (max 32 characters)."),
);
const waitFlag = Flag.boolean("wait").pipe(
  Flag.withDescription("Block until the agent finishes responding."),
  Flag.optional,
);
const timeoutFlag = Flag.integer("timeout").pipe(
  Flag.withDescription("Maximum wait time in seconds (default: 86400, only with --wait)."),
  Flag.optional,
);

interface ResolvedThread {
  threadId: string;
  runtimeMode: string;
}

function resolveThread(
  snapshot: {
    projects: Array<{ id: string; title: string }>;
    threads: Array<{
      id: string;
      projectId: string;
      title: string;
      runtimeMode: string;
      archivedAt?: string | null;
      deletedAt?: string | null;
      session?: { activeTurnId?: string | null; status?: string } | null;
    }>;
  },
  opts: {
    threadId?: string;
    project?: string;
    thread?: string;
  },
): ResolvedThread {
  if (opts.threadId) {
    const found = snapshot.threads.find((t) => t.id === opts.threadId);
    if (!found) {
      console.error(`Thread not found: ${opts.threadId}`);
      process.exit(1);
    }
    if (found.session?.activeTurnId) {
      console.error("Thread has an active turn in progress");
      process.exit(1);
    }
    return { threadId: found.id, runtimeMode: found.runtimeMode };
  }

  if (!opts.project || !opts.thread) {
    console.error("Either --thread-id or both --project and --thread are required.");
    process.exit(1);
  }

  const matchedProject = snapshot.projects.filter(
    (p) => p.title.toLowerCase() === opts.project!.toLowerCase(),
  );
  if (matchedProject.length === 0) {
    console.error(`Project not found: ${opts.project}`);
    process.exit(1);
  }
  const projectIds = new Set(matchedProject.map((p) => p.id));

  const matchedThreads = snapshot.threads.filter(
    (t) =>
      projectIds.has(t.projectId) &&
      t.title.toLowerCase() === opts.thread!.toLowerCase() &&
      !t.archivedAt &&
      !t.deletedAt,
  );

  if (matchedThreads.length === 0) {
    console.error(`Thread not found: "${opts.thread}" in project "${opts.project}"`);
    process.exit(1);
  }
  if (matchedThreads.length > 1) {
    console.error(
      `Multiple threads match: ${matchedThreads.map((t) => `"${t.title}" (${t.id})`).join(", ")}`,
    );
    process.exit(1);
  }

  const found = matchedThreads[0]!;
  if (found.session?.activeTurnId) {
    console.error("Thread has an active turn in progress");
    process.exit(1);
  }
  return { threadId: found.id, runtimeMode: found.runtimeMode };
}

export const sendCommand = Command.make("send", {
  url: urlFlag,
  token: tokenFlag,
  threadId: threadIdFlag,
  project: projectFlag,
  thread: threadFlag,
  text: textFlag,
  sender: senderFlag,
  wait: waitFlag,
  timeout: timeoutFlag,
}).pipe(
  Command.withDescription("Send a message to a thread, triggering the agent to act."),
  Command.withHandler((opts) =>
    Effect.gen(function* () {
      const url = opts.url ?? process.env.T3CODE_URL;
      const token = opts.token ?? process.env.T3CODE_TOKEN;
      if (!url || !token) {
        console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
        process.exit(1);
      }

      const scope = yield* Scope.make();
      const client = yield* connect(url, token).pipe(Effect.provideService(Scope.Scope, scope));

      try {
        // Fetch snapshot for thread resolution
        const snapshot = (yield* client.request("orchestration.getSnapshot")) as {
          projects: Array<{ id: string; title: string }>;
          threads: Array<{
            id: string;
            projectId: string;
            title: string;
            runtimeMode: string;
            archivedAt?: string | null;
            deletedAt?: string | null;
            session?: { activeTurnId?: string | null; status?: string } | null;
          }>;
        };

        const resolved = resolveThread(snapshot, {
          threadId: opts.threadId ?? undefined,
          project: opts.project ?? undefined,
          thread: opts.thread ?? undefined,
        });

        const commandId = crypto.randomUUID();
        const messageId = crypto.randomUUID();

        const command = {
          type: "thread.turn.start",
          commandId,
          threadId: resolved.threadId,
          message: {
            messageId,
            role: "user",
            text: opts.text,
            sender: opts.sender.slice(0, 32),
            attachments: [],
          },
          runtimeMode: resolved.runtimeMode,
          interactionMode: "default",
          createdAt: new Date().toISOString(),
        };

        if (opts.wait === true) {
          // Wait mode — handled in Task 14
          yield* sendAndWait(client, command, resolved.threadId, opts.timeout ?? 86400);
        } else {
          // Fire and forget
          yield* client.request("orchestration.dispatchCommand", { command });
          console.log(JSON.stringify({ status: "accepted", turnId: null }));
        }
      } finally {
        yield* Scope.close(scope, Effect.void);
      }
    }).pipe(
      Effect.catchAll((err) => {
        const msg = err instanceof WsConnectionError ? err.message :
                    "message" in err ? (err as { message: string }).message :
                    "Unknown error";
        return Effect.sync(() => {
          console.error(`Error: ${msg}`);
          process.exit(1);
        });
      }),
    ),
  ),
);

/**
 * Placeholder — implemented in Task 14.
 * Sends the command and waits for turn completion by listening to push events.
 */
function sendAndWait(
  _client: { request: (tag: string, params?: Record<string, unknown>) => Effect.Effect<unknown, any>; pushEvents: Queue.Dequeue<WsPush> },
  _command: Record<string, unknown>,
  _threadId: string,
  _timeoutSec: number,
): Effect.Effect<void, any> {
  return Effect.sync(() => {
    console.error("--wait mode: not yet implemented");
    process.exit(1);
  });
}
```

- [ ] **Step 2: Register send command in main.ts**

Update `packages/cli/src/main.ts` to include the send command:

```typescript
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { threadsCommand } from "./commands/threads.ts";
import { sendCommand } from "./commands/send.ts";

const cli = Command.make("l6claw-cli", {}).pipe(
  Command.withDescription("Remote CLI for T3 Code"),
  Command.withSubcommands([threadsCommand, sendCommand]),
  Command.withHandler(() =>
    Effect.sync(() => {
      console.error("No command specified. Use --help.");
      process.exit(1);
    }),
  ),
);

Command.run(cli, { name: "l6claw-cli", version: "0.0.1" });
```

- [ ] **Step 3: Test fire-and-forget manually**

Run against a running T3 Code server with an existing thread:

```bash
T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> \
  bun run packages/cli/src/main.ts send \
  --thread-id <id> --text "Hello from CLI" --sender "Test CLI"
```

Expected: `{"status":"accepted","turnId":null}` printed to stdout. In the T3 Code UI, the message should appear in the thread with "Test CLI" shown next to the timestamp.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): implement send command (fire-and-forget mode)"
```

---

### Task 14: Implement `send --wait` mode

**Files:**
- Modify: `packages/cli/src/commands/send.ts`

- [ ] **Step 1: Replace `sendAndWait` placeholder with real implementation**

In `packages/cli/src/commands/send.ts`, replace the `sendAndWait` placeholder function:

```typescript
/**
 * Send a message and wait for the turn to complete.
 * Subscribes to push events BEFORE dispatching the command to prevent race conditions.
 * Collects assistant messages and prints them on completion.
 */
function sendAndWait(
  client: {
    request: (tag: string, params?: Record<string, unknown>) => Effect.Effect<unknown, any>;
    pushEvents: Queue.Dequeue<WsPush>;
  },
  command: Record<string, unknown>,
  threadId: string,
  timeoutSec: number,
): Effect.Effect<void, any> {
  return Effect.gen(function* () {
    // State tracking
    let discoveredTurnId: string | null = null;
    let sessionWasRunning = false;
    const assistantMessages: string[] = [];
    let turnStatus: "running" | "completed" | "error" | "interrupted" = "running";

    // Start listening for push events BEFORE dispatching
    const eventFiber = yield* Effect.fork(
      Effect.gen(function* () {
        while (turnStatus === "running") {
          const push = yield* Queue.take(client.pushEvents);

          if (push.channel !== "orchestration.domainEvent") continue;
          const event = push.data as {
            type: string;
            aggregateId: string;
            payload: Record<string, unknown>;
          };
          if (event.aggregateId !== threadId) continue;

          switch (event.type) {
            case "thread.session-set": {
              const session = event.payload.session as {
                activeTurnId: string | null;
                status: string;
              } | null;
              if (session?.activeTurnId && !discoveredTurnId) {
                discoveredTurnId = session.activeTurnId;
                sessionWasRunning = true;
              }
              if (
                sessionWasRunning &&
                (!session?.activeTurnId ||
                  session.status === "ready" ||
                  session.status === "idle" ||
                  session.status === "stopped" ||
                  session.status === "error")
              ) {
                if (session?.status === "error") {
                  turnStatus = "error";
                } else if (session?.status === "stopped") {
                  turnStatus = "interrupted";
                }
                // Don't set completed here — wait for turn-diff-completed for clean exit
                // But if session goes idle/ready, that's also a completion signal
                if (session?.status === "ready" || session?.status === "idle") {
                  turnStatus = "completed";
                }
              }
              break;
            }

            case "thread.message-sent": {
              const payload = event.payload as {
                role: string;
                text: string;
                streaming: boolean;
                messageId: string;
              };
              if (payload.role === "assistant" && !payload.streaming) {
                assistantMessages.push(payload.text);
              }
              break;
            }

            case "thread.turn-diff-completed": {
              const payload = event.payload as { status: string };
              if (payload.status === "ready") {
                turnStatus = "completed";
              } else if (payload.status === "error") {
                turnStatus = "error";
              } else if (payload.status === "missing") {
                turnStatus = "interrupted";
              }
              break;
            }
          }
        }
      }),
    );

    // Now dispatch the command
    yield* client.request("orchestration.dispatchCommand", { command });

    // Wait for completion or timeout
    const result = yield* Fiber.join(eventFiber).pipe(
      Effect.timeoutTo({
        duration: Duration.seconds(timeoutSec),
        onSuccess: () => turnStatus,
        onTimeout: () => "timeout" as const,
      }),
    );

    const finalStatus = result === "timeout" ? "timeout" : turnStatus;

    // Output
    for (const msg of assistantMessages) {
      console.log(msg);
    }

    if (finalStatus !== "completed") {
      const statusJson = JSON.stringify({
        status: finalStatus,
        turnId: discoveredTurnId,
      });
      console.error(statusJson);
      process.exit(1);
    }
  });
}
```

Also add the missing `Duration` import at the top of the file:

```typescript
import { Effect, Scope, Queue, Fiber, Duration } from "effect";
```

- [ ] **Step 2: Test wait mode manually**

Start a T3 Code server with a thread that has an active Codex/Claude session in `full-access` mode, then:

```bash
T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> \
  bun run packages/cli/src/main.ts send \
  --thread-id <id> --text "What is 2+2?" --sender "Test CLI" --wait --timeout 120
```

Expected: CLI blocks until the agent responds, then prints the assistant's response text to stdout and exits with code 0.

Test timeout:
```bash
T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> \
  bun run packages/cli/src/main.ts send \
  --thread-id <id> --text "Write a very long program" --sender "Test CLI" --wait --timeout 5
```

Expected: After 5 seconds, CLI prints any partial assistant text to stdout, prints `{"status":"timeout","turnId":"..."}` to stderr, exits with code 1.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/send.ts
git commit -m "feat(cli): implement send --wait mode with push event correlation"
```

---

### Task 15: Build binary and final verification

**Files:**
- Modify: `packages/cli/package.json` (verify build script)

- [ ] **Step 1: Build the binary**

Run: `cd packages/cli && bun run build`

Expected: `packages/cli/dist/l6claw-cli` binary is produced.

- [ ] **Step 2: Test the compiled binary**

```bash
T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> \
  ./packages/cli/dist/l6claw-cli threads
```

Expected: Same output as `bun run src/main.ts threads`.

```bash
T3CODE_URL=ws://localhost:3773 T3CODE_TOKEN=<token> \
  ./packages/cli/dist/l6claw-cli send \
  --thread-id <id> --text "Binary test" --sender "Compiled CLI"
```

Expected: `{"status":"accepted","turnId":null}` and message visible in UI with "Compiled CLI" sender indicator.

- [ ] **Step 3: Run full project checks**

Run: `bun fmt && bun lint && bun typecheck && bun run test`

Expected: All passing.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): verify l6claw-cli build and add dist to package"
```

---

### Task 16: Add `.gitignore` for CLI dist

**Files:**
- Create or modify: `packages/cli/.gitignore`

- [ ] **Step 1: Create .gitignore**

Create `packages/cli/.gitignore`:

```
dist/
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/.gitignore
git commit -m "chore(cli): add .gitignore for compiled binary"
```
