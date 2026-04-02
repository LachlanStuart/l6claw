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
  return "type" in msg && (msg as WsPush).type === "push";
}

export function isResponse(msg: WsMessage): msg is WsResponse {
  return "id" in msg && !("type" in msg && (msg as { type?: unknown }).type === "push");
}
