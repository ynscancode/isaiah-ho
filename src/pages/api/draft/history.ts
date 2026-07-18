import type { APIRoute } from 'astro';
import { listCommitsOnBranch } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken } from '../../../lib/gitConfig';

export const prerender = false;

// Session-gated by src/middleware.ts (GET needs no CSRF, per tech-lead
// §E — read-only, mirrors every other GET under /api/draft). Returns the
// last 30 commits on the draft branch, newest first; purely a read, no
// path/sha from the client is ever trusted or echoed back.
export const GET: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const commits = await listCommitsOnBranch(token, ref, branch, 30);

    return new Response(JSON.stringify({ commits }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('draft/history failed', err);
    return new Response(JSON.stringify({ error: 'history_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
