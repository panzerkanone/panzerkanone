import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

// The new client. Game logic comes from ../engine and map art from ../mapart;
// nothing is imported from ../shared or ../legacy.
// The dev server watches its own folder only. The boards, the scenarios and the art live beside it, and a page
// lists them by `import.meta.glob`: without this a board or a scenario added while the server runs is not
// found until it is restarted ("no map called ... under assets/maps").
const watchBeside = (): Plugin => ({
  name: 'watch-beside',
  configureServer(server) {
    server.watcher.add([resolve(here, '../assets'), resolve(here, '../content')]);
  },
});

export default defineConfig({
  plugins: [react(), watchBeside()],
  resolve: {
    alias: {
      '@engine': resolve(here, '../engine'),
      '@mapart': resolve(here, '../mapart'),
    },
  },
  worker: { format: 'es' },
  // The map art worker reads YAML; name the package so the dev server bundles it up front
  // and does not reload the page the first time the worker starts.
  optimizeDeps: { include: ['yaml'] },
  server: {
    fs: { allow: ['..'] },
  },
  build: { target: 'es2022', sourcemap: false },
});
