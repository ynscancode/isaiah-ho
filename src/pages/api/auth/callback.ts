import type { APIRoute } from 'astro';
import { requireEnv } from '../../../lib/env';
import { exchangeCodeForAccessToken, getAuthenticatedGitHubLogin } from '../../../lib/github';
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  constantTimeEqual,
  mintSessionToken,
  sanitizeRedirectTo,
  verifyPayload,
  type OAuthStatePayload,
} from '../../../lib/session';

export const prerender = false;

// KB-0007: every failure branch (bad state, code-exchange failure, wrong
// GitHub user, upstream API error) must produce a byte-identical response
// and run the same sequence of steps at the same cost — so a network
// observer or timing side-channel can't distinguish *why* auth failed, and
// in particular can never learn which GitHub account is the allowed one.
// To get there: never return early on a single check. Always run the full
// step sequence (verify state, exchange code, fetch user, compare login),
// accumulate one boolean, and branch exactly once at the end.
const GENERIC_FAILURE_REDIRECT = '/?auth_error=1';

export const GET: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const queryState = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';

  const secret = requireEnv('SESSION_SECRET');
  const clientId = requireEnv('GITHUB_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GITHUB_OAUTH_CLIENT_SECRET');
  const siteUrl = requireEnv('PUBLIC_SITE_URL');
  const adminUsername = requireEnv('ADMIN_GITHUB_USERNAME');

  const rawStateCookie = cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
  // Always consume the state cookie regardless of outcome (single-use).
  cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' });

  const now = Math.floor(Date.now() / 1000);
  const statePayload = await verifyPayload<OAuthStatePayload>(
    rawStateCookie,
    secret,
    (p) => typeof p?.state === 'string' && typeof p.exp === 'number' && p.exp > now
  );

  const stateOk = statePayload !== null && constantTimeEqual(queryState, statePayload.state);

  // Always attempt the code exchange, even if state already failed — this
  // keeps the "bad state" and "wrong user" branches doing the same work.
  const redirectUri = new URL('/api/auth/callback', siteUrl).toString();
  const accessToken = await exchangeCodeForAccessToken({
    clientId,
    clientSecret,
    code,
    redirectUri,
  }).catch(() => null);

  const login = accessToken
    ? await getAuthenticatedGitHubLogin(accessToken).catch(() => null)
    : await getAuthenticatedGitHubLogin('').catch(() => null);
  // OAuth token is read once (above) to resolve the username, then
  // discarded — it is never persisted or reused for git-write calls
  // (those use the separate, server-only GIT_WRITE_TOKEN).

  const usernameOk = login !== null && constantTimeEqual(login, adminUsername);

  const success = stateOk && accessToken !== null && login !== null && usernameOk;

  if (!success) {
    return new Response(null, {
      status: 302,
      headers: { Location: GENERIC_FAILURE_REDIRECT },
    });
  }

  const { token } = await mintSessionToken(adminUsername, secret);
  cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const redirectTo = sanitizeRedirectTo(statePayload?.redirectTo);
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo },
  });
};
