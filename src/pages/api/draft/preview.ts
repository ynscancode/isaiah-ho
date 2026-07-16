import type { APIRoute } from 'astro';
import { getBranchHeadSha } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, buildPreviewUrl } from '../../../lib/gitConfig';

export const prerender = false;

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
