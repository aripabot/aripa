import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@aripabot/bot": fileURLToPath(new URL("./src", import.meta.url)),
      "@aripabot/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
