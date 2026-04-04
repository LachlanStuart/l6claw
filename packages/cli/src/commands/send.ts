import { Cause, Deferred, Effect, Queue, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import {
  REMOTE_API_METHODS,
  RemoteApiRpcGroup,
  ThreadId,
  type RemoteThreadTarget,
} from "@t3tools/contracts";
import { makeRpcLayer } from "../ws/client";

function printHelp() {
  console.log("Usage: l6claw-cli send [options]");
  console.log("");
  console.log("Send a message through the dedicated remote agent API.");
  console.log("");
  console.log("Options:");
  console.log("  --url <url>          Remote API WebSocket URL. Overrides L6CLAW_REMOTE_URL.");
  console.log("  --token <token>      Remote API token. Overrides L6CLAW_REMOTE_TOKEN.");
  console.log("  --thread-id <id>     Target thread by ID.");
  console.log("  --project <name>     Target project by name (case-insensitive).");
  console.log("  --thread <title>     Target thread title (case-insensitive, requires --project).");
  console.log("  --text <message>     Message text to send (required).");
  console.log("  --sender <name>      Sender identity shown in the UI, max 32 chars (required).");
  console.log("  --no-wait            Dispatch and exit without waiting for the agent to finish.");
  console.log("  --help               Show this help message.");
  process.exit(0);
}

function resolveTarget(flags: Record<string, string | true>): RemoteThreadTarget {
  const threadId = typeof flags["thread-id"] === "string" ? flags["thread-id"] : null;
  if (threadId) {
    return { threadId: ThreadId.makeUnsafe(threadId) };
  }

  const projectName = typeof flags.project === "string" ? flags.project : null;
  const threadTitle = typeof flags.thread === "string" ? flags.thread : null;
  if (!projectName || !threadTitle) {
    console.error("Either --thread-id or both --project and --thread are required.");
    process.exit(1);
  }

  return { projectName, threadTitle };
}

export const runSend = (flags: Record<string, string | true>) => {
  if (flags.help === true) printHelp();

  const url =
    (typeof flags.url === "string" ? flags.url : undefined) ??
    process.env["L6CLAW_REMOTE_URL"] ??
    process.env["T3CODE_URL"];
  const token =
    (typeof flags.token === "string" ? flags.token : undefined) ??
    process.env["L6CLAW_REMOTE_TOKEN"] ??
    process.env["T3CODE_TOKEN"];
  if (!url || !token) {
    console.error(
      "Error: --url / L6CLAW_REMOTE_URL and --token / L6CLAW_REMOTE_TOKEN are required.",
    );
    process.exit(1);
  }

  const text = typeof flags.text === "string" ? flags.text : undefined;
  const sender = typeof flags.sender === "string" ? flags.sender : undefined;
  if (!text || !sender) {
    console.error("Error: --text and --sender are required.");
    process.exit(1);
  }
  const senderName = sender.slice(0, 32);

  const target = resolveTarget(flags);
  const isWait = flags["no-wait"] !== true;

  return Effect.gen(function* () {
    const client = yield* RpcClient.make(RemoteApiRpcGroup);

    if (!isWait) {
      const accepted = yield* client[REMOTE_API_METHODS.threadSend]({
        target,
        text,
        sender: senderName,
      });
      console.log(JSON.stringify(accepted));
      return;
    }

    const steerQueue = yield* Queue.unbounded<string>();
    let stdinBuffer = "";
    let interactionReady = false;
    const interactionIdDeferred = yield* Deferred.make<string>();
    let assistantLineOpen = false;
    let exitCode = 0;

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.stdin.setEncoding("utf8");
        process.stdin.resume();

        const onData = (chunk: string) => {
          stdinBuffer += chunk;
          while (true) {
            const newlineIndex = stdinBuffer.indexOf("\n");
            if (newlineIndex === -1) {
              break;
            }
            const line = stdinBuffer.slice(0, newlineIndex).replace(/\r$/, "");
            stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
            if (line.trim().length === 0) {
              continue;
            }
            void Effect.runFork(Queue.offer(steerQueue, line));
          }
        };

        process.stdin.on("data", onData);
        return onData;
      }),
      (onData) =>
        Effect.sync(() => {
          process.stdin.off("data", onData);
          process.stdin.pause();
        }),
    );

    yield* Queue.take(steerQueue).pipe(
      Effect.flatMap((steerText) =>
        Effect.gen(function* () {
          const activeInteractionId = yield* Deferred.await(interactionIdDeferred);
          yield* client[REMOTE_API_METHODS.threadSteer]({
            interactionId: activeInteractionId,
            text: steerText,
            sender: senderName,
          }).pipe(
            Effect.catchCause((cause: Cause.Cause<unknown>) =>
              Effect.sync(() => {
                const err = Cause.squash(cause);
                console.error(
                  `Steering error: ${err instanceof Error ? err.message : String(err)}`,
                );
              }),
            ),
          );
        }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    yield* client[REMOTE_API_METHODS.threadSendAndStream]({
      target,
      text,
      sender: senderName,
    }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          switch (event.type) {
            case "started":
              if (!interactionReady) {
                interactionReady = true;
                yield* Deferred.succeed(interactionIdDeferred, event.interactionId);
              }
              break;
            case "assistant_message_delta":
              process.stdout.write(event.textDelta);
              assistantLineOpen = !event.textDelta.endsWith("\n");
              break;
            case "assistant_message_completed":
              if (assistantLineOpen) {
                process.stdout.write("\n");
              }
              assistantLineOpen = false;
              break;
            case "completed":
              if (assistantLineOpen) {
                process.stdout.write("\n");
                assistantLineOpen = false;
              }
              exitCode = 0;
              break;
            case "interrupted":
              if (assistantLineOpen) {
                process.stdout.write("\n");
                assistantLineOpen = false;
              }
              console.error(
                JSON.stringify({
                  status: "interrupted",
                  interactionId: event.interactionId,
                  turnId: event.turnId,
                }),
              );
              exitCode = 1;
              break;
            case "error":
              if (assistantLineOpen) {
                process.stdout.write("\n");
                assistantLineOpen = false;
              }
              console.error(
                JSON.stringify({
                  status: "error",
                  interactionId: event.interactionId,
                  code: event.code,
                  message: event.message,
                }),
              );
              exitCode = 1;
              break;
          }
        }),
      ),
    );

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }).pipe(
    Effect.provide(makeRpcLayer(url, token)),
    Effect.catchCause((cause: Cause.Cause<unknown>) =>
      Effect.sync(() => {
        const err = Cause.squash(cause);
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }),
    ),
  );
};
