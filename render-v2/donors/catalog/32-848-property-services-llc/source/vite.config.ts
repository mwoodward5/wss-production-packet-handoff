// Browser-only build. Preserve the TanStack routes without server or provider plugins.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 plugins:[tanstackRouter({target:'react',autoCodeSplitting:false,routeFileIgnorePattern:'api'}),react(),tailwind()],
 resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
 publicDir:false, envDir:false,
 build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/WSS-CONTRACTS/]}}
});
