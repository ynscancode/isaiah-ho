import type { APIRoute } from 'astro';
import { getBranchHeadSha } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, buildPreviewUrl } from '../../../lib/gitConfig';
import { optionalEnv } from '../../../lib/env';

export const prerender = false;

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

// Auth already enforced by src/middleware.ts (GET on a privileged path still
// requires a valid session; no CSRF needed for a read).
export const GET: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const lastCommitSha = await getBranchHeadSha(token, ref, branch);
    if (!lastCommitSha) {
      return new Response(JSON.stringify({ error: 'draft_branch_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    await triggerPreviewBuild();

    return new Response(
      JSON.stringify({ previewUrl: buildPreviewUrl(branch), lastCommitSha }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('draft/preview failed', err);
    return new Response(JSON.stringify({ error: 'draft_preview_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
