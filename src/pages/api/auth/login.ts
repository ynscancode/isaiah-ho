import type { APIRoute } from 'astro';
import { requireEnv } from '../../../lib/env';
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_SECONDS,
  randomState,
  sanitizeRedirectTo,
  signPayload,
  type OAuthStatePayload,
} from '../../../lib/session';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const redirectTo = sanitizeRedirectTo(url.searchParams.get('redirect_to'));

  const clientId = requireEnv('GITHUB_OAUTH_CLIENT_ID');
  const siteUrl = requireEnv('PUBLIC_SITE_URL');
  const secret = requireEnv('SESSION_SECRET');

  const state = randomState();
  const iat = Math.floor(Date.now() / 1000);
  const statePayload: OAuthStatePayload = {
    state,
    redirectTo,
    iat,
    exp: iat + OAUTH_STATE_MAX_AGE_SECONDS,
  };
  const signedState = await signPayload(statePayload, secret);

  cookies.set(OAUTH_STATE_COOKIE_NAME, signedState, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  const redirectUri = new URL('/api/auth/callback', siteUrl).toString();
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'read:user');
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authorizeUrl.toString() },
  });
};
