import type { APIRoute } from 'astro';
import { ensureBranch } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, buildPreviewUrl, MASTER_BRANCH } from '../../../lib/gitConfig';

export const prerender = false;

// Auth + CSRF already enforced by src/middleware.ts for this path.
export const POST: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const headSha = await ensureBranch(token, ref, branch, MASTER_BRANCH);

    return new Response(
      JSON.stringify({ branch, headSha, previewUrl: buildPreviewUrl(branch) }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('draft/ensure failed', err);
    return new Response(JSON.stringify({ error: 'draft_ensure_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
