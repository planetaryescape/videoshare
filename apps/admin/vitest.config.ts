import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    exclude: ["**/node_modules/**", "**/*.bun.test.ts"],
    setupFiles: ["./src/vitest-setup.ts"],
    server: {
      deps: {
        inline: ["foldkit", "@foldkit/ui"],
      },
    },
  },
});
