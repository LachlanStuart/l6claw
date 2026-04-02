import { Cause, Duration, Effect, Fiber, Option, Queue } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { connect, WsConnectionError } from "../ws/client";
import type { WsPush } from "../ws/protocol";

// ── Flags ────────────────────────────────────────────────────────────────

const urlFlag = Flag.string("url").pipe(
  Flag.withDescription("WebSocket URL. Overrides T3CODE_URL."),
  Flag.optional,
);
const tokenFlag = Flag.string("token").pipe(
  Flag.withDescription("Auth token. Overrides T3CODE_TOKEN."),
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
  Flag.withDescription("Target thread title (case-insensitive, requires --project)."),
  Flag.optional,
);
const textFlag = Flag.string("text").pipe(Flag.withDescription("Message text to send."));
const senderFlag = Flag.string("sender").pipe(
  Flag.withDescription("Sender identity shown in the UI (max 32 chars)."),
);
const waitFlag = Flag.boolean("wait").pipe(
  Flag.withDescription("Block until agent finishes responding."),
  Flag.optional,
);
const timeoutFlag = Flag.integer("timeout").pipe(
  Flag.withDescription("Max wait time in seconds (default: 86400, --wait only)."),
  Flag.optional,
);

// ── Thread resolution types ──────────────────────────────────────────────

interface SnapshotProject {
  id: string;
  title: string;
}
interface SnapshotThread {
  id: string;
  projectId: string;
  title: string;
  runtimeMode: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
  session?: { activeTurnId?: string | null; status?: string } | null;
}
interface ResolvedThread {
  threadId: string;
  runtimeMode: string;
}

function resolveThread(
  snapshot: { projects: SnapshotProject[]; threads: SnapshotThread[] },
  opts: {
    threadId?: string | null;
    project?: string | null;
    thread?: string | null;
  },
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

// ── Wait mode ────────────────────────────────────────────────────────────

type TurnStatus = "running" | "completed" | "error" | "interrupted" | "timeout";

function waitForTurn(
  pushEvents: Queue.Dequeue<WsPush>,
  threadId: string,
  timeoutSec: number,
): Effect.Effect<{ status: TurnStatus; turnId: string | null; messages: string[] }> {
  return Effect.gen(function* () {
    let turnId: string | null = null;
    let sessionWasRunning = false;
    const messages: string[] = [];
    let status: TurnStatus = "running";

    const drain = Effect.gen(function* () {
      while (status === "running") {
        const push = yield* Queue.take(pushEvents);
        if (push.channel !== "orchestration.domainEvent") continue;
        const event = push.data as {
          type: string;
          aggregateId: string;
          payload: Record<string, unknown>;
        };
        if (event.aggregateId !== threadId) continue;

        if (event.type === "thread.session-set") {
          const session = event.payload["session"] as {
            activeTurnId: string | null;
            status: string;
          } | null;
          if (session?.activeTurnId && !turnId) {
            turnId = session.activeTurnId;
            sessionWasRunning = true;
          }
          if (sessionWasRunning && session) {
            if (!session.activeTurnId) {
              if (session.status === "error") status = "error";
              else if (session.status === "stopped" || session.status === "interrupted")
                status = "interrupted";
              else if (session.status === "ready" || session.status === "idle")
                status = "completed";
            }
          }
        } else if (event.type === "thread.message-sent") {
          const p = event.payload as {
            role: string;
            text: string;
            streaming: boolean;
          };
          if (p.role === "assistant" && !p.streaming) {
            messages.push(p.text);
          }
        } else if (event.type === "thread.turn-diff-completed") {
          const p = event.payload as { status: string };
          if (p.status === "ready") status = "completed";
          else if (p.status === "error") status = "error";
          else status = "interrupted";
        }
      }
    });

    const fiber = yield* Effect.forkChild(drain);

    const timedOut = yield* Fiber.join(fiber).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(timeoutSec),
        orElse: () => Effect.succeed("__timeout__" as const),
      }),
    );

    return {
      status: timedOut === "__timeout__" ? "timeout" : status,
      turnId,
      messages,
    };
  });
}

// ── Command ───────────────────────────────────────────────────────────────

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
  Command.withHandler((opts) => {
    const url = Option.getOrUndefined(opts.url) ?? process.env["T3CODE_URL"];
    const token = Option.getOrUndefined(opts.token) ?? process.env["T3CODE_TOKEN"];
    if (!url || !token) {
      return Effect.sync(() => {
        console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
        process.exit(1);
      });
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connect(url, token);

        // Always fetch snapshot first (for thread resolution + runtimeMode)
        const snapshot = (yield* client.request("orchestration.getSnapshot")) as {
          projects: SnapshotProject[];
          threads: SnapshotThread[];
        };
        const resolved = resolveThread(snapshot, {
          threadId: Option.getOrNull(opts.threadId),
          project: Option.getOrNull(opts.project),
          thread: Option.getOrNull(opts.thread),
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

        const isWait = Option.getOrElse(opts.wait, () => false) === true;
        const timeoutSec = Option.getOrElse(opts.timeout, () => 86400);

        if (isWait) {
          // CRITICAL: subscribe to push events BEFORE dispatching to avoid race condition
          const waitEffect = waitForTurn(client.pushEvents, resolved.threadId, timeoutSec);
          const fiber = yield* Effect.forkChild(waitEffect);
          yield* client.request("orchestration.dispatchCommand", { command });
          const waitResult = yield* Fiber.join(fiber);

          // Print collected assistant messages to stdout
          for (const msg of waitResult.messages) {
            console.log(msg);
          }

          const finalStatus = waitResult.status;
          if (finalStatus !== "completed") {
            console.error(JSON.stringify({ status: finalStatus, turnId: waitResult.turnId }));
            process.exit(1);
          }
        } else {
          yield* client.request("orchestration.dispatchCommand", { command });
          console.log(JSON.stringify({ status: "accepted", turnId: null }));
        }
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const err = Cause.squash(cause);
          const msg =
            err instanceof WsConnectionError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          console.error(`Error: ${msg}`);
          process.exit(1);
        }),
      ),
    );
  }),
);
