import { Effect } from "effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { runThreads } from "./commands/threads";
import { runSend } from "./commands/send";

// ---------------------------------------------------------------------------
// Minimal arg parser — replaces Effect CLI which has broken subcommand
// dispatch in the current beta.
// ---------------------------------------------------------------------------

function parseFlags(argv: string[]): Record<string, string | true> {
  const result: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function printUsage(exitCode: number): never {
  console.error("Usage: l6claw-cli <command> [options]");
  console.error("");
  console.error("Commands:");
  console.error("  threads   List all threads across all projects");
  console.error("  send      Send a message to a thread");
  console.error("");
  console.error("Run l6claw-cli <command> --help for command-specific options.");
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------

const subcommand = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

if (subcommand === "--help" || subcommand === "-h" || subcommand === undefined) {
  printUsage(subcommand === undefined ? 1 : 0);
}

const program = (() => {
  switch (subcommand) {
    case "threads":
      return runThreads(flags);
    case "send":
      return runSend(flags);
    default:
      console.error(`Unknown command: ${subcommand}`);
      printUsage(1);
  }
})();

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
