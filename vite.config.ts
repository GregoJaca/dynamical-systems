import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  // GitHub Pages project site. Dev server stays at / so `npm run dev` opens at localhost:5173/.
  base: process.env.VITE_BASE_PATH || (command === 'serve' ? '/' : '/dynamical-systems/'),
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        pde: resolve(rootDir, 'pde/index.html'),
      },
    },
  },
}));
