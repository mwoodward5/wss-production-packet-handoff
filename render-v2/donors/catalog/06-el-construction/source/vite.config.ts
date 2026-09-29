import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react(),tailwind()],envDir:false,publicDir:false,resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/client-contract\.cjs$/]}}});
