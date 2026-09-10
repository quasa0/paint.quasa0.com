import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only helper: serves the OpenAI key from the AI_PAINT_TEST_KEY env var at /__devkey so
 * automated browser tests can call window.__paint.setApiKey() without the key ever being
 * typed or logged. Never included in production builds.
 */
function devKeyPlugin(): Plugin {
  return {
    name: 'ai-paint-dev-key',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__devkey', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end(process.env.AI_PAINT_TEST_KEY ?? '');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devKeyPlugin()],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
});
