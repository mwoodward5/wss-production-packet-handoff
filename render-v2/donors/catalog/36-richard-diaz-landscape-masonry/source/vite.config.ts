import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  publicDir: false,
  build: {
    outDir: "../bundle",
    emptyOutDir: true,
    commonjsOptions: { include: [/node_modules/, /WSS-CONTRACTS/] },
  },
});
