/**
 * Share links for "Sign in with OpenAI" access.
 *
 *   POST   { tokens, ttlMs, email?, plan? }   → { id, manageKey, expiresAt }   owner creates a link
 *   GET    (X-Share-Token: id)                → public info                    guest checks a link
 *   PUT    { id, manageKey, tokens }          → { ok }                         owner syncs refreshed tokens
 *   DELETE { id, manageKey }                  → { ok }                         owner revokes
 *
 * Guests never receive tokens; they send the id to /api/codex-images as X-Share-Token.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isShareTokens, loadOwnedShare, loadShare, MAX_TTL_MS, newShare, publicInfo, ShareStoreError, store, syncTokens } from './_share';

/** Three tokens of a few KB each plus a little metadata; anything bigger is not a real request. */
const MAX_BODY = 64 * 1024;

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ShareStoreError(413, 'Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new ShareStoreError(400, 'Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    switch (req.method) {
      case 'POST': {
        const body = await readJson(req);
        if (!isShareTokens(body.tokens)) throw new ShareStoreError(400, 'Sign in with OpenAI before sharing.');
        const ttl = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? body.ttlMs : 7 * 86_400_000;
        if (ttl > MAX_TTL_MS) throw new ShareStoreError(400, 'A share link can last at most 90 days.');
        const rec = newShare(body.tokens, ttl, { email: str(body.email) || undefined, plan: str(body.plan) || undefined });
        await store().put(rec);
        send(res, 200, { id: rec.id, manageKey: rec.manageKey, expiresAt: rec.expiresAt });
        return;
      }
      case 'GET': {
        // The id travels in a header, never the URL, so it stays out of request logs.
        send(res, 200, await publicInfo(await loadShare(str(req.headers['x-share-token']))));
        return;
      }
      case 'PUT': {
        const body = await readJson(req);
        const rec = await loadOwnedShare(str(body.id), str(body.manageKey));
        if (!isShareTokens(body.tokens)) throw new ShareStoreError(400, 'Missing tokens.');
        await syncTokens(rec, body.tokens);
        send(res, 200, { ok: true, ...(await publicInfo(rec)) });
        return;
      }
      case 'DELETE': {
        const body = await readJson(req);
        const rec = await loadOwnedShare(str(body.id), str(body.manageKey));
        await store().del(rec.id);
        send(res, 200, { ok: true });
        return;
      }
      default:
        res.setHeader('Allow', 'GET, POST, PUT, DELETE');
        send(res, 405, { error: { message: 'Method Not Allowed' } });
    }
  } catch (e) {
    const status = e instanceof ShareStoreError ? e.status : 500;
    send(res, status, { error: { message: e instanceof Error ? e.message : String(e) } });
  }
}
