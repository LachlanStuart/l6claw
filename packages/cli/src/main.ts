import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";

const cli = Command.make("l6claw-cli", {}).pipe(
  Command.withDescription("Remote CLI for T3 Code"),
  Command.withHandler(() =>
    Effect.sync(() => {
      console.error("No command specified. Use --help.");
      process.exit(1);
    }),
  ),
);

Command.run(cli, { version: "0.0.1" }).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
