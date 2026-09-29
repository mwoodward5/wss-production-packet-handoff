import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, copyFileSync } from 'node:fs';

// Browser SPA build; donor public business assets are deliberately not copied.
export default defineConfig({
  plugins:[react(),tailwindcss(),{
    name:'wss-sitemap-entry',
    closeBundle() {
      const dir=fileURLToPath(new URL('../bundle/',import.meta.url));
      mkdirSync(dir+'sitemap',{recursive:true});
      copyFileSync(dir+'index.html',dir+'sitemap/index.html');
    }
  }], publicDir:false, envDir:false,
  resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
  build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/client-contract\.cjs$/]}}
});
