// Shared session / CSRF / signed-cookie helpers.
//
// Design notes (see TEAM-BOARD tech-lead-20260715T192159 + KB-0007):
// - Sessions are a signed, httpOnly `__Host-session` cookie containing
//   {sub, iat, exp} — no server-side session store (KB-0005: serverless has
//   no persistent shared filesystem/store).
// - Signing uses HMAC-SHA256 via Web Crypto (`crypto.subtle`), available in
//   both the Node and Edge runtimes Vercel might run this on — no extra deps.
// - All comparisons that gate access (signature check, username check) use
//   constant-time comparison to avoid timing side channels (KB-0007).

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(sig);
}

/** Constant-time byte comparison. Returns false immediately only after
 * comparing full length (both strings are walked to the longer length so
 * timing doesn't leak *where* a mismatch occurred; a length mismatch is
 * itself non-secret information already visible from response size, so a
 * fast-path length check is not a real leak here). */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

/** Sign an arbitrary JSON-serializable payload into `<base64url(payload)>.<base64url(hmac)>`. */
export async function signPayload(payload: unknown, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = toBase64Url(encoder.encode(json));
  const sig = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Verify and decode a token produced by signPayload. Returns null on any failure
 * (malformed, bad signature, or fails the optional `isValid` structural/expiry check) —
 * callers must not distinguish these failure modes in responses (KB-0007). */
export async function verifyPayload<T>(
  token: string | undefined | null,
  secret: string,
  isValid?: (payload: T) => boolean
): Promise<T | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacSign(secret, payloadB64);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  let payload: T;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }
  if (isValid && !isValid(payload)) return null;
  return payload;
}

export type SessionPayload = {
  sub: string; // GitHub login, verified === ADMIN_GITHUB_USERNAME at mint time
  iat: number; // seconds since epoch
  exp: number; // seconds since epoch
};

export const SESSION_COOKIE_NAME = '__Host-session';
// Sliding-session window: with the renewal below, this is the *idle* timeout —
// the session only lapses after this long with no authenticated request, not
// this long after login.
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // ~8h idle

// Renew the cookie at most once per this interval of activity, so an active
// editing session's expiry keeps sliding forward without emitting a Set-Cookie
// on literally every request.
export const SESSION_RENEW_AFTER_SECONDS = 30 * 60; // 30 min
// Absolute cap measured from the original login (iat is preserved across
// renewals). A session can slide for at most this long before a fresh
// interactive login is required — this bounds the lifetime of a stolen cookie
// even under continuous use, which an unbounded sliding session would not.
export const SESSION_ABSOLUTE_MAX_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function mintSessionToken(
  sub: string,
  secret: string
): Promise<{ token: string; iat: number; exp: number }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_MAX_AGE_SECONDS;
  const token = await signPayload({ sub, iat, exp } satisfies SessionPayload, secret);
  return { token, iat, exp };
}

/** Re-mint a session token that PRESERVES the original `iat` — critical
 * because the double-submit CSRF token is derived from `iat`
 * (csrfTokenForSession), so preserving it keeps the already-issued CSRF
 * cookie valid — while pushing `exp` forward to now + SESSION_MAX_AGE_SECONDS.
 * Used by the sliding-session renewal in middleware. */
export async function renewSessionToken(
  session: SessionPayload,
  secret: string
): Promise<{ token: string; iat: number; exp: number }> {
  const now = Math.floor(Date.now() / 1000);
  const iat = session.iat;
  const exp = now + SESSION_MAX_AGE_SECONDS;
  const token = await signPayload({ sub: session.sub, iat, exp } satisfies SessionPayload, secret);
  return { token, iat, exp };
}

/** Whether a currently-valid session is old enough since its last mint to be
 * worth renewing, AND still within its absolute lifetime cap from the
 * original login. False on both edges avoids Set-Cookie churn on every
 * request and refuses to extend a session past the hard cap. */
export function shouldRenewSession(session: SessionPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  const lastMint = session.exp - SESSION_MAX_AGE_SECONDS;
  const elapsedSinceMint = now - lastMint;
  const withinAbsoluteCap = now - session.iat < SESSION_ABSOLUTE_MAX_SECONDS;
  return elapsedSinceMint >= SESSION_RENEW_AFTER_SECONDS && withinAbsoluteCap;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string
): Promise<SessionPayload | null> {
  const now = Math.floor(Date.now() / 1000);
  return verifyPayload<SessionPayload>(
    token,
    secret,
    (p) => typeof p?.sub === 'string' && typeof p.exp === 'number' && p.exp > now
  );
}

/** Stateless double-submit CSRF token bound to this session's identity+mint-time,
 * so it rotates every login and can't be replayed across sessions — without any
 * server-side store (KB-0005). */
export async function csrfTokenForSession(session: SessionPayload, secret: string): Promise<string> {
  return hmacSign(secret, `csrf:${session.sub}:${session.iat}`);
}

/** Non-httpOnly companion to the session cookie — readable by same-origin JS
 * so the editor UI can echo it back as X-CSRF-Token. See callback.ts. */
export const CSRF_COOKIE_NAME = 'csrf_token';

export async function verifyCsrfToken(
  headerToken: string | null,
  session: SessionPayload,
  secret: string
): Promise<boolean> {
  if (!headerToken) return false;
  const expected = await csrfTokenForSession(session, secret);
  return constantTimeEqual(headerToken, expected);
}

export type OAuthStatePayload = {
  state: string;
  redirectTo: string;
  iat: number;
  exp: number;
};

export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes, single round-trip

export function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Restrict redirect_to to a same-origin absolute path — reject protocol-relative
 * (`//host/...`), backslash tricks (`\/\/host` / `/\host`), and any embedded scheme.
 * Returns a safe default ('/') if the input fails validation. */
export function sanitizeRedirectTo(input: string | null | undefined): string {
  const fallback = '/';
  if (!input) return fallback;
  if (!input.startsWith('/')) return fallback;
  if (input.startsWith('//')) return fallback;
  if (input.includes('\\')) return fallback;
  if (/^\/\s*\//.test(input)) return fallback; // "/ /evil.com" style whitespace tricks
  // Reject any embedded scheme like "/x:y" being interpreted downstream, and
  // control/whitespace characters that could be used to smuggle a host.
  if (/[\x00-\x1f]/.test(input)) return fallback;
  try {
    // Resolving against a fixed dummy origin catches sneaky forms
    // (e.g. "/\t/evil.com") that the raw-string checks above might miss.
    const resolved = new URL(input, 'https://same-origin.invalid');
    if (resolved.origin !== 'https://same-origin.invalid') return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
