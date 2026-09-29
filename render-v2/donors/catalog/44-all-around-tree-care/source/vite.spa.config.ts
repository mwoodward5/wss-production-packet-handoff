import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Browser-only donor adaptation. No SSR, public donor assets, environment loading,
// server handlers, Cloudflare workers, or external build plugins.
export default defineConfig({
  envDir: false,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "../bundle", emptyOutDir: true,
    commonjsOptions: { include: [/node_modules/, /WSS-CONTRACTS/] },
  },
});
