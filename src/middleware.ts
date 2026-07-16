import { defineMiddleware } from 'astro:middleware';
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  verifyCsrfToken,
} from './lib/session';

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

  const secret = import.meta.env.SESSION_SECRET as string | undefined;
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
      return generic403();
    }
  }

  return next();
});
