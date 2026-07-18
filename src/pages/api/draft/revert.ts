import type { APIRoute } from 'astro';
import { z } from 'astro:content';
import {
  getBranchHeadSha,
  getCommitDetail,
  compareCommits,
  getFileOnBranch,
  putFileOnBranch,
  GitHubApiError,
} from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, COMMIT_AUTHOR } from '../../../lib/gitConfig';
import { SITE_JSON_PATH, PROJECTS_JSON_PATH, EXPERIENCE_JSON_PATH, BLOG_DIR } from '../../../lib/contentPaths';

export const prerender = false;

// Session+CSRF gated by src/middleware.ts, identical to every other mutating
// route (see src/pages/api/content/[area].ts). SECURITY-SENSITIVE (tech-lead
// -20260718T082028 §C, KB-0017 trust boundary): the client sends ONLY a
// commit sha. Every path that gets written is re-derived server-side from
// that sha's actual commit contents and re-checked against the SAME
// contentPaths.ts whitelist the normal write path uses — the client never
// gets to name a path or a git operation directly.

const revertBodySchema = z.object({
  targetSha: z.string().regex(/^[0-9a-f]{7,40}$/, 'invalid_target'),
});

function errorResponse(error: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Sole authority for which touched paths are eligible to be restored — the
 * SAME whitelist shape as src/pages/api/content/[area].ts's write path
 * (contentPaths.ts constants), so revert can never write anywhere the
 * normal editor save path couldn't already write. */
function isWhitelistedPath(path: string): boolean {
  if (path === SITE_JSON_PATH || path === PROJECTS_JSON_PATH || path === EXPERIENCE_JSON_PATH) return true;
  return path.startsWith(BLOG_DIR) && path.endsWith('.md') && !path.includes('..');
}

/** Commit message for the new forward commit, in the same
 * "Update <area> content" / "Update blog post: <slug>" family so the
 * client's existing message-prefix area-badge parser can be extended with a
 * matching "Revert ..." prefix (tech-lead §C7). */
function buildRevertMessage(path: string, targetSha: string): string {
  const shortSha = targetSha.slice(0, 7);
  if (path === SITE_JSON_PATH) return `Revert site content to ${shortSha}`;
  if (path === PROJECTS_JSON_PATH) return `Revert projects content to ${shortSha}`;
  if (path === EXPERIENCE_JSON_PATH) return `Revert experience content to ${shortSha}`;
  const slug = path.slice(BLOG_DIR.length).replace(/\.md$/, '');
  return `Revert blog post ${slug} to ${shortSha}`;
}

export const POST: APIRoute = async ({ request }) => {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('invalid_json', 400);
  }

  const parsed = revertBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('invalid_target', 400);
  }
  const { targetSha } = parsed.data;

  const token = getWriteToken();
  const ref = getRepoRef();
  const branch = getDraftBranch();

  try {
    const draftHead = await getBranchHeadSha(token, ref, branch);
    if (!draftHead) {
      // No draft branch/history to revert against at all.
      return errorResponse('unreachable_sha', 409);
    }

    // Ancestor gate (KB-0017 / PO AC7): targetSha must be reachable history
    // of the CURRENT draft HEAD, derived server-side — never trust the
    // client's claim that a sha is legitimate. compareCommits(base=target,
    // head=draftHead) with mergeBaseSha === baseSha proves target is an
    // ancestor of (or equal to) draftHead.
    const compare = await compareCommits(token, ref, targetSha, draftHead);
    if (!compare || compare.mergeBaseSha !== compare.baseSha) {
      return errorResponse('unreachable_sha', 409);
    }

    // Re-derive which files this commit actually touched — the client never
    // supplies paths (KB-0017).
    const detail = await getCommitDetail(token, ref, targetSha);
    if (!detail) {
      return errorResponse('unreachable_sha', 409);
    }

    const whitelistedFiles = detail.files.filter((f) => isWhitelistedPath(f.filename));
    if (whitelistedFiles.length === 0) {
      return errorResponse('no_content_paths', 422);
    }

    const revertedPaths: string[] = [];
    const commits: string[] = [];

    // Sequential, non-atomic writes: today's single-owner editor writes one
    // whitelisted file per save-commit, so a revert normally means exactly
    // one put here. The loop is defensive for a hypothetical future commit
    // that touched multiple whitelisted files — if a later put in the
    // sequence fails/conflicts, earlier puts in this loop have already
    // landed as real forward commits (by design: KB-0019, never rewritten),
    // so a partial revert is a valid, inspectable state, not corruption.
    for (const file of whitelistedFiles) {
      const path = file.filename;
      // Defense in depth: re-check right before the write, mirroring
      // [area].ts's blog path guard, even though `isWhitelistedPath` was
      // already applied above.
      if (!isWhitelistedPath(path)) continue;

      // Status-keyed restore source (tech-lead §B, director-approved):
      // added/modified/renamed -> POST-image (content AS OF targetSha).
      // removed -> PRE-image (content as of the target commit's parent) —
      // this is what un-deletes a "Delete blog post:" commit. MVP never
      // deletes a file as part of revert (KB-0014).
      const sourceRef = file.status === 'removed' ? detail.parents[0] : targetSha;
      if (!sourceRef) {
        // A "removed" file with no parent commit (root commit) has no
        // pre-image to restore — nothing sane to do, skip it.
        continue;
      }

      const sourceFile = await getFileOnBranch(token, ref, path, sourceRef);
      if (!sourceFile) {
        // The commit detail said this path was touched at that ref, but the
        // content isn't there — an inconsistent read. Surface as a hard
        // failure rather than silently skipping (never a false "reverted").
        throw new GitHubApiError(`Revert source content missing for ${path}@${sourceRef}`, 500);
      }

      const currentFile = await getFileOnBranch(token, ref, path, branch);
      const { commitSha } = await putFileOnBranch(token, ref, {
        path,
        branch,
        contentBase64: sourceFile.contentBase64,
        sha: currentFile?.sha ?? null,
        message: buildRevertMessage(path, targetSha),
        author: COMMIT_AUTHOR,
      });

      revertedPaths.push(path);
      commits.push(commitSha);
    }

    if (revertedPaths.length === 0) {
      // Every touched whitelisted file turned out un-restorable (e.g. all
      // were root-commit removals) — no write happened.
      return errorResponse('no_content_paths', 422);
    }

    return new Response(JSON.stringify({ revertedPaths, commits }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 409) {
      // A concurrent normal save moved a file's head sha mid-revert.
      // Retryable by the client (re-fetch history, re-attempt revert).
      console.error('draft/revert conflict', err);
      return errorResponse('revert_conflict', 409);
    }
    console.error('draft/revert failed', err);
    return errorResponse('write_failed', 502);
  }
};
