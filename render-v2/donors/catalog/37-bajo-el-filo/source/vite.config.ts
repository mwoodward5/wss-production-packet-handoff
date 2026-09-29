import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react(),tailwind()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},publicDir:false,envDir:false,build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/core\.cjs/,/client-site-data\.cjs/]}},base:'/'});
