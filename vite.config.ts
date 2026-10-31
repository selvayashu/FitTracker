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
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks cache well across deploys; chart code stays in lazy chunks.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "src/**/*.test.{ts,tsx}", "functions/**/*.test.ts"],
    environment: "node",
  },
});
