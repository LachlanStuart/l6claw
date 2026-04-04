import type { ServerRemoteApiConfig, ServerSettings } from "@t3tools/contracts";

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.length > 0 ? trimmed : "127.0.0.1";
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return "/remote/ws";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function formatWebSocketHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function resolveRemoteApiRuntimeConfig(settings: ServerSettings): ServerRemoteApiConfig {
  const host = normalizeHost(settings.remoteApi.host);
  const port = settings.remoteApi.port;
  const path = normalizePath(settings.remoteApi.path);

  return {
    host,
    port,
    path,
    url: `ws://${formatWebSocketHost(host)}:${port}${path}`,
    token: settings.remoteApi.token,
  };
}
