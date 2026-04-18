import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationMessage, OrchestrationThread } from "./orchestration";
import { ServerSettings } from "./settings";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeOrchestrationMessage = Schema.decodeUnknownSync(OrchestrationMessage);
const decodeOrchestrationThread = Schema.decodeUnknownSync(OrchestrationThread);

describe("schema decoding defaults", () => {
  it("decodes server settings defaults for remote API without runtime errors", () => {
    const parsed = decodeServerSettings({});

    expect(parsed.remoteApi).toEqual({
      host: "127.0.0.1",
      port: 3774,
      path: "/remote/ws",
      token: "",
    });
  });

  it("decodes orchestration defaults for legacy message sender and remote access", () => {
    const message = decodeOrchestrationMessage({
      id: "message-1",
      role: "assistant",
      text: "hello",
      turnId: null,
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const thread = decodeOrchestrationThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
    });

    expect(message.sender).toBeNull();
    expect(thread.remoteAccess).toBe(false);
  });
});
