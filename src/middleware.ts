import { defineMiddleware } from 'astro:middleware';
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  verifyCsrfToken,
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

  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfHeader = request.headers.get('X-CSRF-Token');
    const csrfOk = secret ? await verifyCsrfToken(csrfHeader, session, secret) : false;
    if (!csrfOk) {
      // TEMP-DIAGNOSTIC (remove after CSRF-403 root cause confirmed) —
      // distinguishes "client never sent/had a CSRF token" from "client sent
      // one but it doesn't match" WITHOUT logging any secret or token value.
      // Read this in Vercel logs after the user retries a save:
      //   csrfHeaderPresent=false  -> mode 1: getCsrfToken() returned '' client-side
      //                               (csrf_token cookie missing/unreadable in the
      //                               browser sending the request)
      //   csrfHeaderPresent=true, csrfCookiePresent=false -> browser has no
      //     csrf_token cookie on THIS request either, despite a header being sent
      //     (stale client state / cookie expired or cleared) -> mode 1 variant
      //   csrfHeaderPresent=true, csrfCookiePresent=true -> header was sent and a
      //     cookie exists, but they don't verify against the session -> mode 2:
      //     secret/iat mismatch, almost certainly cookies minted by a prior
      //     deploy/secret (KB-0016) -> log out + back in re-mints both under the
      //     current deploy and should resolve it.
      console.log('[csrf-diag]', {
        method,
        pathname,
        csrfHeaderPresent: !!csrfHeader,
        csrfCookiePresent: !!cookies.get('csrf_token')?.value,
      });
      // END TEMP-DIAGNOSTIC

      if (pathname.startsWith('/api/')) {
        return csrfInvalidResponse();
      }
      return generic403();
    }
  }

  return next();
});
