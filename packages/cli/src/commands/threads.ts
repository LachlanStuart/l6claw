import { Cause, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { connect, WsConnectionError } from "../ws/client";

interface ThreadRow {
  projectName: string;
  threadTitle: string;
  threadId: string;
  sessionStatus: string;
}

interface SnapshotProject {
  id: string;
  title: string;
  deletedAt?: string | null;
}

interface SnapshotThread {
  id: string;
  projectId: string;
  title: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
  session?: { status: string } | null;
}

function resolveThreadRows(snapshot: {
  projects: SnapshotProject[];
  threads: SnapshotThread[];
}): ThreadRow[] {
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
  const H = {
    project: "PROJECT",
    thread: "THREAD",
    id: "ID",
    status: "STATUS",
  };
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

const urlFlag = Flag.string("url").pipe(
  Flag.withDescription("WebSocket URL of the T3 Code server. Overrides T3CODE_URL."),
  Flag.optional,
);
const tokenFlag = Flag.string("token").pipe(
  Flag.withDescription("Auth token. Overrides T3CODE_TOKEN."),
  Flag.optional,
);
const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Output as JSON array."),
  Flag.optional,
);

export const threadsCommand = Command.make("threads", {
  url: urlFlag,
  token: tokenFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List all threads across all projects."),
  Command.withHandler((opts) => {
    const url = Option.getOrUndefined(opts.url) ?? process.env["T3CODE_URL"];
    const token = Option.getOrUndefined(opts.token) ?? process.env["T3CODE_TOKEN"];
    if (!url || !token) {
      return Effect.sync(() => {
        console.error("Error: --url / T3CODE_URL and --token / T3CODE_TOKEN are required.");
        process.exit(1);
      });
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connect(url, token);
        const snapshot = (yield* client.request("orchestration.getSnapshot")) as {
          projects: SnapshotProject[];
          threads: SnapshotThread[];
        };
        const rows = resolveThreadRows(snapshot);
        if (Option.getOrElse(opts.json, () => false) === true) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          console.log(formatTable(rows));
        }
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const err = Cause.squash(cause);
          const msg =
            err instanceof WsConnectionError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          console.error(`Error: ${msg}`);
          process.exit(1);
        }),
      ),
    );
  }),
);
