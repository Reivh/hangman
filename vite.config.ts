import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // --host so phones on the same Wi-Fi can open the dev server.
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 2500 },
});
