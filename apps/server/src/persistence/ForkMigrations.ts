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

const FORK_MIGRATIONS_TABLE = "effect_sql_fork_migrations";

// Fork migrations are registered here. Add new entries at the end.
const forkMigrationEntries: readonly (readonly [number, string, Effect.Effect<unknown>])[] =
  [] as const;

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
    if (forkMigrationEntries.length === 0) return [];
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
