export const DEFAULT_DESKTOP_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_BACKEND_PORT = 3773;

const isWildcardHost = (host: string): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

export function resolveDesktopBackendPort(env: NodeJS.ProcessEnv): number {
  const rawPort = env.T3CODE_PORT?.trim();
  if (!rawPort) {
    return DEFAULT_DESKTOP_BACKEND_PORT;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    return DEFAULT_DESKTOP_BACKEND_PORT;
  }

  return parsedPort;
}

export function resolveDesktopBackendBaseUrl(env: NodeJS.ProcessEnv): string {
  const rawHost = env.T3CODE_HOST?.trim();
  const connectHost = rawHost && !isWildcardHost(rawHost) ? rawHost : DEFAULT_DESKTOP_BACKEND_HOST;

  return `ws://${formatHostForUrl(connectHost)}:${resolveDesktopBackendPort(env)}`;
}
