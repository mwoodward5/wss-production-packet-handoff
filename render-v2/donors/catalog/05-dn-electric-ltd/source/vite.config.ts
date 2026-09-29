import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: false,
  envPrefix: 'WSS_PUBLIC_',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: false,
      routeFileIgnorePattern: '^api$' }),
    react(), tailwindcss(),
  ],
  build: { outDir: '../bundle', emptyOutDir: true, sourcemap: false },
});
