import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_BACKEND_PORT,
  resolveDesktopBackendBaseUrl,
  resolveDesktopBackendPort,
} from "./backendConnection";

describe("resolveDesktopBackendPort", () => {
  it("uses the desktop default port when T3CODE_PORT is unset", () => {
    expect(resolveDesktopBackendPort({})).toBe(DEFAULT_DESKTOP_BACKEND_PORT);
  });

  it("uses T3CODE_PORT when it contains a valid port number", () => {
    expect(resolveDesktopBackendPort({ T3CODE_PORT: "4888" })).toBe(4888);
  });

  it("falls back to the desktop default port for invalid T3CODE_PORT values", () => {
    expect(resolveDesktopBackendPort({ T3CODE_PORT: "abc" })).toBe(DEFAULT_DESKTOP_BACKEND_PORT);
    expect(resolveDesktopBackendPort({ T3CODE_PORT: "0" })).toBe(DEFAULT_DESKTOP_BACKEND_PORT);
    expect(resolveDesktopBackendPort({ T3CODE_PORT: "65536" })).toBe(DEFAULT_DESKTOP_BACKEND_PORT);
  });
});

describe("resolveDesktopBackendBaseUrl", () => {
  it("defaults to loopback for renderer connections", () => {
    expect(resolveDesktopBackendBaseUrl({})).toBe(`ws://127.0.0.1:${DEFAULT_DESKTOP_BACKEND_PORT}`);
  });

  it("reuses explicit non-wildcard hosts", () => {
    expect(
      resolveDesktopBackendBaseUrl({
        T3CODE_HOST: "100.64.1.2",
        T3CODE_PORT: "4888",
      }),
    ).toBe("ws://100.64.1.2:4888");
  });

  it("maps wildcard bind hosts back to loopback for the local renderer", () => {
    expect(resolveDesktopBackendBaseUrl({ T3CODE_HOST: "0.0.0.0" })).toBe(
      `ws://127.0.0.1:${DEFAULT_DESKTOP_BACKEND_PORT}`,
    );
  });

  it("formats IPv6 hosts for URL use", () => {
    expect(
      resolveDesktopBackendBaseUrl({
        T3CODE_HOST: "fd00::123",
        T3CODE_PORT: "4888",
      }),
    ).toBe("ws://[fd00::123]:4888");
  });
});
