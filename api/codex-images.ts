/**
 * Proxy for "Sign in with OpenAI" image edits.
 *
 * chatgpt.com does not allow browser origins, so the app posts here and this function forwards
 * the request unchanged to the Codex backend with the caller's own bearer token. Nothing is
 * stored or logged; the function only relays the response.
 *
 * With an X-Share-Token header instead of a bearer token, the request runs on the session of
 * the owner who created that share link (see api/share.ts). The guest never sees the tokens.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkRate, freshTokens, isShareRejected, loadShare, recordUse, ShareStoreError, type ShareRecord } from './_share';

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
  let auth = req.headers.authorization;
  let account = req.headers['chatgpt-account-id'];
  let share: ShareRecord | null = null;
  const shareId = req.headers['x-share-token'];
  // Share errors carry `share: true` only when the link itself is dead, so guests drop it; outages stay retryable.
  const shareFailure = (e: unknown) => {
    const status = e instanceof ShareStoreError ? e.status : 500;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e), share: isShareRejected(status) } }));
  };
  if (typeof shareId === 'string' && shareId) {
    try {
      share = await loadShare(shareId);
      await checkRate(share);
      const tokens = await freshTokens(share);
      auth = `Bearer ${tokens.accessToken}`;
      account = tokens.accountId;
    } catch (e) {
      shareFailure(e);
      return;
    }
  }
  if (!auth?.startsWith('Bearer ') || typeof account !== 'string' || !account) {
    res.statusCode = 401;
    res.end('Missing OpenAI session');
    return;
  }
  const body = await readBody(req);
  const relay = (bearer: string, acct: string) =>
    fetch(UPSTREAM + op, {
      method: 'POST',
      headers: {
        Authorization: bearer,
        'chatgpt-account-id': acct,
        'Content-Type': 'application/json',
        'User-Agent': 'paint.quasa0.com (+https://github.com/quasa0/paint.quasa0.com)',
      },
      body,
    });
  let upstream: Response;
  try {
    upstream = await relay(auth, account);
    // The owner's session may have been revoked before its token expired: refresh once, then give up on the link.
    if (share && upstream.status === 401) {
      let tokens;
      try {
        tokens = await freshTokens(share, true);
      } catch (e) {
        shareFailure(e);
        return;
      }
      upstream = await relay(`Bearer ${tokens.accessToken}`, tokens.accountId);
      if (upstream.status === 401) {
        shareFailure(new ShareStoreError(401, "The owner's OpenAI session is no longer valid. Ask them to sign in and share again."));
        return;
      }
    }
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Could not reach OpenAI.' } }));
    return;
  }
  const payload = new Uint8Array(await upstream.arrayBuffer());
  if (upstream.ok && share) await recordUse(share).catch(() => undefined);
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}
