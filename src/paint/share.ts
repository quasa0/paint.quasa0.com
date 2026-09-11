/**
 * Share links: let other people run AI edits on this account's ChatGPT plan.
 *
 * The owner (signed in with OpenAI) posts their tokens to /api/share and gets back an id plus a
 * manage key. The link carries only the id (in the URL fragment, so it never reaches server logs).
 * A guest who opens it stores the id and sends it as X-Share-Token; the relay swaps it for the
 * owner's session. Tokens never leave the server on the guest side.
 */
import type { OAuthTokens } from './oauth';

/** A link this browser created; the manage key can revoke it. */
export interface OwnerShare {
  id: string;
  manageKey: string;
  expiresAt: number;
}

/** A link this browser opened; only public facts about the owner. */
export interface GuestShare {
  id: string;
  ownerEmail?: string;
  ownerPlan?: string;
  expiresAt: number;
}

export class ShareError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const OWNER_KEY = 'ai-paint:share-owner';
const GUEST_KEY = 'ai-paint:share-guest';
const HASH_PARAM = 'share';

export const SHARE_TTL_OPTIONS: { label: string; ms: number }[] = [
  { label: '1 day', ms: 86_400_000 },
  { label: '7 days', ms: 7 * 86_400_000 },
  { label: '30 days', ms: 30 * 86_400_000 },
  { label: '90 days', ms: 90 * 86_400_000 },
];

export function shareUrl(id: string): string {
  return `${location.origin}/app/#${HASH_PARAM}=${encodeURIComponent(id)}`;
}

/** Pull a share id out of the URL fragment (never the query, which would reach server logs) and clean the address bar. */
export function takeShareFromUrl(): string | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const id = hash.get(HASH_PARAM);
  if (!id) return null;
  hash.delete(HASH_PARAM);
  const h = hash.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}${h ? `#${h}` : ''}`);
  return id;
}

async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ShareError(0, 'Could not reach the server.');
  }
  const text = await res.text();
  let json: { error?: { message?: string } } & Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ShareError(res.status, json.error?.message ?? `Share request failed (${res.status}).`);
  return json as T;
}

export function createShare(tokens: OAuthTokens, ttlMs: number): Promise<OwnerShare> {
  const { accessToken, refreshToken, idToken, accountId, expiresAt, email, plan } = tokens;
  return api<OwnerShare>('POST', '/api/share', { tokens: { accessToken, refreshToken, idToken, accountId, expiresAt }, ttlMs, email, plan });
}

export function fetchShare(id: string): Promise<GuestShare> {
  return api<GuestShare>('GET', '/api/share', undefined, { 'X-Share-Token': id });
}

/** Keep the server copy current after this browser refreshed its own tokens. */
export function syncShare(share: OwnerShare, tokens: OAuthTokens): Promise<GuestShare> {
  const { accessToken, refreshToken, idToken, accountId, expiresAt } = tokens;
  return api<GuestShare>('PUT', '/api/share', { id: share.id, manageKey: share.manageKey, tokens: { accessToken, refreshToken, idToken, accountId, expiresAt } });
}

export function revokeShare(share: OwnerShare): Promise<void> {
  return api<void>('DELETE', '/api/share', { id: share.id, manageKey: share.manageKey });
}

/* ---------- persistence ---------- */

function load<T extends { expiresAt: number }>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as T) : null;
    return v && v.expiresAt > Date.now() ? v : null;
  } catch {
    return null;
  }
}

/** Throws when storage is unavailable: a share whose manage key is lost could never be revoked. */
function save(key: string, value: unknown): void {
  if (value) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}

export const loadOwnerShare = (): OwnerShare | null => load<OwnerShare>(OWNER_KEY);
export const saveOwnerShare = (s: OwnerShare | null): void => save(OWNER_KEY, s);
export const loadGuestShare = (): GuestShare | null => load<GuestShare>(GUEST_KEY);
export const saveGuestShare = (s: GuestShare | null): void => save(GUEST_KEY, s);
