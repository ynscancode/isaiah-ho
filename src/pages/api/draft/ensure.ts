import type { APIRoute } from 'astro';
import { ensureDraftBranchSynced, GitHubApiError } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, buildPreviewUrl, MASTER_BRANCH } from '../../../lib/gitConfig';

export const prerender = false;

// Auth + CSRF already enforced by src/middleware.ts for this path.
export const POST: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const { headSha, syncState } = await ensureDraftBranchSynced(token, ref, branch, MASTER_BRANCH);

    // tech-lead-20260717T090321 Decision 1b: all four syncState values
    // return 200 here — a merge conflict means the preview build is
    // unreliable, not that the user's draft is invalid. Never block editing
    // to protect a preview. The toolbar surfaces a warning on 'conflict'.
    return new Response(
      JSON.stringify({ branch, headSha, previewUrl: buildPreviewUrl(branch), syncState }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('draft/ensure failed', err);
    // tech-lead-20260718T174921 Design A3: distinguish a transient/
    // rate-limited upstream failure (retryable) from a genuine server bug --
    // gives the client an honest "try again" signal instead of a generic
    // write-failed banner.
    if (err instanceof GitHubApiError && err.retryable) {
      return new Response(JSON.stringify({ error: 'github_unavailable', action: 'retry' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'draft_ensure_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
