import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 plugins:[react(),tailwindcss(),{
  name:'donor-safe-crawler-policy',
  generateBundle(){this.emitFile({type:'asset',fileName:'robots.txt',source:'User-agent: *\nAllow: /\n'});},
 }],
 resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
 // The original public folder contains business facts. Emit only safe assets.
 publicDir:false,
 build:{outDir:'../bundle',emptyOutDir:true},
});
