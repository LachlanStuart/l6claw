/**
 * Thin WebSocket client for T3 Code.
 * Handles connection, auth, request/response correlation, and push event queue.
 */
import { Effect, Queue, Deferred, Duration, Scope, Ref } from "effect";
import type { WsRequest, WsResponse, WsPush, WsMessage } from "./protocol";
import { isPush, isResponse } from "./protocol";

export class WsConnectionError {
  readonly _tag = "WsConnectionError";
  constructor(readonly message: string) {}
}

export class WsRequestError {
  readonly _tag = "WsRequestError";
  constructor(readonly message: string) {}
}

export interface T3WsClient {
  /** Send an RPC request and await the response (30s timeout) */
  readonly request: (
    tag: string,
    params?: Record<string, unknown>,
  ) => Effect.Effect<unknown, WsRequestError>;
  /** Unbounded queue of all push events received from the server */
  readonly pushEvents: Queue.Dequeue<WsPush>;
  /** Close the WebSocket connection */
  readonly close: Effect.Effect<void>;
}

/**
 * Open a WebSocket connection to T3 Code and return a client.
 * The connection is closed when the provided Scope finalizes.
 */
export const connect = (
  url: string,
  token: string,
): Effect.Effect<T3WsClient, WsConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    const wsUrl = `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

    const pending = yield* Ref.make(
      new Map<string, Deferred.Deferred<WsResponse, WsRequestError>>(),
    );
    const pushQueue = yield* Queue.unbounded<WsPush>();

    // Connect — resolve on open, reject on error or 401/400 close before open
    const ws = yield* Effect.callback<WebSocket, WsConnectionError>((resume) => {
      const socket = new WebSocket(wsUrl);
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        resume(Effect.succeed(socket));
      });

      socket.addEventListener("error", () => {
        if (!opened) {
          resume(Effect.fail(new WsConnectionError("WebSocket connection failed")));
        }
      });

      socket.addEventListener("close", (event: CloseEvent) => {
        if (!opened) {
          const reason = event.reason || `Connection rejected (code ${event.code})`;
          resume(Effect.fail(new WsConnectionError(reason)));
        }
      });
    });

    // Dispatch incoming messages to pending requests or push queue
    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(event.data)) as WsMessage;
      } catch {
        return;
      }

      if (isPush(msg)) {
        // Fire-and-forget offer; unbounded queue never blocks
        Effect.runSync(Queue.offer(pushQueue, msg));
      } else if (isResponse(msg)) {
        Effect.runSync(
          Ref.get(pending).pipe(
            Effect.flatMap((map) => {
              const deferred = map.get(msg.id);
              if (!deferred) return Effect.void;
              // Mutate: remove before resolving to avoid double-resolution
              const next = new Map(map);
              next.delete(msg.id);
              return Ref.set(pending, next).pipe(
                Effect.flatMap(() => Deferred.succeed(deferred, msg as WsResponse)),
              );
            }),
          ),
        );
      }
    });

    // Reject all pending requests when connection closes
    ws.addEventListener("close", () => {
      Effect.runSync(
        Ref.get(pending).pipe(
          Effect.flatMap((map) => {
            const effects = Array.from(map.values()).map((d) =>
              Deferred.fail(d, new WsRequestError("Connection closed")),
            );
            return Ref.set(pending, new Map()).pipe(
              Effect.flatMap(() => Effect.all(effects, { discard: true })),
            );
          }),
        ),
      );
    });

    yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()));

    let seq = 0;

    const request = (
      tag: string,
      params?: Record<string, unknown>,
    ): Effect.Effect<unknown, WsRequestError> =>
      Effect.gen(function* () {
        const id = `cli-${++seq}`;
        const deferred = yield* Deferred.make<WsResponse, WsRequestError>();
        yield* Ref.update(pending, (map) => new Map(map).set(id, deferred));

        const envelope: WsRequest = { id, body: { _tag: tag, ...params } };
        ws.send(JSON.stringify(envelope));

        const response = yield* Effect.timeoutOrElse(Deferred.await(deferred), {
          duration: Duration.seconds(30),
          orElse: () => Effect.fail(new WsRequestError(`Request timed out: ${tag}`)),
        });

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
