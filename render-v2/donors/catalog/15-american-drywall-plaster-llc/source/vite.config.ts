import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {tanstackRouter} from '@tanstack/router-plugin/vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[tanstackRouter({target:'react',autoCodeSplitting:false,routeFileIgnorePattern:'api'}),react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},publicDir:false,build:{outDir:'../bundle',emptyOutDir:true},envDir:false as never});
