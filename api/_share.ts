/**
 * Share links: an owner who signed in with OpenAI hands out a link, and everyone who opens it
 * gets image edits relayed through the owner's ChatGPT session. The owner's tokens live only
 * here (Redis over REST); guests hold an opaque share id and never see the tokens.
 *
 * Files under api/ that start with "_" are helpers, not Vercel functions.
 */
import { randomBytes } from 'node:crypto';

export interface ShareTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  /** Unix ms when the access token expires. */
  expiresAt: number;
}

export interface ShareRecord {
  id: string;
  /** Secret the owner keeps; required to sync tokens or revoke. */
  manageKey: string;
  tokens: ShareTokens;
  ownerEmail?: string;
  ownerPlan?: string;
  createdAt: number;
  /** Unix ms when the link stops working. */
  expiresAt: number;
}

export class ShareStoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const MAX_TTL_MS = 90 * 86_400_000;

/* ---------- storage ---------- */

interface Store {
  get(id: string): Promise<ShareRecord | null>;
  put(rec: ShareRecord): Promise<void>;
  /** Write only if the record still exists, so a refresh cannot resurrect a revoked share. */
  update(rec: ShareRecord): Promise<boolean>;
  del(id: string): Promise<void>;
  /** Hold a short exclusive lock while refreshing; false when someone else holds it. */
  lock(id: string, ms: number): Promise<boolean>;
  unlock(id: string): Promise<void>;
  /** Sliding-window request count for the relay; returns the count in the current window. */
  hit(id: string, windowSec: number): Promise<number>;
  /** Count one successful edit; kept apart from the record so guests never race the owner's token writes. */
  bump(id: string): Promise<void>;
  uses(id: string): Promise<number>;
}

function redisEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function redisStore(env: { url: string; token: string }): Store {
  const call = async (cmd: (string | number)[]): Promise<unknown> => {
    const res = await fetch(env.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (!res.ok) throw new ShareStoreError(503, `Share storage failed (${res.status}).`);
    const j = (await res.json()) as { result?: unknown; error?: string };
    if (j.error) throw new ShareStoreError(503, `Share storage failed: ${j.error}`);
    return j.result;
  };
  const key = (id: string) => `share:${id}`;
  const usesKey = (id: string) => `share:${id}:uses`;
  const ttlOf = (rec: ShareRecord) => Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
  return {
    async get(id) {
      const raw = await call(['GET', key(id)]);
      return typeof raw === 'string' ? (JSON.parse(raw) as ShareRecord) : null;
    },
    async put(rec) {
      await call(['SET', key(rec.id), JSON.stringify(rec), 'EX', ttlOf(rec)]);
    },
    async update(rec) {
      return (await call(['SET', key(rec.id), JSON.stringify(rec), 'EX', ttlOf(rec), 'XX'])) === 'OK';
    },
    async del(id) {
      await call(['DEL', key(id), usesKey(id), `${key(id)}:lock`, `${key(id)}:rate`]);
    },
    async lock(id, ms) {
      return (await call(['SET', `${key(id)}:lock`, '1', 'PX', ms, 'NX'])) === 'OK';
    },
    async unlock(id) {
      await call(['DEL', `${key(id)}:lock`]);
    },
    async hit(id, windowSec) {
      const n = Number(await call(['INCR', `${key(id)}:rate`]));
      if (n === 1) await call(['EXPIRE', `${key(id)}:rate`, windowSec]);
      return n;
    },
    async bump(id) {
      await call(['INCR', usesKey(id)]);
      await call(['EXPIRE', usesKey(id), MAX_TTL_MS / 1000]);
    },
    async uses(id) {
      const n = await call(['GET', usesKey(id)]);
      return Number(n ?? 0);
    },
  };
}

/** Local `vite` only: shares live in this process. Never used on Vercel. */
const memory = new Map<string, ShareRecord>();
const memoryUses = new Map<string, number>();
const memoryLocks = new Map<string, number>();
const memoryRate = new Map<string, { n: number; until: number }>();
let warned = false;
function memoryStore(): Store {
  if (!warned) {
    warned = true;
    console.warn('[share] No KV_REST_API_URL/KV_REST_API_TOKEN set; share links are kept in memory for this dev server only.');
  }
  return {
    async get(id) {
      const rec = memory.get(id) ?? null;
      return rec && rec.expiresAt > Date.now() ? rec : null;
    },
    async put(rec) {
      memory.set(rec.id, rec);
    },
    async update(rec) {
      if (!memory.has(rec.id)) return false;
      memory.set(rec.id, rec);
      return true;
    },
    async del(id) {
      memory.delete(id);
      memoryUses.delete(id);
      memoryLocks.delete(id);
      memoryRate.delete(id);
    },
    async lock(id, ms) {
      const until = memoryLocks.get(id) ?? 0;
      if (until > Date.now()) return false;
      memoryLocks.set(id, Date.now() + ms);
      return true;
    },
    async unlock(id) {
      memoryLocks.delete(id);
    },
    async hit(id, windowSec) {
      const cur = memoryRate.get(id);
      const next = cur && cur.until > Date.now() ? { n: cur.n + 1, until: cur.until } : { n: 1, until: Date.now() + windowSec * 1000 };
      memoryRate.set(id, next);
      return next.n;
    },
    async bump(id) {
      memoryUses.set(id, (memoryUses.get(id) ?? 0) + 1);
    },
    async uses(id) {
      return memoryUses.get(id) ?? 0;
    },
  };
}

export function store(): Store {
  const env = redisEnv();
  if (env) return redisStore(env);
  if (!process.env.VERCEL) return memoryStore();
  throw new ShareStoreError(503, 'Sharing is not set up on this deployment (missing KV_REST_API_URL / KV_REST_API_TOKEN).');
}

/* ---------- records ---------- */

const token = () => randomBytes(18).toString('base64url');

/** Generous ceiling for a token field; real OpenAI JWTs are a few KB. Keeps junk out of storage. */
const MAX_TOKEN_CHARS = 8192;
const str = (v: unknown, max = MAX_TOKEN_CHARS): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Well-formed OpenAI tokens: strings of sane size and an access token that is a JWT still valid. */
export function isShareTokens(v: unknown): v is ShareTokens {
  const t = v as Partial<ShareTokens> | null;
  if (!t || !str(t.accessToken) || !str(t.refreshToken) || !str(t.idToken) || !str(t.accountId, 128) || typeof t.expiresAt !== 'number') return false;
  const exp = jwtExp(t.accessToken);
  return exp !== null && exp > Date.now();
}

export function newShare(tokens: ShareTokens, ttlMs: number, owner: { email?: string; plan?: string }): ShareRecord {
  const now = Date.now();
  return {
    id: token(),
    manageKey: token(),
    tokens,
    ownerEmail: owner.email,
    ownerPlan: owner.plan,
    createdAt: now,
    expiresAt: now + Math.min(MAX_TTL_MS, Math.max(60_000, ttlMs)),
  };
}

export interface ShareInfo {
  id: string;
  ownerEmail?: string;
  ownerPlan?: string;
  expiresAt: number;
  /** Successful edits made through the link so far. */
  uses: number;
}

/** What a guest may see about a share. */
export async function publicInfo(rec: ShareRecord): Promise<ShareInfo> {
  return { id: rec.id, ownerEmail: rec.ownerEmail, ownerPlan: rec.ownerPlan, expiresAt: rec.expiresAt, uses: await store().uses(rec.id) };
}

/** Load a share for use by a guest, rejecting missing or expired ones. */
export async function loadShare(id: string): Promise<ShareRecord> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new ShareStoreError(400, 'Malformed share id.');
  const rec = await store().get(id);
  if (!rec || rec.expiresAt <= Date.now()) throw new ShareStoreError(404, 'This share link is no longer valid.');
  return rec;
}

/** Load a share for its owner: the manage key must match. */
export async function loadOwnedShare(id: string, manageKey: string): Promise<ShareRecord> {
  const rec = await loadShare(id);
  if (typeof manageKey !== 'string' || !manageKey || manageKey !== rec.manageKey) throw new ShareStoreError(403, 'Not the owner of this share.');
  return rec;
}

/* ---------- OpenAI token refresh (server copy of src/paint/oauth.ts) ---------- */

function jwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1] ?? '';
    const j = JSON.parse(Buffer.from(part, 'base64url').toString()) as { exp?: number };
    return typeof j.exp === 'number' ? j.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Errors that mean the link itself is dead (guests should drop it), as opposed to a passing outage. */
export const isShareRejected = (status: number): boolean => status === 400 || status === 401 || status === 403 || status === 404;

async function refresh(t: ShareTokens): Promise<ShareTokens> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: CLIENT_ID });
  let res: Response;
  try {
    res = await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch {
    throw new ShareStoreError(502, "Could not reach OpenAI to refresh the owner's session. Try again.");
  }
  // 400/401 from the token endpoint is a definitive rejection (invalid_grant); anything else is OpenAI having a moment.
  if (res.status === 400 || res.status === 401) throw new ShareStoreError(401, "The owner's OpenAI session expired. Ask them to sign in and share again.");
  if (!res.ok) throw new ShareStoreError(502, `OpenAI could not refresh the owner's session (${res.status}). Try again.`);
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string };
  if (!str(j.access_token)) throw new ShareStoreError(502, 'OpenAI returned no access token.');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? t.refreshToken,
    idToken: j.id_token ?? t.idToken,
    accountId: t.accountId,
    expiresAt: jwtExp(j.access_token) ?? Date.now() + 3600_000,
  };
}

const LOCK_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tokens valid for at least a minute, refreshed and written back when needed. One refresh at a
 * time per share: concurrent guests wait for the holder and reuse its result, so the owner's
 * refresh token is never spent twice. `force` refreshes even if the token looks valid (upstream 401).
 */
export async function freshTokens(rec: ShareRecord, force = false): Promise<ShareTokens> {
  const s = store();
  if (!force && rec.tokens.expiresAt - Date.now() > 60_000) return rec.tokens;
  const deadline = Date.now() + LOCK_MS;
  while (!(await s.lock(rec.id, LOCK_MS))) {
    if (Date.now() > deadline) throw new ShareStoreError(503, 'The share is busy. Try again.');
    await sleep(400);
    const cur = await s.get(rec.id);
    if (!cur) throw new ShareStoreError(404, 'This share link is no longer valid.');
    if (cur.tokens.accessToken !== rec.tokens.accessToken) return cur.tokens;
  }
  try {
    const cur = await s.get(rec.id);
    if (!cur) throw new ShareStoreError(404, 'This share link is no longer valid.');
    if (cur.tokens.accessToken !== rec.tokens.accessToken && cur.tokens.expiresAt - Date.now() > 60_000) return cur.tokens;
    const tokens = await refresh(cur.tokens);
    if (!(await s.update({ ...cur, tokens }))) throw new ShareStoreError(404, 'This share link is no longer valid.');
    return tokens;
  } finally {
    await s.unlock(rec.id);
  }
}

/** Owner sync: accept only tokens at least as new as the stored ones, so a stale browser copy never clobbers a server refresh. */
export async function syncTokens(rec: ShareRecord, tokens: ShareTokens): Promise<void> {
  if (tokens.expiresAt < rec.tokens.expiresAt) return;
  if (!(await store().update({ ...rec, tokens }))) throw new ShareStoreError(404, 'This share link is no longer valid.');
}

/** Edits per share within a window; a leaked link cannot drain the owner's plan in minutes. */
const RATE_WINDOW_SEC = 600;
const RATE_LIMIT = 40;

export async function checkRate(rec: ShareRecord): Promise<void> {
  const n = await store().hit(rec.id, RATE_WINDOW_SEC);
  if (n > RATE_LIMIT) throw new ShareStoreError(429, `This share link is limited to ${RATE_LIMIT} edits per ${RATE_WINDOW_SEC / 60} minutes. Try again later.`);
}

export function recordUse(rec: ShareRecord): Promise<void> {
  return store().bump(rec.id);
}
