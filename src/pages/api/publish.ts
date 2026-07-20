import type { APIRoute } from 'astro';
import { mergeBranches, deleteBranch, ensureDraftBranchSynced } from '../../lib/github';
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

    // Recreate the draft clean from master after a successful publish
    // (tech-lead-20260717T090321 Decision 1d). Safe here specifically
    // because we only reach this line when `result.merged === true`: every
    // commit that was on the draft is by then reachable from master, so
    // deleting the ref discards nothing. Best-effort/non-fatal — publish has
    // already succeeded (commit exists on master), so a failure to delete
    // the old draft ref must not turn into a failed publish response; the
    // next `/api/draft/ensure` call will recreate the branch anyway.
    try {
      await deleteBranch(token, ref, branch);
    } catch (err) {
      console.error('publish: post-publish draft branch delete failed (non-fatal)', err);
    }

    // Immediately recreate the draft from master (tech-lead-20260719T153953
    // Fix 3a). Without this, the draft sits absent from the moment of
    // publish until the next save's lazy `ensureDraft()` call — during that
    // window `/api/draft/history` reads a 404'd branch (empty) and
    // `/api/draft/revert` resolves a null draftHead (`unreachable_sha`),
    // i.e. "publish resets history." Same helper the next save would call
    // anyway (create path: branch missing -> recreate from MASTER_BRANCH
    // HEAD), just invoked eagerly here instead of lazily. Best-effort/
    // non-fatal, mirroring the delete above: publish already succeeded
    // (commit exists on master), so a failure here must not turn a
    // successful publish into a failed response — the next save's lazy
    // ensure remains the backstop if this also fails. No force/reset/
    // rewrite (KB-0019); fixed server refs only, no caller-supplied ref.
    try {
      await ensureDraftBranchSynced(token, ref, branch, MASTER_BRANCH);
    } catch (err) {
      console.error('publish: post-publish draft branch re-ensure failed (non-fatal)', err);
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
