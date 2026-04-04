/**
 * ForkMigrations - Fork-specific migration runner
 *
 * Maintains fork-specific schema changes separately from upstream migrations.
 * Uses a dedicated tracking table (effect_sql_fork_migrations) so that
 * fork migration IDs never conflict with upstream migration IDs.
 *
 * Fork migrations always run after upstream migrations to ensure the
 * base schema is in place before fork-specific columns/tables are added.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";

import ForkMigration0001 from "./ForkMigrations/001_ProjectionThreadMessageSender.ts";
import ForkMigration0002 from "./ForkMigrations/002_ProjectionThreadsRemoteAccess.ts";

const FORK_MIGRATIONS_TABLE = "effect_sql_fork_migrations";

// Fork migrations are registered here. Add new entries at the end.
const forkMigrationEntries = [
  [1, "ProjectionThreadMessageSender", ForkMigration0001],
  [2, "ProjectionThreadsRemoteAccess", ForkMigration0002],
] as const;

export const makeForkMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      forkMigrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export const runForkMigrations = () =>
  Effect.gen(function* () {
    yield* Effect.log("Running fork migrations...");
    const executedMigrations = yield* run({
      loader: makeForkMigrationLoader(),
      table: FORK_MIGRATIONS_TABLE,
    });
    yield* Effect.log("Fork migrations ran successfully").pipe(
      Effect.annotateLogs({
        migrations: executedMigrations.map(([id, name]) => `${id}_${name}`),
      }),
    );
    return executedMigrations;
  });
