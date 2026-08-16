import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mmo/shared": path.resolve(root, "shared"),
    },
  },
  server: {
    port: 8080,
    open: true,
  },
});
