import type { APIRoute } from 'astro';
import { findDeploymentByCommitSha, VercelApiError, type VercelReadyState } from '../../../lib/vercel';
import { getVercelApiToken, getVercelProjectId, getVercelTeamId } from '../../../lib/gitConfig';

export const prerender = false;

// tech-lead-20260720T051536 RC1 fix. Session-gated by src/middleware.ts;
// GET needs no CSRF (pure read, mirrors history.ts's precedent). Polled by
// the client every ~4s (capped ~90s) after a POST /api/draft/preview whose
// response carried `pollable: true`.
//
// Response contract (frontend dev: wire against this — ALWAYS 200 on the
// expected paths, never 500 for a degraded/missing token):
//   { pollable: false, state: 'UNKNOWN' }
//     — VERCEL_API_TOKEN/VERCEL_PROJECT_ID not configured, OR the Vercel API
//       call itself failed. Fall back to the alias-URL + "~30s" message.
//   { pollable: true, state: 'QUEUED' | 'BUILDING' | 'ERROR' | 'READY', url?: string }
//     — `url` is present ONLY when state === 'READY', and is the exact
//       build's own per-deployment URL (never the moving branch alias).
// A malformed `targetSha` query param is the one boundary-validation
// failure that returns non-200 (400) — it is never trusted as a git ref or
// filesystem path, purely a read-only Vercel-API correlation filter.
const SHA_RE = /^[0-9a-f]{40}$/i;

function degraded(): Response {
  return new Response(JSON.stringify({ pollable: false, state: 'UNKNOWN' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mapReadyState(state: VercelReadyState): 'QUEUED' | 'BUILDING' | 'ERROR' | 'READY' {
  if (state === 'READY') return 'READY';
  if (state === 'ERROR' || state === 'CANCELED') return 'ERROR';
  if (state === 'BUILDING' || state === 'INITIALIZING') return 'BUILDING';
  return 'QUEUED';
}

export const GET: APIRoute = async ({ url }) => {
  const token = getVercelApiToken();
  const projectId = getVercelProjectId();
  if (!token || !projectId) {
    // Graceful degradation (tech-lead spec): missing config is not an error.
    return degraded();
  }

  const targetSha = url.searchParams.get('targetSha') ?? '';
  if (!SHA_RE.test(targetSha)) {
    return new Response(JSON.stringify({ error: 'invalid_target_sha' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const teamId = getVercelTeamId();
    const match = await findDeploymentByCommitSha(token, projectId, teamId, targetSha);
    if (!match) {
      // Not visible in the Deployments list yet (just triggered) — keep
      // polling, not an error.
      return new Response(JSON.stringify({ pollable: true, state: 'QUEUED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const state = mapReadyState(match.readyState);
    const body: { pollable: true; state: typeof state; url?: string } = { pollable: true, state };
    if (state === 'READY') {
      body.url = `https://${match.url}`;
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    // Never leak the token/any Vercel response detail; a Vercel-side outage
    // degrades exactly like a missing token (tech-lead spec: "never 500,
    // never leak the token").
    if (err instanceof VercelApiError) {
      console.error('draft/preview-status Vercel API error', err.status, err.message);
    } else {
      console.error('draft/preview-status failed', err);
    }
    return degraded();
  }
};
