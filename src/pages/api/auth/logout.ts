import type { APIRoute } from 'astro';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../../../lib/session';

export const prerender = false;

// Mutating (non-GET) — gated by middleware: valid session + X-CSRF-Token required.
export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
