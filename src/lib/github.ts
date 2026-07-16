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
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

async function githubFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return res;
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

/** Ensure `branch` exists, creating it from `fromBranch`'s current HEAD if missing.
 * Returns the branch's head sha (existing or newly created). */
export async function ensureBranch(
  token: string,
  ref: RepoRef,
  branch: string,
  fromBranch: string
): Promise<string> {
  const existing = await getBranchHeadSha(token, ref, branch);
  if (existing) return existing;

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
  return head;
}

export type GetFileResult = { sha: string; contentBase64: string } | null;

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
