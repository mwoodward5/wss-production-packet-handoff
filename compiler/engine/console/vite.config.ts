import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  vite: {
    optimizeDeps: {
      exclude: ["playwright", "playwright-core", "chromium-bidi"],
    },
    server: {
      port: 5173,
    },
    ssr: {
      external: ["playwright", "playwright-core", "chromium-bidi"],
    },
  },
});
