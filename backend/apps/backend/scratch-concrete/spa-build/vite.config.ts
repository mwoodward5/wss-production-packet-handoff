import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// CLIENT-SPA build of the EL Construction TanStack design — the same recipe
// C:/ports/_builds/plumbing-verbatim used to turn the Harter TanStack Start
// project into donors-clean/plumbing-clean:
//
//   * no @lovable.dev/vite-tanstack-config, no tanstackStart, no nitro,
//     no cloudflare plugin -> no SSR half, no prerender, no $_TSR stream
//     barrier in the shipped HTML, so there is nothing for React to hydrate
//     against and no hydration-mismatch class at all;
//   * the routeTree + createFileRoute calls are router-CORE, so the design's
//     twelve routes keep working client-side;
//   * the WSS shell (index.html) owns <head>: tokens, NEED blocks, ld+json,
//     the hero-video ladder island and its runtime;
//   * ONE self-contained bundle (no manualChunks) -> no cross-chunk ESM
//     imports, which is the shape every robust donor in donors-clean ships
//     and the shape that cannot be CommonJS-transpiled into
//     "exports is not defined" at serve time.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 4096,
    // One chunk. The donor loader ships whatever is emitted; a single
    // self-contained bundle is what keeps the ESM invariant trivially true.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
