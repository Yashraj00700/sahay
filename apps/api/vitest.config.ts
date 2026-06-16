import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@sahay/db": r("../../packages/db/src"),
      "@sahay/shared": r("../../packages/shared/src"),
    },
  },
});
