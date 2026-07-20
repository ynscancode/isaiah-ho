import type { APIRoute } from 'astro';
import { ensureDraftBranchSynced, GitHubApiError, type DraftSyncState } from '../../../lib/github';
import {
  getRepoRef,
  getDraftBranch,
  getWriteToken,
  buildPreviewUrl,
  isVercelPollingConfigured,
  MASTER_BRANCH,
} from '../../../lib/gitConfig';
import { optionalEnv } from '../../../lib/env';

export const prerender = false;

// tech-lead-20260720T051536 RC1/RC2 fix. Response contract (frontend
// dev: wire against this):
//   {
//     previewUrl: string;   // moving branch-alias URL, kept as fallback
//     lastCommitSha: string; // == targetSha, kept for back-compat
//     targetSha: string;     // the just-synced draft tip that was built —
//                             // pass to GET /api/draft/preview-status as a
//                             // read-only Vercel-API correlation filter only
//     pollable: boolean;     // true only when VERCEL_API_TOKEN + PROJECT_ID
//                             // are configured server-side
//     syncState: 'synced' | 'already-current' | 'conflict';
//   }
// Never 500 on a degraded/missing Vercel token — only on a genuine
// GitHub-side failure (mirrors ensure.ts's 502/503 split).

/** Maps the 4-value `DraftSyncState` (github.ts) down to the 3-value
 * contract this endpoint promises the client: 'created'/'merged' both mean
 * "the draft tip just moved to include master," so both collapse to
 * 'synced'; 'up-to-date' means nothing needed to change ('already-current');
 * 'conflict' passes through unchanged (KB-0019 — never auto-resolved). */
function toResponseSyncState(state: DraftSyncState): 'synced' | 'already-current' | 'conflict' {
  if (state === 'conflict') return 'conflict';
  if (state === 'up-to-date') return 'already-current';
  return 'synced';
}

// Fire-and-forget: POST to the Vercel Deploy Hook to build editor-draft's
// current tip on demand (auto-deploy for editor-draft is off; see
// vercel.json). Best-effort only — a failed/missing hook must never fail
// the endpoint, since returning the preview URL is the guaranteed part.
//
// No cross-request dedup by design: serverless instance memory is ephemeral
// and not shared across cold starts or parallel instances, so an in-memory
// "last-triggered-sha" cache would not reliably dedup anyway. This endpoint
// is auth-gated and fired once per user click of the Preview button, which
// already bounds it to one hook POST per request.
async function triggerPreviewBuild(): Promise<void> {
  const hookUrl = optionalEnv('VERCEL_PREVIEW_DEPLOY_HOOK', '');
  if (!hookUrl) return;

  try {
    const res = await fetch(hookUrl, { method: 'POST' });
    if (!res.ok) {
      console.error('draft/preview deploy hook returned non-2xx', res.status);
    }
  } catch (err) {
    console.error('draft/preview deploy hook request failed', err);
  }
}

// POST (not GET) specifically because this endpoint now has a side effect —
// it fires an on-demand Vercel build via the deploy hook. A GET with a
// side effect is CSRF-reachable via a top-level navigation (SameSite=lax
// still sends the session cookie); making it POST means src/middleware.ts
// enforces the double-submit CSRF check, so only our own origin's JS (which
// can read the csrf_token cookie and echo it as X-CSRF-Token) can trigger a
// build. Auth (valid session) is still enforced by the middleware too.
export const POST: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    // RC2 fix — sync master into editor-draft BEFORE firing the build, so
    // the just-triggered deployment builds a tip that includes master-side
    // changes (e.g. numbering removals). Fixed server-derived refs only, no
    // caller-supplied ref (KB-0019). ensureDraftBranchSynced compares first
    // and only writes a merge when master is ahead/diverged — no write
    // amplification on a click that finds the draft already current
    // (KB-0009/ARCH-0014), and additive/idempotent alongside the ARCH-0010
    // once-per-load /api/draft/ensure anchor. A 'conflict' result is NOT
    // fatal (KB-0019 — never auto-resolved/force-merged): still 200, still
    // builds the draft's current (unmerged) tip, and the honest syncState
    // is surfaced to the client rather than silently hidden.
    const { headSha, syncState } = await ensureDraftBranchSynced(token, ref, branch, MASTER_BRANCH);

    await triggerPreviewBuild();

    const pollable = isVercelPollingConfigured();

    return new Response(
      JSON.stringify({
        previewUrl: buildPreviewUrl(branch),
        lastCommitSha: headSha,
        targetSha: headSha,
        pollable,
        syncState: toResponseSyncState(syncState),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('draft/preview failed', err);
    // tech-lead-20260718T174921 Design A3 precedent (ensure.ts): distinguish
    // a transient/rate-limited upstream failure (retryable) from a genuine
    // server bug, same as every other GitHub-backed /api/draft/* write.
    if (err instanceof GitHubApiError && err.retryable) {
      return new Response(JSON.stringify({ error: 'github_unavailable', action: 'retry' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'draft_preview_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
