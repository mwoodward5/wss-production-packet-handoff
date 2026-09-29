import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({plugins:[react(),tailwind()],publicDir:false,envFile:false,resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/client-contract\.cjs/]}}});
