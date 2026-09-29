import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({plugins:[react(),tailwindcss()],envDir:false,publicDir:false,resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{outDir:'../bundle',emptyOutDir:true,commonjsOptions:{include:[/(client-contract|donor-policy)\.cjs$/, /node_modules/]}}});
