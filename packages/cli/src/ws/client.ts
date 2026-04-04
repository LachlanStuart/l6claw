/**
 * Effect RPC client layer for the dedicated remote API WebSocket server.
 */
import { Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { RemoteApiRpcGroup } from "@t3tools/contracts";

/**
 * Build the RPC protocol layer that connects to the remote API.
 * The URL must already include the configured WebSocket path.
 */
export const makeRpcLayer = (url: string, token: string) => {
  const base = url.replace(/\/+$/, "");
  const separator = base.includes("?") ? "&" : "?";
  const wsUrl = `${base}${separator}token=${encodeURIComponent(token)}`;

  return RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(NodeSocket.layerWebSocket(wsUrl)),
    Layer.provide(RpcSerialization.layerJson),
  );
};

/** Create a typed RPC client for the remote API RPC group. */
export const makeRpcClient = RpcClient.make(RemoteApiRpcGroup);

type RpcClientFactory = typeof makeRpcClient;
export type T3RpcClient = RpcClientFactory extends import("effect").Effect.Effect<infer C, any, any>
  ? C
  : never;
