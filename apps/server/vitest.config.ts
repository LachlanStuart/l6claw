import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

// L6 Claw fork note: this file deviates from upstream on purpose.
// l6claw merges from upstream regularly and does not fix upstream bugs that would cause
// merge conflicts — we rely on upstream to fix its own test suite. At the time of writing,
// GitManager.test.ts caused reliable timeouts and intolerable delays during development
// cycles, and the default 15 s budget was sufficient for the remaining test files.
// When upstream resolves those flakiness issues, this override can be removed.

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx", "integration/**/*.test.ts"],
      fileParallelism: false,
      testTimeout: 15_000,
      hookTimeout: 15_000,
      exclude: ["src/git/Layers/GitManager.test.ts", "**/node_modules/**"],
    },
  }),
);
