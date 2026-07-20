// Thin Vercel Deployments REST API client (tech-lead-20260720T051536 RC1 fix).
// Plain `fetch`, no SDK dependency — mirrors github.ts's minimal-deps style.
//
// The Bearer token (`VERCEL_API_TOKEN`) and project id (`VERCEL_PROJECT_ID`,
// optional `VERCEL_TEAM_ID`) are read exclusively via `process.env`/
// `optionalEnv` by callers (KB-0018 — never a literal `import.meta.env.*`
// read, which Vite would statically inline into the built bundle). This
// module never logs, returns, or embeds the token in any value it produces —
// every exported function's return type carries only readyState/url data,
// never the credentials used to fetch it.

const VERCEL_API = 'https://api.vercel.com';

export class VercelApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'VercelApiError';
    this.status = status;
  }
}

// Vercel's documented deployment lifecycle states (Deployments API). Not
// every value is reachable via findDeploymentByCommitSha's normal flow, but
// the type reflects the API's actual contract rather than only the subset we
// map through.
export type VercelReadyState =
  | 'QUEUED'
  | 'BUILDING'
  | 'INITIALIZING'
  | 'READY'
  | 'ERROR'
  | 'CANCELED';

export type VercelDeploymentMatch = {
  readyState: VercelReadyState;
  /** Bare per-deployment hostname as returned by the API (no protocol) —
   * callers that need a navigable URL must prefix `https://`. This is the
   * exact build's own URL, distinct from the moving branch alias. */
  url: string;
};

async function vercelFetch(token: string, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${VERCEL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (networkErr) {
    throw new VercelApiError(`Network error contacting Vercel: ${String(networkErr)}`, 0);
  }
  if (!res.ok) {
    throw new VercelApiError(`Vercel API request failed: ${res.status}`, res.status);
  }
  return res;
}

type VercelDeploymentsListResponse = {
  deployments?: Array<{
    readyState?: VercelReadyState;
    url?: string;
    meta?: { githubCommitSha?: string };
  }>;
};

/** Look up the deployment for `projectId` whose commit sha matches
 * `targetSha`, correlated via each deployment's `meta.githubCommitSha` (the
 * Deployments list endpoint's own field for the triggering commit — no
 * separate lookup needed). Returns `null` when no deployment for that sha
 * is visible yet (e.g. Vercel hasn't registered the just-triggered build) —
 * callers should treat that as "not found yet, keep polling," not an error.
 * Throws `VercelApiError` on a genuine API/network failure; callers decide
 * how to degrade (never surfaced as a 500 to the editor). */
export async function findDeploymentByCommitSha(
  token: string,
  projectId: string,
  teamId: string,
  targetSha: string
): Promise<VercelDeploymentMatch | null> {
  const params = new URLSearchParams({ projectId, limit: '20' });
  if (teamId) params.set('teamId', teamId);
  const res = await vercelFetch(token, `/v6/deployments?${params.toString()}`);
  const data = (await res.json().catch(() => null)) as VercelDeploymentsListResponse | null;
  const deployments = data?.deployments ?? [];
  const match = deployments.find((d) => d.meta?.githubCommitSha === targetSha);
  if (!match || !match.readyState || !match.url) return null;
  return { readyState: match.readyState, url: match.url };
}
