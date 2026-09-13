import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), foldkit({ devToolsMcpPort: 9988 })],
  server: {
    host: process.env.HOST ?? "localhost",
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 5176,
    proxy: {
      "/api": "http://localhost:3001",
      "/media": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
