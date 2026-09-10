/**
 * Proxy for "Sign in with OpenAI" image edits.
 *
 * chatgpt.com does not allow browser origins, so the app posts here and this function forwards
 * the request unchanged to the Codex backend with the caller's own bearer token. Nothing is
 * stored or logged; the function only relays the response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const UPSTREAM = 'https://chatgpt.com/backend-api/codex/images/';
const ALLOWED = new Set(['edits', 'generations']);

export const config = { maxDuration: 300 };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const op = url.searchParams.get('op') ?? 'edits';
  if (!ALLOWED.has(op)) {
    res.statusCode = 400;
    res.end('Unknown operation');
    return;
  }
  const auth = req.headers.authorization;
  const account = req.headers['chatgpt-account-id'];
  if (!auth?.startsWith('Bearer ') || typeof account !== 'string' || !account) {
    res.statusCode = 401;
    res.end('Missing OpenAI session');
    return;
  }
  const body = await readBody(req);
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + op, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'chatgpt-account-id': account,
        'Content-Type': 'application/json',
        'User-Agent': 'paint.quasa0.com (+https://github.com/quasa0/paint.quasa0.com)',
      },
      body,
    });
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Could not reach OpenAI.' } }));
    return;
  }
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(new Uint8Array(await upstream.arrayBuffer()));
}
