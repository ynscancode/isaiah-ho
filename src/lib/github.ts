// Thin GitHub REST API client for the git-write path (KB-0005: no local FS —
// all content mutation is a commit via the GitHub API). Plain `fetch`, no
// octokit dependency, per tech-lead spec ("keep deps minimal").
//
// Two distinct tokens are used, deliberately never mixed:
// - The OAuth *user* access token (login flow) — read-only `read:user`,
//   used once to read the authenticated user's login, then discarded. Never
//   stored, never used for writes (KB-0007 spec + tech-lead architecture).
// - `GIT_WRITE_TOKEN` (fine-grained PAT, Contents RW, single repo) — used for
//   every content-mutating call in this module. Server-only, read from env,
//   never included in any response body.

const GITHUB_API = 'https://api.github.com';

export class GitHubApiError extends Error {
  status: number;
  // tech-lead-20260718T174921 Design A1: true only for an exhausted-retry
  // rate-limit(429/secondary-or-primary-403)/5xx/network failure — the
  // client can safely offer "retry"/show a transient-unavailable banner.
  // Defaults false so every pre-existing throw site (auth-403, 404, 422,
  // 409, generic write failures) is unaffected without individually
  // touching each call site.
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean = false) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

// ---- Retry/backoff (tech-lead-20260718T174921 Design A1) ----
// Root cause: a transient 429 / secondary-rate-limit 403 / 5xx / network
// blip from GitHub previously surfaced directly as a hard failure on every
// autosave PUT and every read loader, even though these are frequently
// transient and recoverable within a normal request lifetime. This adds a
// small bounded retry loop with a strict, honest time budget so we fail
// fast rather than silently hanging until the serverless function itself
// times out.
const MAX_ATTEMPTS = 3; // = 2 retries
const BASE_DELAY_MS = 500;
const BACKOFF_FACTOR = 2;
const MAX_SINGLE_SLEEP_MS = 4000;
const TOTAL_WAIT_BUDGET_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full-jitter exponential backoff for our own retries (not a server-given
 * Retry-After/reset). `retryIndex` is 1 for the delay before the 2nd
 * attempt, 2 for the delay before the 3rd, etc. */
function computeBackoffDelayMs(retryIndex: number): number {
  const exp = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, retryIndex - 1);
  const capped = Math.min(exp, MAX_SINGLE_SLEEP_MS);
  return Math.random() * capped;
}

// Lightweight per-request counter for latency re-measurement (tech-lead-
// 20260719T095958 Issue 2 instrumentation). Purely additive — a module-level
// increment + a single console.debug line, no added latency, no new failure
// mode, never read/reset by any request-handling logic. Remove or leave in
// place after re-measurement; it has no behavioral effect either way.
let githubFetchRequestCount = 0;
export function getGithubFetchRequestCount(): number {
  return githubFetchRequestCount;
}

async function githubFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  githubFetchRequestCount++;
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET';
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  };

  let attempt = 0;
  let waitedMs = 0;

  // Attempts to sleep `delayMs`, honoring the total-wait budget. Returns
  // true if it slept (caller should retry), false if it bailed (caller
  // must throw immediately — never sleep-then-still-fail). Budget is
  // checked against the FULL requested delay (e.g. a server-given
  // Retry-After/reset), not the post-cap sleep duration — capping first
  // would silently under-honor a large Retry-After (sleep less than
  // requested, then retry too early) instead of bailing honestly. Only
  // the actual sleep duration is capped at MAX_SINGLE_SLEEP_MS once the
  // budget check has passed.
  async function tryWait(delayMs: number): Promise<boolean> {
    if (waitedMs + delayMs > TOTAL_WAIT_BUDGET_MS) return false;
    const capped = Math.min(delayMs, MAX_SINGLE_SLEEP_MS);
    await sleep(capped);
    waitedMs += capped;
    return true;
  }

  while (true) {
    attempt++;
    const attemptsLeft = attempt < MAX_ATTEMPTS;

    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}${path}`, { ...init, headers });
    } catch (networkErr) {
      // Network/fetch-throw. Only GET (idempotent) is safe to retry — a
      // non-GET network error is ambiguous (the write may have applied on
      // GitHub's side even though the client never saw the response), so a
      // retry here risks a double-commit/duplicate-merge. Non-GET: throw
      // immediately, not retryable.
      if (!isIdempotent) {
        throw new GitHubApiError(`Network error contacting GitHub: ${String(networkErr)}`, 0, false);
      }
      if (attemptsLeft) {
        const delay = computeBackoffDelayMs(attempt);
        if (await tryWait(delay)) continue;
      }
      throw new GitHubApiError(`Network error contacting GitHub: ${String(networkErr)}`, 0, true);
    }

    if (res.status === 429) {
      // Always safe to retry on writes too — GitHub rejected the request
      // before executing it.
      const retryAfterHeader = res.headers.get('retry-after');
      const delay = retryAfterHeader ? Number(retryAfterHeader) * 1000 : computeBackoffDelayMs(attempt);
      if (attemptsLeft && (await tryWait(delay))) continue;
      throw new GitHubApiError('GitHub rate limit exceeded (429)', 429, true);
    }

    if (res.status === 403) {
      const retryAfterHeader = res.headers.get('retry-after');
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (retryAfterHeader) {
        // Secondary rate limit — safe to retry even on writes.
        const delay = Number(retryAfterHeader) * 1000;
        if (attemptsLeft && (await tryWait(delay))) continue;
        throw new GitHubApiError('GitHub secondary rate limit exceeded (403)', 403, true);
      }
      if (remaining === '0') {
        // Primary rate limit — wait until the reset epoch (seconds).
        const resetHeader = res.headers.get('x-ratelimit-reset');
        const resetEpochMs = resetHeader ? Number(resetHeader) * 1000 : Date.now();
        const delay = Math.max(0, resetEpochMs - Date.now());
        if (attemptsLeft && (await tryWait(delay))) continue;
        throw new GitHubApiError('GitHub primary rate limit exceeded (403)', 403, true);
      }
      // Neither signal present -> auth/permission 403. Must NOT be
      // retried (would mask a real permission failure as transient) -- let
      // it surface immediately via the caller's existing !res.ok handling.
      return res;
    }

    if (res.status >= 500 && res.status < 600) {
      if (isIdempotent) {
        if (attemptsLeft) {
          const delay = computeBackoffDelayMs(attempt);
          if (await tryWait(delay)) continue;
        }
        throw new GitHubApiError(`GitHub server error ${res.status}`, res.status, true);
      }
      // Non-GET 5xx is ambiguous (write may have applied) -- do not
      // auto-retry; let the caller's existing !res.ok handling throw a
      // non-retryable error.
      return res;
    }

    return res;
  }
}

// ---- OAuth user-token calls (login flow only) ----

export async function exchangeCodeForAccessToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string | null> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { access_token?: string } | null;
  return data?.access_token ?? null;
}

export async function getAuthenticatedGitHubLogin(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { login?: string } | null;
  return data?.login ?? null;
}

// ---- Content-write calls (GIT_WRITE_TOKEN, fixed repo/refs only) ----

export type RepoRef = { owner: string; repo: string };

export function parseRepo(full: string): RepoRef {
  const [owner, repo] = full.split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPO value: ${full}`);
  return { owner, repo };
}

export async function getBranchHeadSha(
  token: string,
  ref: RepoRef,
  branch: string
): Promise<string | null> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to read branch ${branch}`, res.status);
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

export type DraftSyncState = 'created' | 'merged' | 'up-to-date' | 'conflict';

/** Ensure `branch` exists AND tracks `fromBranch` (tech-lead-20260717T090321
 * Decision 1, RC1 fix). Replaces the old `ensureBranch`, which early-returned
 * on an existing branch and never synced it — the root cause of the draft
 * running stale code against new-schema content. Single-caller-pattern
 * replacement: `ensureBranch` is deleted, this is the only entry point.
 *
 * Missing branch: create from `fromBranch` HEAD exactly as before, return
 * `syncState: 'created'`. Existing branch: merge `fromBranch` INTO `branch`
 * via the existing `mergeBranches` (base/head are the REVERSE of
 * publish.ts's usage — publish merges draft into master, this merges master
 * into draft). Both refs are still fixed server constants, never
 * caller-supplied — the no-arbitrary-ref property is preserved. No force, no
 * reset, no branch deletion in this path (KB-0019: a rejection is a report,
 * not an obstacle to bulldoze) — a conflict is returned, never
 * auto-resolved. */
export async function ensureDraftBranchSynced(
  token: string,
  ref: RepoRef,
  branch: string,
  fromBranch: string
): Promise<{ headSha: string; syncState: DraftSyncState }> {
  // Compare-first (tech-lead-20260719T095958 Issue 2 micro-opt): in the
  // common steady state (branch already exists) `compareCommits(base=branch,
  // head=fromBranch)` alone yields BOTH the branch's current head sha
  // (`baseSha`) AND the ahead/behind status in a single GET, so the branch
  // no longer needs its own separate getBranchHeadSha call up front. Only
  // when compare 404s (branch ref doesn't exist yet) do we fall back to the
  // original create path, which re-derives things via getBranchHeadSha as
  // before. Zero behavior change: same sync decisions, same calls made on
  // the create path, no caching, no force/reset (KB-0019), RC1 sync anchor
  // (recomputed live every call) intact.
  const comparison = await compareCommits(token, ref, branch, fromBranch);

  if (!comparison) {
    // branch ref not found (404) -- fall back to the create path.
    const baseSha = await getBranchHeadSha(token, ref, fromBranch);
    if (!baseSha) {
      throw new GitHubApiError(`Base branch ${fromBranch} not found`, 404);
    }
    const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (!res.ok && res.status !== 422) {
      // 422 = ref already exists (race with a concurrent ensure call) — treat as success.
      throw new GitHubApiError(`Failed to create branch ${branch}`, res.status);
    }
    const head = await getBranchHeadSha(token, ref, branch);
    if (!head) throw new GitHubApiError(`Branch ${branch} missing after create`, 500);
    return { headSha: head, syncState: 'created' };
  }

  // A2 (tech-lead-20260718T174921 Design A2 / KB-0009): only merge
  // `fromBranch` into `branch` when `fromBranch` has ACTUALLY advanced
  // relative to `branch` -- avoids an unconditional /merges POST (write
  // amplification) on every ensure call. `comparison` (base=branch,
  // head=fromBranch) describes `fromBranch` relative to `branch`:
  // 'ahead' = fromBranch has commits branch lacks (needs merge); 'diverged'
  // = both have unique commits (needs a real merge, may conflict);
  // 'behind' = fromBranch has nothing branch lacks; 'identical' = same
  // commit. Recomputed live on every call -- no cached/latched sha.
  const existing = comparison.baseSha;
  if (comparison.status === 'identical' || comparison.status === 'behind') {
    return { headSha: existing, syncState: 'up-to-date' };
  }
  // status is 'ahead'/'diverged' -- fall through to the merge attempt.

  const mergeResult = await mergeBranches(token, ref, {
    base: branch,
    head: fromBranch,
    commitMessage: 'Sync master into editor-draft',
  });

  if (!mergeResult.merged) {
    // Conflict is NOT fatal and must NOT block editing (Decision 1b) — the
    // draft's content is still valid and still the user's; a conflict only
    // means the preview build is unreliable. Caller returns 200 with this
    // syncState, never a failure.
    return { headSha: existing, syncState: 'conflict' };
  }

  if (mergeResult.sha === existing) {
    // 204 from mergeBranches ("nothing to merge") resolves to the base's
    // own current sha, which is `existing` — no new commit was made.
    return { headSha: existing, syncState: 'up-to-date' };
  }

  return { headSha: mergeResult.sha, syncState: 'merged' };
}

export type GetFileResult = { sha: string; contentBase64: string } | null;

/** Note (tech-lead-20260718T082028 §A4): despite the `branch` param name,
 * GitHub's `?ref=` accepts any commit-ish — a branch name, tag, OR a raw
 * commit sha. The revert flow (`src/pages/api/draft/revert.ts`) reuses this
 * function with a commit sha in `branch` to read a path AS OF that historic
 * commit. Not renamed (non-breaking / minimal diff). */
export async function getFileOnBranch(
  token: string,
  ref: RepoRef,
  path: string,
  branch: string
): Promise<GetFileResult> {
  const res = await githubFetch(
    token,
    `/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to read ${path}@${branch}`, res.status);
  const data = (await res.json()) as { sha: string; content: string };
  return { sha: data.sha, contentBase64: data.content };
}

/** Fallback for blobs the Contents API can't inline (>1MB, `content:""`
 * `encoding:"none"`). The Git Blobs API inlines base64 for blobs up to
 * 100MB, so this covers the full upload range. `sha` MUST be server-derived
 * (from a prior `getFileOnBranch` result) — callers must never pass a
 * caller-supplied sha; this function itself does no path validation, so the
 * caller's path-regex gate is what makes the sha trustworthy. Read-only, no
 * write/merge/force. Returns null on 404/non-OK/absent content, matching the
 * existing null-on-absence convention in this file. */
export async function getBlobBase64BySha(
  token: string,
  ref: RepoRef,
  sha: string
): Promise<string | null> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/git/blobs/${sha}`);
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { content?: string } | null;
  return data?.content ?? null;
}

export type DirectoryEntry = { name: string; path: string; sha: string; type: 'file' | 'dir' };

/** List a directory's contents on a branch. Returns `null` on 404 — for a
 * directory listing, 404 means "no such directory", which for git means
 * ZERO entries (git cannot represent an empty directory), NOT an error and
 * NOT license to fall back to another branch (tech-lead-20260717T090321
 * Decision 2d). Callers that treat a 404 here as an error resurrect content
 * a branch deliberately has none of. */
export async function listDirectoryOnBranch(
  token: string,
  ref: RepoRef,
  dirPath: string,
  branch: string
): Promise<DirectoryEntry[] | null> {
  const cleanPath = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  const res = await githubFetch(
    token,
    `/repos/${ref.owner}/${ref.repo}/contents/${cleanPath}?ref=${encodeURIComponent(branch)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to list ${dirPath}@${branch}`, res.status);
  const data = (await res.json()) as Array<{ name: string; path: string; sha: string; type: string }>;
  return data.map((d) => ({
    name: d.name,
    path: d.path,
    sha: d.sha,
    type: d.type === 'dir' ? 'dir' : 'file',
  }));
}

export type CommitAuthor = { name: string; email: string };

export async function putFileOnBranch(
  token: string,
  ref: RepoRef,
  params: {
    path: string;
    branch: string;
    contentBase64: string;
    sha: string | null; // null when creating a new file
    message: string;
    author: CommitAuthor;
  }
): Promise<{ commitSha: string }> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/contents/${params.path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: params.message,
      content: params.contentBase64,
      branch: params.branch,
      ...(params.sha ? { sha: params.sha } : {}),
      author: params.author,
      committer: params.author,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(`Failed to write ${params.path}: ${res.status} ${body}`, res.status);
  }
  const data = (await res.json()) as { commit: { sha: string } };
  return { commitSha: data.commit.sha };
}

export async function deleteFileOnBranch(
  token: string,
  ref: RepoRef,
  params: { path: string; branch: string; sha: string; message: string; author: CommitAuthor }
): Promise<void> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/contents/${params.path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: params.message,
      sha: params.sha,
      branch: params.branch,
      author: params.author,
      committer: params.author,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(`Failed to delete ${params.path}: ${res.status} ${body}`, res.status);
  }
}

export async function mergeBranches(
  token: string,
  ref: RepoRef,
  params: { base: string; head: string; commitMessage: string }
): Promise<{ merged: true; sha: string } | { merged: false; conflict: true }> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/merges`, {
    method: 'POST',
    body: JSON.stringify({
      base: params.base,
      head: params.head,
      commit_message: params.commitMessage,
    }),
  });
  if (res.status === 409) {
    return { merged: false, conflict: true };
  }
  if (res.status === 204) {
    // base already up to date with head (nothing to merge) — treat head sha as current base sha.
    const sha = await getBranchHeadSha(token, ref, params.base);
    return { merged: true, sha: sha ?? '' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(`Merge failed: ${res.status} ${body}`, res.status);
  }
  const data = (await res.json()) as { sha: string };
  return { merged: true, sha: data.sha };
}

// ---- Read-only history/revert helpers (tech-lead-20260718T082028 §A) ----
// Reused for item 4 (changelog + safe revert). No write/merge/force calls
// live in this section — every function here is a plain GET.

export type CommitSummary = { sha: string; message: string; date: string };

/** Last `perPage` commits reachable from `branch`, newest first. Deliberately
 * does NOT fetch each commit's `files[]` — the list endpoint doesn't return
 * that, and fetching per-commit detail for a purely cosmetic area badge (the
 * client parses it from the message prefix, PO decision) would be `perPage`
 * extra API calls for no security or correctness benefit. Returns `[]` on an
 * empty/absent branch (404) rather than throwing, matching this module's
 * null/empty-on-absence convention. */
export async function listCommitsOnBranch(
  token: string,
  ref: RepoRef,
  branch: string,
  perPage = 30
): Promise<CommitSummary[]> {
  const res = await githubFetch(
    token,
    `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`
  );
  if (res.status === 404 || res.status === 409) return []; // 409 = empty repo/branch with no commits.
  if (!res.ok) throw new GitHubApiError(`Failed to list commits on ${branch}`, res.status);
  const data = (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author: { date: string } };
  }>;
  return data.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author.date }));
}

export type CommitDetail = {
  parents: string[];
  files: { filename: string; status: string }[];
};

/** Full detail for one commit, including the files it touched
 * (added/modified/removed/renamed) and its parent shas. This is how the
 * server RE-DERIVES which paths a revert target commit touched — the client
 * only ever supplies a sha, never a path list (KB-0017). 404 -> null. */
export async function getCommitDetail(
  token: string,
  ref: RepoRef,
  sha: string
): Promise<CommitDetail | null> {
  const res = await githubFetch(token, `/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(sha)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to read commit ${sha}`, res.status);
  const data = (await res.json()) as {
    parents: { sha: string }[];
    files?: { filename: string; status: string }[];
  };
  return {
    parents: data.parents.map((p) => p.sha),
    files: data.files ?? [],
  };
}

export type CompareResult = { baseSha: string; mergeBaseSha: string; status: string };

/** Compare two commit-ishes. Used solely for the revert ancestor gate:
 * `compareCommits(base=targetSha, head=draftHead)` and requiring
 * `mergeBaseSha === baseSha` proves `targetSha` is an ancestor of the
 * current draft HEAD (i.e. genuinely reachable history, not an arbitrary
 * foreign sha the client made up). 404 -> null (e.g. targetSha doesn't
 * exist in this repo at all). */
export async function compareCommits(
  token: string,
  ref: RepoRef,
  base: string,
  head: string
): Promise<CompareResult | null> {
  const res = await githubFetch(
    token,
    `/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(`Failed to compare ${base}...${head}`, res.status);
  const data = (await res.json()) as {
    base_commit: { sha: string };
    merge_base_commit: { sha: string };
    status: string;
  };
  return { baseSha: data.base_commit.sha, mergeBaseSha: data.merge_base_commit.sha, status: data.status };
}

/** Delete a branch ref (tech-lead-20260717T090321 Decision 1d — recreate the
 * draft clean from master after a successful publish). Safe ONLY because
 * the caller must only invoke this after `mergeBranches` reports
 * `merged: true`: every commit that was on the branch is by then reachable
 * from the merge target, so nothing is discarded. 404 (already gone) is
 * treated as success, not an error. */
export async function deleteBranch(token: string, ref: RepoRef, branch: string): Promise<void> {
  const res = await githubFetch(
    token,
    `/repos/${ref.owner}/${ref.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 404) {
    throw new GitHubApiError(`Failed to delete branch ${branch}`, res.status);
  }
}
