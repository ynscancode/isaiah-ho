import { defineMiddleware } from 'astro:middleware';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  CSRF_COOKIE_NAME,
  verifySessionToken,
  verifyCsrfToken,
  renewSessionToken,
  shouldRenewSession,
  csrfTokenForSession,
} from './lib/session';
import { optionalEnv } from './lib/env';

// Public, unauthenticated entry points into the OAuth flow. Everything else
// under /api and every /edit/** route is privileged.
const PUBLIC_ROUTES = new Set(['/api/auth/login', '/api/auth/callback']);

function isPrivilegedPath(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return false;
  return pathname.startsWith('/api/') || pathname.startsWith('/edit');
}

/** A generic, indistinguishable "not here" response — same for a genuinely
 * missing route and for a privileged route hit without a session, so an
 * unauthenticated visitor can't tell the editor surface exists at all. */
function generic404(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function generic403(): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** CSRF-failure response for mutating /api/** calls. Status stays 403 (no
 * downgrade of the security posture, KB-0017) but the body is a
 * machine-readable shape so the editor toolbar can distinguish "your
 * session/CSRF token is stale, log in again" from a generic failure and
 * offer a re-login link instead of a dead-end "save failed" message.
 *
 * Safe to make this distinguishable (unlike generic404 above): this branch
 * is only reached AFTER `session` already verified non-null at :60-62 — the
 * indistinguishable-404 invariant exists to hide the editor's existence from
 * an unauthenticated visitor, and an unauthenticated visitor can never reach
 * this branch (they're already turned away as generic404 first). So a
 * richer 403 here leaks nothing to that visitor; it only ever describes a
 * CSRF/session-freshness problem to a caller who already holds a valid
 * session cookie.
 *
 * Body/contract for frontend (senior-frontend-dev): status 403,
 * content-type application/json, body `{ "error": "csrf_invalid", "action": "reauth" }`.
 * No secret/token/cookie value is ever included. */
function csrfInvalidResponse(): Response {
  return new Response(JSON.stringify({ error: 'csrf_invalid', action: 'reauth' }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, url, request, locals } = context;
  locals.session = null;

  const pathname = url.pathname;

  // Only touch cookies/request headers for privileged paths — public,
  // prerendered pages never need session state, and reading the Cookie
  // header during the static build otherwise trips Astro's
  // "request.headers used on a prerendered page" warning for no benefit.
  if (!isPrivilegedPath(pathname)) {
    return next();
  }

  // Read via the shared env helper (process.env at runtime, with a
  // dev-only import.meta.env[name] fallback) rather than a literal
  // `import.meta.env.SESSION_SECRET` — a literal is what Vite statically
  // inlines into the built server bundle, which would bake the real
  // secret into deployed output. optionalEnv's fallback default of ''
  // is falsy, matching the prior `undefined` behavior for the checks below.
  const secret = optionalEnv('SESSION_SECRET', '') || undefined;
  const rawSession = cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = secret ? await verifySessionToken(rawSession, secret) : null;
  locals.session = session;

  if (!session) {
    return generic404();
  }

  // Sliding session: keep an actively-used editor session alive by pushing its
  // expiry forward on authenticated requests, so the admin isn't logged out
  // mid-work after a fixed window. iat is preserved (so the CSRF token stays
  // valid), the renewal is throttled to at most once per
  // SESSION_RENEW_AFTER_SECONDS, and it's refused past the absolute lifetime
  // cap — all decided in shouldRenewSession/renewSessionToken (lib/session.ts).
  if (secret && shouldRenewSession(session)) {
    const renewed = await renewSessionToken(session, secret);
    cookies.set(SESSION_COOKIE_NAME, renewed.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    // Refresh the companion CSRF cookie's lifetime too, else it would expire
    // at its original mint time and break mutating requests even though the
    // session slid forward. Its VALUE is derived from sub+iat (both unchanged
    // across renewal), so this re-sets the identical token with a fresh
    // maxAge — no CSRF rotation, no race with in-flight requests that already
    // read the old (identical) value.
    const csrfToken = await csrfTokenForSession({ sub: session.sub, iat: renewed.iat, exp: renewed.exp }, secret);
    cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfHeader = request.headers.get('X-CSRF-Token');
    const csrfOk = secret ? await verifyCsrfToken(csrfHeader, session, secret) : false;
    if (!csrfOk) {
      if (pathname.startsWith('/api/')) {
        return csrfInvalidResponse();
      }
      return generic403();
    }
  }

  return next();
});
