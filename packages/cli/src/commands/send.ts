import { Cause, Deferred, Duration, Effect, Fiber, Ref, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import {
  CommandId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { makeRpcLayer } from "../ws/client";

// ── Thread resolution ───────────────────────────────────────────────────

interface ResolvedThread {
  threadId: ThreadId;
  runtimeMode: RuntimeMode;
}

function resolveThread(
  snapshot: OrchestrationReadModel,
  opts: { threadId?: string | null; project?: string | null; thread?: string | null },
): ResolvedThread {
  if (opts.threadId) {
    const found = snapshot.threads.find((t) => t.id === opts.threadId);
    if (!found) {
      console.error(`Thread not found: ${opts.threadId}`);
      process.exit(1);
    }
    if (found.deletedAt || found.archivedAt) {
      console.error(`Thread is archived or deleted: ${opts.threadId}`);
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
  const matchedProjects = snapshot.projects.filter(
    (p) => p.title.toLowerCase() === opts.project!.toLowerCase(),
  );
  if (matchedProjects.length === 0) {
    console.error(`Project not found: ${opts.project}`);
    process.exit(1);
  }
  const projectIds = new Set(matchedProjects.map((p) => p.id));
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

// ── Wait-mode state machine ─────────────────────────────────────────────

type TurnStatus = "running" | "completed" | "error" | "interrupted" | "timeout";

interface WaitState {
  turnId: string | null;
  sessionWasRunning: boolean;
  /** Completed (non-streaming) assistant messages. */
  messages: string[];
  /** In-flight streaming chunks keyed by messageId. */
  streamingChunks: Map<string, string>;
  status: TurnStatus;
}

const INITIAL_WAIT_STATE: WaitState = {
  turnId: null,
  sessionWasRunning: false,
  messages: [],
  streamingChunks: new Map(),
  status: "running",
};

/**
 * Process a single domain event and return the updated wait state.
 * Only events for the target thread are relevant.
 */
function processEvent(state: WaitState, event: OrchestrationEvent, threadId: string): WaitState {
  if (event.aggregateId !== threadId) return state;

  if (event.type === "thread.session-set") {
    const session = event.payload.session;
    const newTurnId = state.turnId ?? (session.activeTurnId || null);
    const nowRunning = state.sessionWasRunning || !!session.activeTurnId;

    if (nowRunning && !session.activeTurnId) {
      let status: TurnStatus;
      if (session.status === "error") status = "error";
      else if (session.status === "stopped" || session.status === "interrupted")
        status = "interrupted";
      else status = "completed";
      return { ...state, turnId: newTurnId, sessionWasRunning: nowRunning, status };
    }
    return { ...state, turnId: newTurnId, sessionWasRunning: nowRunning };
  }

  if (event.type === "thread.message-sent") {
    const { role, text, streaming } = event.payload;
    const messageId = event.payload.messageId;
    if (role === "assistant") {
      if (streaming) {
        // Accumulate streaming delta chunk
        const chunks = new Map(state.streamingChunks);
        chunks.set(messageId, (chunks.get(messageId) ?? "") + text);
        return { ...state, streamingChunks: chunks };
      } else {
        // Streaming complete — use explicit text if non-empty, otherwise accumulated chunks
        const accumulated = state.streamingChunks.get(messageId) ?? "";
        const finalText = text.length > 0 ? text : accumulated;
        const chunks = new Map(state.streamingChunks);
        chunks.delete(messageId);
        return {
          ...state,
          streamingChunks: chunks,
          messages: [...state.messages, finalText],
        };
      }
    }
    return state;
  }

  if (event.type === "thread.turn-diff-completed") {
    const turnStatus = event.payload.status;
    const status: TurnStatus =
      turnStatus === "ready" ? "completed" : turnStatus === "error" ? "error" : "interrupted";
    return { ...state, status };
  }

  return state;
}

// ── Help ────────────────────────────────────────────────────────────────

function printHelp(): never {
  console.log("Usage: l6claw-cli send [options]");
  console.log("");
  console.log("Send a message to a thread, triggering the agent to act.");
  console.log("");
  console.log("Options:");
  console.log("  --url <url>          WebSocket URL. Overrides T3CODE_URL.");
  console.log("  --token <token>      Auth token. Overrides T3CODE_TOKEN.");
  console.log("  --thread-id <id>     Target thread by ID.");
  console.log("  --project <name>     Target project by name (case-insensitive).");
  console.log("  --thread <title>     Target thread title (case-insensitive, requires --project).");
  console.log("  --text <message>     Message text to send (required).");
  console.log("  --sender <name>      Sender identity shown in the UI, max 32 chars (required).");
  console.log("  --wait               Block until agent finishes responding.");
  console.log("  --timeout <seconds>  Max wait time in seconds (default: 86400, --wait only).");
  console.log("  --help               Show this help message.");
  process.exit(0);
}

// ── Command entry point ─────────────────────────────────────────────────

export const runSend = (flags: Record<string, string | true>) => {
  if (flags.help === true) printHelp();

  const url = (typeof flags.url === "string" ? flags.url : undefined) ?? process.env["T3CODE_URL"];
  const token =
    (typeof flags.token === "string" ? flags.token : undefined) ?? process.env["T3CODE_TOKEN"];

  if (!url || !token) {
    console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
    process.exit(1);
  }

  const text = typeof flags.text === "string" ? flags.text : undefined;
  const sender = typeof flags.sender === "string" ? flags.sender : undefined;
  if (!text || !sender) {
    console.error("Error: --text and --sender are required.");
    process.exit(1);
  }

  const threadIdOpt = typeof flags["thread-id"] === "string" ? flags["thread-id"] : null;
  const projectOpt = typeof flags.project === "string" ? flags.project : null;
  const threadOpt = typeof flags.thread === "string" ? flags.thread : null;
  const isWait = flags.wait === true;
  const timeoutSec =
    typeof flags.timeout === "string" ? Math.max(1, parseInt(flags.timeout, 10) || 86400) : 86400;

  return Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);

    // Resolve thread from snapshot
    const snapshot = yield* client[ORCHESTRATION_WS_METHODS.getSnapshot]({});
    const resolved = resolveThread(snapshot, {
      threadId: threadIdOpt,
      project: projectOpt,
      thread: threadOpt,
    });

    const command = {
      type: "thread.turn.start" as const,
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: resolved.threadId,
      message: {
        messageId: MessageId.makeUnsafe(crypto.randomUUID()),
        role: "user" as const,
        text,
        sender: sender.slice(0, 32),
        attachments: [] as never[],
      },
      runtimeMode: resolved.runtimeMode,
      interactionMode: "default" as const,
      createdAt: new Date().toISOString(),
    };

    if (isWait) {
      // --- Wait mode: subscribe to events, dispatch, wait for completion ---
      const stateRef = yield* Ref.make<WaitState>(INITIAL_WAIT_STATE);
      const doneDef = yield* Deferred.make<void>();

      // Fork event stream consumer BEFORE dispatching (avoids race)
      const eventConsumer = client[WS_METHODS.subscribeOrchestrationDomainEvents]({}).pipe(
        Stream.runForEach((event: OrchestrationEvent) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(stateRef);
            if (current.status !== "running") return;

            const next = processEvent(current, event, resolved.threadId);
            yield* Ref.set(stateRef, next);
            if (next.status !== "running") {
              yield* Deferred.succeed(doneDef, void 0);
            }
          }),
        ),
      );

      const fiber = yield* eventConsumer.pipe(Effect.forkChild({ startImmediately: true }));

      // Dispatch the turn-start command
      yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command);

      // Wait for completion or timeout
      yield* Deferred.await(doneDef).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(timeoutSec),
          orElse: () => Ref.update(stateRef, (s) => ({ ...s, status: "timeout" as TurnStatus })),
        }),
      );

      yield* Fiber.interrupt(fiber);

      const result = yield* Ref.get(stateRef);

      // Print collected assistant messages
      for (const msg of result.messages) {
        console.log(msg);
      }

      if (result.status !== "completed") {
        console.error(JSON.stringify({ status: result.status, turnId: result.turnId }));
        process.exit(1);
      }
    } else {
      // --- Fire-and-forget mode ---
      yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command);
      console.log(JSON.stringify({ status: "accepted", turnId: null }));
    }
  }).pipe(
    Effect.provide(makeRpcLayer(url, token)),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const err = Cause.squash(cause);
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }),
    ),
  );
};
