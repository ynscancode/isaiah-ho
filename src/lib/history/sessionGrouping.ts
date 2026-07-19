// Pure, dependency-free read-side session grouping for the version-history
// UI (tech-lead-20260719T095958 Issue 3, Option A: gap-based coalescing of
// existing commits, server-side, presentational only). No write-path
// changes, no new security surface — see src/pages/api/draft/history.ts and
// src/pages/api/draft/revert.ts (UNCHANGED). Kept in its own file so it's
// unit-testable without a browser or a live GitHub call.

export type CommitSummary = { sha: string; message: string; date: string };

export type HistorySession = {
  /** Newest commit in the session — the "Restore this version" target
   * (director-approved default: restoring a session restores its
   * end-of-session state). */
  latestSha: string;
  /** ISO date of the oldest member (session start). */
  startedAt: string;
  /** ISO date of the newest member (session end). */
  endedAt: string;
  commitCount: number;
  /** Distinct area badges across the session's members, in first-seen
   * (newest-first) order. Derived from each commit's message prefix using
   * the same "Update <area> content" / "Update blog post: <slug>" /
   * "Revert ..." family the client already parses per-row today — kept as
   * the raw first line here so the frontend's existing badge parser can be
   * reused unchanged per member; this field is the de-duplicated set for
   * the collapsed card. */
  areas: string[];
  /** Members, newest-first. Each keeps its own sha/message/date so a
   * per-edit "Restore this edit" can target any individual member. */
  commits: CommitSummary[];
};

/** director-approved default (engineering-director-20260719T100312):
 * 30 minutes. A single named, trivially-retunable constant. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Best-effort area label derived from a commit message's first line, purely
 * for the collapsed card's badge text — cosmetic only, never used for any
 * security/trust decision (KB-0017: revert re-derives real paths from the
 * sha server-side regardless of this label). Mirrors the existing message
 * prefixes this codebase writes: "Update <area> content",
 * "Update blog post: <slug>", "Delete blog post: <slug>",
 * "Revert <area> content to <sha>", "Revert blog post <slug> to <sha>",
 * "Sync master into editor-draft". Falls back to the raw first line when no
 * known prefix matches, so an unrecognized message never disappears from the
 * badge — it just isn't collapsed into a short label. */
function deriveArea(message: string): string {
  const firstLine = message.split('\n')[0] ?? '';
  const patterns: Array<[RegExp, string]> = [
    [/^Update (\w[\w-]*) content$/, '$1'],
    [/^Revert (\w[\w-]*) content to /, '$1'],
    [/^Update blog post: /, 'blog'],
    [/^Delete blog post: /, 'blog'],
    [/^Revert blog post /, 'blog'],
    [/^Sync master into editor-draft$/, 'sync'],
  ];
  for (const [re, replacement] of patterns) {
    const match = firstLine.match(re);
    if (match) {
      return replacement.startsWith('$1') ? match[1] : replacement;
    }
  }
  return firstLine;
}

/** Groups `commits` (must already be newest-first, e.g. as returned by
 * `listCommitsOnBranch`) into sessions using adjacent-gap coalescing:
 * consecutive commits stay in the same session while the gap between the
 * IMMEDIATELY PRECEDING commit and the current one is `<= gapMs` (NOT
 * distance-from-session-start — a long continuous run of closely-spaced
 * autosaves stays one session even if the run's total span exceeds gapMs).
 * Pure function: no I/O, no mutation of the input array. */
export function groupCommitsIntoSessions(
  commits: CommitSummary[],
  gapMs: number = SESSION_GAP_MS
): HistorySession[] {
  const sessions: HistorySession[] = [];
  let current: CommitSummary[] | null = null;

  for (const commit of commits) {
    if (current === null) {
      current = [commit];
      continue;
    }
    const prev = current[current.length - 1];
    const gap = new Date(prev.date).getTime() - new Date(commit.date).getTime();
    if (gap <= gapMs) {
      current.push(commit);
    } else {
      sessions.push(buildSession(current));
      current = [commit];
    }
  }
  if (current !== null) {
    sessions.push(buildSession(current));
  }
  return sessions;
}

function buildSession(members: CommitSummary[]): HistorySession {
  const areas: string[] = [];
  for (const m of members) {
    const area = deriveArea(m.message);
    if (!areas.includes(area)) areas.push(area);
  }
  return {
    latestSha: members[0].sha,
    startedAt: members[members.length - 1].date,
    endedAt: members[0].date,
    commitCount: members.length,
    areas,
    commits: members,
  };
}
