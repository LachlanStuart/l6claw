import { Cause, Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { ORCHESTRATION_WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import type { OrchestrationReadModel } from "@t3tools/contracts";
import { makeRpcLayer } from "../ws/client";

// ── View helpers ────────────────────────────────────────────────────────

interface ThreadRow {
  projectName: string;
  threadTitle: string;
  threadId: string;
  sessionStatus: string;
}

function resolveThreadRows(snapshot: OrchestrationReadModel): ThreadRow[] {
  const projectMap = new Map(
    snapshot.projects.filter((p) => !p.deletedAt).map((p) => [p.id, p.title]),
  );

  return snapshot.threads
    .filter((t) => !t.archivedAt && !t.deletedAt && projectMap.has(t.projectId))
    .map((t) => ({
      projectName: projectMap.get(t.projectId)!,
      threadTitle: t.title,
      threadId: t.id,
      sessionStatus: t.session?.status ?? "idle",
    }))
    .toSorted(
      (a, b) =>
        a.projectName.localeCompare(b.projectName) || a.threadTitle.localeCompare(b.threadTitle),
    );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function pad(s: string, w: number): string {
  return s.padEnd(w);
}

function formatTable(rows: ThreadRow[]): string {
  if (rows.length === 0) return "No threads found.";
  const H = { project: "PROJECT", thread: "THREAD", id: "ID", status: "STATUS" };
  const pw = Math.max(H.project.length, ...rows.map((r) => r.projectName.length));
  const tw = Math.max(H.thread.length, ...rows.map((r) => truncate(r.threadTitle, 60).length));
  const iw = Math.max(H.id.length, ...rows.map((r) => r.threadId.length));
  const header = `${pad(H.project, pw)}  ${pad(H.thread, tw)}  ${pad(H.id, iw)}  ${H.status}`;
  const lines = rows.map(
    (r) =>
      `${pad(r.projectName, pw)}  ${pad(truncate(r.threadTitle, 60), tw)}  ${pad(r.threadId, iw)}  ${r.sessionStatus}`,
  );
  return [header, ...lines].join("\n");
}

// ── Help ────────────────────────────────────────────────────────────────

function printHelp(): never {
  console.log("Usage: l6claw-cli threads [options]");
  console.log("");
  console.log("List all threads across all projects.");
  console.log("");
  console.log("Options:");
  console.log("  --url <url>      WebSocket URL of the T3 Code server. Overrides T3CODE_URL.");
  console.log("  --token <token>  Auth token. Overrides T3CODE_TOKEN.");
  console.log("  --json           Output as JSON array.");
  console.log("  --help           Show this help message.");
  process.exit(0);
}

// ── Command entry point ─────────────────────────────────────────────────

export const runThreads = (flags: Record<string, string | true>) => {
  if (flags.help === true) printHelp();

  const url = (typeof flags.url === "string" ? flags.url : undefined) ?? process.env["T3CODE_URL"];
  const token =
    (typeof flags.token === "string" ? flags.token : undefined) ?? process.env["T3CODE_TOKEN"];
  const json = flags.json === true;

  if (!url || !token) {
    console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
    process.exit(1);
  }

  return Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);
    const snapshot = yield* client[ORCHESTRATION_WS_METHODS.getSnapshot]({});
    const rows = resolveThreadRows(snapshot);
    if (json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(formatTable(rows));
    }
  }).pipe(
    Effect.provide(makeRpcLayer(url, token)),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const err = Cause.squash(cause);
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }),
    ),
  );
};
