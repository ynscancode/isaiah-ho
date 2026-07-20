import type { APIRoute } from 'astro';
import { listCommitsOnBranch } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken } from '../../../lib/gitConfig';
import { groupCommitsIntoSessions, isEditorVersionCommit, SESSION_GAP_MS } from '../../../lib/history/sessionGrouping';

export const prerender = false;

// Session-gated by src/middleware.ts (GET needs no CSRF, per tech-lead
// §E — read-only, mirrors every other GET under /api/draft). Returns the
// last 50 commits on the draft branch, newest first, filtered to
// editor-authored content versions (tech-lead-20260719T153953 Fix 3b,
// director-20260719T154351 decision 1 — drops publish/sync MERGE noise,
// KEEPS already-published "Update <area> content"/"Update blog post:"
// commits as revert targets) and grouped into sessions (tech-lead-
// 20260719T095958 Issue 3, Option A: read-side gap coalescing,
// presentational only — every commit is still its own real, individually
// revertable git object). Purely a read, no path/sha from the client is
// ever trusted or echoed back. perPage bumped 30 -> 50 so the filter
// dropping merge commits doesn't thin the visible window.
export const GET: APIRoute = async () => {
  try {
    const token = getWriteToken();
    const ref = getRepoRef();
    const branch = getDraftBranch();

    const commits = await listCommitsOnBranch(token, ref, branch, 50);
    const editorCommits = commits.filter((c) => isEditorVersionCommit(c.message));
    const sessions = groupCommitsIntoSessions(editorCommits, SESSION_GAP_MS);

    return new Response(JSON.stringify({ sessions }), {
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
