import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new version waits until the user taps Reload, so an open form is never lost.
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "FitTrack",
        short_name: "FitTrack",
        description: "Track meals, exercise and weight, with calorie targets and reports.",
        lang: "en-IN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0f766e",
        background_color: "#f8fafc",
        categories: ["health", "fitness", "lifestyle"],
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        shortcuts: [
          { name: "Add a meal", short_name: "Meal", url: "/meals", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
          { name: "Add an activity", short_name: "Activity", url: "/activity", icons: [{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" }] },
        ],
      },
      workbox: {
        // Precache the whole app shell and every built asset so the app opens and entries can be made offline.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Reference data only (food and activity-type lists). User tables, auth and /api/* are never cached here.
            urlPattern: ({ url, request }) =>
              request.method === "GET" && url.hostname.endsWith(".supabase.co") &&
              (url.pathname === "/rest/v1/foods" || url.pathname === "/rest/v1/activity_types"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "fittrack-reference-data",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
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
