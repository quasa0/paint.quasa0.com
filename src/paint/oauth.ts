/**
 * "Sign in with OpenAI": the device-code OAuth flow used by Codex CLI, run from the browser.
 *
 * 1. POST /api/accounts/deviceauth/usercode → { device_auth_id, user_code, interval }
 * 2. The user opens https://auth.openai.com/codex/device and enters the code.
 * 3. Poll POST /api/accounts/deviceauth/token → 403 while pending, 200 with an authorization code.
 * 4. Exchange the code at /oauth/token (PKCE values are issued by the server in step 3).
 *
 * Tokens are kept in localStorage (mirrored to IndexedDB) and refreshed with the refresh token.
 * Image requests go through /api/codex-images because chatgpt.com does not allow browser origins.
 */

const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const VERIFY_URL = `${ISSUER}/codex/device`;
const STORE_KEY = 'ai-paint:openai-oauth';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  /** Unix ms when the access token expires. */
  expiresAt: number;
  email?: string;
  plan?: string;
}

export interface DeviceCode {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  expiresAt: number;
}

export class OAuthError extends Error {}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tokensFromResponse(r: { access_token: string; refresh_token: string; id_token: string }): OAuthTokens {
  const id = decodeJwt(r.id_token);
  const access = decodeJwt(r.access_token);
  const auth = (id['https://api.openai.com/auth'] ?? access['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>;
  const exp = typeof access.exp === 'number' ? access.exp * 1000 : Date.now() + 3600_000;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    idToken: r.id_token,
    accountId: String(auth.chatgpt_account_id ?? ''),
    expiresAt: exp,
    email: typeof id.email === 'string' ? id.email : undefined,
    plan: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined,
  };
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) throw new OAuthError(`Could not start sign-in (${res.status}).`);
  const j = (await res.json()) as { device_auth_id: string; user_code: string; interval?: string | number; expires_at?: string };
  return {
    deviceAuthId: j.device_auth_id,
    userCode: j.user_code,
    intervalMs: Math.max(2000, Number(j.interval ?? 5) * 1000),
    expiresAt: j.expires_at ? Date.parse(j.expires_at) : Date.now() + 15 * 60_000,
  };
}

/** Poll until the user has approved the code, then exchange it for tokens. */
export async function waitForDeviceApproval(dc: DeviceCode, signal?: AbortSignal): Promise<OAuthTokens> {
  const deadline = Math.min(dc.expiresAt, Date.now() + 15 * 60_000);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new OAuthError('Sign-in cancelled.');
    const res = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: dc.deviceAuthId, user_code: dc.userCode }),
      signal,
    });
    if (res.status === 200) {
      const j = (await res.json()) as { authorization_code: string; code_verifier: string };
      return exchangeCode(j.authorization_code, j.code_verifier);
    }
    if (res.status !== 403 && res.status !== 404) throw new OAuthError(`Sign-in failed (${res.status}).`);
    await new Promise((r) => setTimeout(r, dc.intervalMs));
  }
  throw new OAuthError('The code expired. Start again.');
}

async function exchangeCode(code: string, verifier: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${ISSUER}/deviceauth/callback`,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new OAuthError(`Token exchange failed (${res.status}).`);
  return tokensFromResponse((await res.json()) as { access_token: string; refresh_token: string; id_token: string });
}

export async function refreshTokens(t: OAuthTokens): Promise<OAuthTokens> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: CLIENT_ID });
  const res = await fetch(`${ISSUER}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new OAuthError('Your OpenAI session expired. Sign in again.');
  const j = (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string };
  return tokensFromResponse({ access_token: j.access_token, refresh_token: j.refresh_token ?? t.refreshToken, id_token: j.id_token ?? t.idToken });
}

/** Returns tokens that are valid for at least a minute, refreshing when needed. */
export async function ensureFresh(t: OAuthTokens): Promise<OAuthTokens> {
  return t.expiresAt - Date.now() > 60_000 ? t : refreshTokens(t);
}

/* ---------- persistence: localStorage + IndexedDB copy (same scheme as the API key) ---------- */

export function loadOAuth(): OAuthTokens | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as OAuthTokens) : null;
  } catch {
    return null;
  }
}

export function saveOAuth(t: OAuthTokens | null): void {
  try {
    if (t) localStorage.setItem(STORE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode */
  }
  void withKeyStore('readwrite', (s) => (t ? s.put(JSON.stringify(t), 'oauth') : s.delete('oauth')));
}

export function loadOAuthFromDb(): Promise<OAuthTokens | null> {
  return new Promise((resolve) => {
    void withKeyStore('readonly', (s) => {
      const req = s.get('oauth');
      req.onsuccess = () => {
        try {
          resolve(typeof req.result === 'string' ? (JSON.parse(req.result) as OAuthTokens) : null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    }).catch(() => resolve(null));
  });
}

function withKeyStore(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const open = indexedDB.open('ai-paint', 3);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('drawings')) db.createObjectStore('drawings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('versions')) {
        const vs = db.createObjectStore('versions', { keyPath: 'id' });
        vs.createIndex('byDrawing', 'drawingId', { unique: false });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('keys', mode);
      fn(tx.objectStore('keys'));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
