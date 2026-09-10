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
      // Dev-only: hand the local Codex CLI login to the page so the sign-in path can be tested
      // without an interactive device-code approval. Only when AI_PAINT_DEV_OAUTH=1.
      server.middlewares.use('/__devoauth', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (process.env.AI_PAINT_DEV_OAUTH !== '1') {
          res.statusCode = 404;
          res.end('{}');
          return;
        }
        try {
          const { readFile } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const a = JSON.parse(await readFile(`${homedir()}/.codex/auth.json`, 'utf8')) as { tokens: { access_token: string; refresh_token: string; id_token: string; account_id: string } };
          const claims = JSON.parse(Buffer.from(a.tokens.access_token.split('.')[1], 'base64url').toString()) as { exp?: number };
          res.end(JSON.stringify({ accessToken: a.tokens.access_token, refreshToken: a.tokens.refresh_token, idToken: a.tokens.id_token, accountId: a.tokens.account_id, expiresAt: (claims.exp ?? 0) * 1000, email: 'dev@local', plan: 'pro' }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      // Run the Vercel function locally so "Sign in with OpenAI" works under `vite`.
      server.middlewares.use('/api/codex-images', (req, res) => {
        void server.ssrLoadModule('/api/codex-images.ts').then((m) => (m.default as (q: typeof req, r: typeof res) => Promise<void>)(req, res)).catch((e) => {
          res.statusCode = 500;
          res.end(String(e));
        });
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
