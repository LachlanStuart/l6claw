/**
 * Effect RPC client layer for the T3 Code WebSocket server.
 * Mirrors the pattern used by the web app and server tests.
 */
import { Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { WsRpcGroup } from "@t3tools/contracts";

/**
 * Build the RPC protocol layer that connects to a T3 Code server.
 * Appends `/ws` and the auth token query parameter to the base URL.
 */
export const makeRpcLayer = (url: string, token: string) => {
  const base = url.replace(/\/+$/, "");
  const wsUrl = `${base}/ws?token=${encodeURIComponent(token)}`;

  return RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(NodeSocket.layerWebSocket(wsUrl)),
    Layer.provide(RpcSerialization.layerJson),
  );
};

/** Create a typed RPC client for the WsRpcGroup. */
export const makeRpcClient = RpcClient.make(WsRpcGroup);

type RpcClientFactory = typeof makeRpcClient;
export type T3RpcClient = RpcClientFactory extends import("effect").Effect.Effect<infer C, any, any>
  ? C
  : never;
