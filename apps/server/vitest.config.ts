import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

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
