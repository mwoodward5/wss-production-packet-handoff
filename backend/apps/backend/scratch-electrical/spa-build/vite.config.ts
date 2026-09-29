import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// CLIENT-SPA donor build — the plumbing-verbatim / scratch-concrete recipe:
// ONE self-contained bundle (inlineDynamicImports), no manualChunks (gotcha:
// "react/" patterns never fire on Windows backslash paths), no lovable-tagger.
// The WSS shell (index.html) owns <head>: tokens, NEED blocks and the
// hero-video-ladder island + runtime.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 4096,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
