import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@fittrack/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
