import { requireEnv, optionalEnv } from './env';
import { parseRepo, type CommitAuthor, type RepoRef } from './github';

export const MASTER_BRANCH = 'master';

export const COMMIT_AUTHOR: CommitAuthor = {
  name: 'Isaiah Ho',
  email: '256765612+ynscancode@users.noreply.github.com',
};

export function getRepoRef(): RepoRef {
  return parseRepo(requireEnv('GITHUB_REPO'));
}

export function getDraftBranch(): string {
  return requireEnv('DRAFT_BRANCH');
}

export function getWriteToken(): string {
  return requireEnv('GIT_WRITE_TOKEN');
}

/** Best-effort preview URL for the draft branch. Vercel's actual branch-deploy
 * URL depends on project/team slugs that aren't available at this layer; if
 * `VERCEL_PREVIEW_URL_TEMPLATE` (with a `{branch}` placeholder) is configured,
 * use it, otherwise fall back to a GitHub branch URL so the response is never
 * broken — devops-engineer owns wiring the real Vercel preview URL template.
 */
export function buildPreviewUrl(branch: string): string {
  const template = optionalEnv('VERCEL_PREVIEW_URL_TEMPLATE', '');
  if (template) {
    return template.replace('{branch}', branch);
  }
  const { owner, repo } = getRepoRef();
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}`;
}
