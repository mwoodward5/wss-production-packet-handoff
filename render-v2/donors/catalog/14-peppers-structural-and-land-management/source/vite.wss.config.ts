import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({envDir:false,publicDir:false,plugins:[react(),tailwindcss()],resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/WSS-CONTRACTS/]}}});
