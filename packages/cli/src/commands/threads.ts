import { Cause, Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { REMOTE_API_METHODS, RemoteApiRpcGroup } from "@t3tools/contracts";
import type { RemoteThreadsListResult } from "@t3tools/contracts";
import { makeRpcLayer } from "../ws/client";

type ThreadRow = RemoteThreadsListResult["threads"][number];

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function pad(s: string, w: number): string {
  return s.padEnd(w);
}

function formatTable(rows: ReadonlyArray<ThreadRow>): string {
  if (rows.length === 0) return "No threads found.";
  const H = {
    project: "PROJECT",
    thread: "THREAD",
    id: "ID",
    remote: "REMOTE",
    status: "STATUS",
  };
  const pw = Math.max(H.project.length, ...rows.map((r) => r.projectName.length));
  const tw = Math.max(H.thread.length, ...rows.map((r) => truncate(r.threadTitle, 60).length));
  const iw = Math.max(H.id.length, ...rows.map((r) => r.threadId.length));
  const rw = H.remote.length;
  const header = `${pad(H.project, pw)}  ${pad(H.thread, tw)}  ${pad(H.id, iw)}  ${pad(H.remote, rw)}  ${H.status}`;
  const lines = rows.map(
    (row) =>
      `${pad(row.projectName, pw)}  ${pad(truncate(row.threadTitle, 60), tw)}  ${pad(row.threadId, iw)}  ${pad(row.remoteAccess ? "on" : "off", rw)}  ${row.sessionStatus}`,
  );
  return [header, ...lines].join("\n");
}

function printHelp() {
  console.log("Usage: l6claw-cli threads [options]");
  console.log("");
  console.log("List all threads exposed through the remote agent API.");
  console.log("");
  console.log("Options:");
  console.log("  --url <url>      Remote API WebSocket URL. Overrides L6CLAW_REMOTE_URL.");
  console.log("  --token <token>  Remote API token. Overrides L6CLAW_REMOTE_TOKEN.");
  console.log("  --json           Output as JSON array.");
  console.log("  --help           Show this help message.");
  process.exit(0);
}

export const runThreads = (flags: Record<string, string | true>) => {
  if (flags.help === true) printHelp();

  const url =
    (typeof flags.url === "string" ? flags.url : undefined) ??
    process.env["L6CLAW_REMOTE_URL"] ??
    process.env["T3CODE_URL"];
  const token =
    (typeof flags.token === "string" ? flags.token : undefined) ??
    process.env["L6CLAW_REMOTE_TOKEN"] ??
    process.env["T3CODE_TOKEN"];
  const json = flags.json === true;

  if (!url || !token) {
    console.error(
      "Error: --url / L6CLAW_REMOTE_URL and --token / L6CLAW_REMOTE_TOKEN are required.",
    );
    process.exit(1);
  }

  return Effect.gen(function* () {
    const client = yield* RpcClient.make(RemoteApiRpcGroup);
    const result = yield* client[REMOTE_API_METHODS.threadsList]({});
    if (json) {
      console.log(JSON.stringify(result.threads, null, 2));
    } else {
      console.log(formatTable(result.threads));
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
