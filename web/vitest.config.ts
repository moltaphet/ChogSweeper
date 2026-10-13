import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  // The in-process Postgres (pglite) tests can take longer than the 5s default to start on a loaded machine.
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
