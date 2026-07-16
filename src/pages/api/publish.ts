import type { APIRoute } from 'astro';
import { mergeBranches } from '../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, MASTER_BRANCH } from '../../lib/gitConfig';

export const prerender = false;

// Auth + CSRF already enforced by src/middleware.ts. Only ever merges the
// one fixed draft branch into the one fixed master branch — no
// caller-supplied refs, so there is no path here to merge an arbitrary ref.
export const POST: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const result = await mergeBranches(token, ref, {
      base: MASTER_BRANCH,
      head: branch,
      commitMessage: `Publish content edits from ${branch}`,
    });

    if (!result.merged) {
      return new Response(JSON.stringify({ error: 'merge_conflict' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ commitSha: result.sha }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('publish failed', err);
    return new Response(JSON.stringify({ error: 'publish_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
