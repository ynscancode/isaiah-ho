// Browser-only helpers for the inline editor UI (src/pages/edit/**).
// Never imported by any public-facing page/component — only by
// src/pages/edit/[...path].astro and src/components/edit/*.astro /
// EditorHarness.astro, all of which are prerender=false and gated by
// src/middleware.ts. See TEAM-BOARD tech-lead-20260715T192159 (frontend
// contract) and senior-backend-dev-20260716T030500 (API contract, CSRF
// delivery via the `csrf_token` cookie).

// One-directional: history.ts never imports this module, so no cycle.
// Used by makeAutosaver's flush() to suppress the per-step save/commit
// during an undo/redo apply (tech-lead-20260720T164457Z).
import { isApplying } from './history';

export type SaveResult = { ok: boolean; commitSha?: string; error?: string; action?: string };

function getCookie(name: string): string | null {
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
  const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Read the non-httpOnly CSRF cookie minted alongside the session at
 * /api/auth/callback (see src/lib/session.ts CSRF_COOKIE_NAME). */
export function getCsrfToken(): string {
  return getCookie('csrf_token') ?? '';
}

let draftEnsured = false;

/** Server contract (senior-backend-dev-20260717T010600): on a CSRF failure
 * for any mutating /api/** call, the response is HTTP 403,
 * content-type application/json, body { error: "csrf_invalid", action:
 * "reauth" }. Status stays 403 (KB-0017 — server check is the real
 * boundary, this only improves failure UX). When detected, broadcast a
 * page-wide signal so EditorHarness.astro can surface a "log in again"
 * recovery affordance instead of a generic dead-end failure — this fires
 * from every mutating call site below, including ensureDraft(), whose
 * result was previously swallowed silently on a non-ok response. */
function checkReauthNeeded(status: number, data: { error?: string; action?: string } | null): boolean {
  if (status === 403 && data?.error === 'csrf_invalid') {
    window.dispatchEvent(new CustomEvent('editor:reauth-needed'));
    return true;
  }
  return false;
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type DraftSyncState = 'created' | 'merged' | 'up-to-date' | 'conflict';

/** Last syncState reported by ensureDraft()'s server call this page load, if
 * any. Exposed so EditorHarness.astro can show a conflict banner without
 * every caller having to thread the return value through. */
export let lastDraftSyncState: DraftSyncState | null = null;

/** Idempotent — safe to call before every first-save-of-session. Only
 * actually hits the network once per page load. Returns the server's
 * reported syncState (senior-backend-dev-20260717T180600 RC1), or null if
 * the call failed or was skipped because a draft was already ensured. */
export async function ensureDraft(): Promise<DraftSyncState | null> {
  if (draftEnsured) return lastDraftSyncState;
  const res = await fetch('/api/draft/ensure', {
    method: 'POST',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });
  if (res.ok) {
    draftEnsured = true;
    const data = await parseJsonSafe<{ syncState?: DraftSyncState }>(res);
    lastDraftSyncState = data?.syncState ?? null;
    if (lastDraftSyncState) {
      window.dispatchEvent(
        new CustomEvent('editor:draft-sync-state', { detail: { syncState: lastDraftSyncState } })
      );
    }
    return lastDraftSyncState;
  }
  const data = await parseJsonSafe<{ error?: string; action?: string }>(res);
  checkReauthNeeded(res.status, data);
  return null;
}

export async function saveArea(area: string, body: unknown): Promise<SaveResult> {
  await ensureDraft();
  const res = await fetch(`/api/content/${area}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe<{ commitSha?: string; error?: string; action?: string }>(res);
  if (!res.ok) {
    checkReauthNeeded(res.status, data);
    return { ok: false, error: data?.error ?? `http_${res.status}`, action: data?.action };
  }
  return { ok: true, commitSha: data?.commitSha };
}

export async function deleteBlogPost(slug: string): Promise<SaveResult> {
  await ensureDraft();
  const res = await fetch('/api/content/blog', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify({ slug }),
  });
  if (!res.ok) {
    const data = await parseJsonSafe<{ error?: string; action?: string }>(res);
    checkReauthNeeded(res.status, data);
    return { ok: false, error: data?.error ?? `http_${res.status}`, action: data?.action };
  }
  return { ok: true };
}

export type PreviewSyncState = 'synced' | 'already-current' | 'conflict';

export type PreviewResult = {
  previewUrl: string;
  lastCommitSha: string;
  /** The just-synced draft tip that was built. Pass to pollPreviewStatus()
   * as a read-only correlation filter only — never a git ref/path
   * (senior-backend-dev-20260720T052230). */
  targetSha: string;
  /** True only when the server has Vercel API polling configured
   * (VERCEL_API_TOKEN + VERCEL_PROJECT_ID). When false, no per-deployment
   * status is available — callers must fall back to the alias `previewUrl`
   * with honest "~30s" messaging (tech-lead-20260720T051536 graceful
   * degradation). */
  pollable: boolean;
  syncState: PreviewSyncState;
};

/** POST /api/draft/preview — session+CSRF gated, triggers an on-demand
 * preview build. Response contract per senior-backend-dev-20260720T052230.
 * Returns null on failure (caller shows "no draft yet" / retry messaging;
 * never a false "ready"). */
export async function fetchPreview(): Promise<PreviewResult | null> {
  // POST + CSRF token: the endpoint now triggers an on-demand build, so it's
  // a CSRF-checked mutation (see src/pages/api/draft/preview.ts). Mirrors the
  // header + reauth handling of the other mutating calls above.
  const res = await fetch('/api/draft/preview', {
    method: 'POST',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    checkReauthNeeded(res.status, data);
    return null;
  }
  return res.json();
}

export type PreviewStatus =
  | { pollable: false; state: 'UNKNOWN' }
  | { pollable: true; state: 'QUEUED' | 'BUILDING' | 'ERROR' | 'READY'; url?: string };

/** GET /api/draft/preview-status?targetSha=... — session-gated, no CSRF
 * (pure read, mirrors fetchHistory()). Returns null only on an unexpected
 * network/parse failure (the two expected/documented shapes above are both
 * still 200s and returned as-is) — caller should treat null the same as a
 * poll attempt that didn't resolve anything (keep polling / eventually
 * time out), never as a false "ready". */
export async function pollPreviewStatus(targetSha: string): Promise<PreviewStatus | null> {
  const res = await fetch(`/api/draft/preview-status?targetSha=${encodeURIComponent(targetSha)}`);
  if (!res.ok) return null;
  return parseJsonSafe<PreviewStatus>(res);
}

// --- Item 4: version history / revert (tech-lead-20260718T082028 §E) ---

export type CommitSummary = { sha: string; message: string; date: string };

/** One editing session — a run of autosave commits collapsed into one
 * version-history card (tech-lead-20260719T095958 Issue 3, Option A;
 * grouping happens server-side in src/lib/history/sessionGrouping.ts /
 * src/pages/api/draft/history.ts, this is purely the response shape). The
 * session containing draft HEAD is `sessions[0]` (server preserves the
 * commits' newest-first order, and session order follows member order).
 * `commitCount === 1` sessions are a single real commit and should render
 * as a plain non-expandable row (director-approved default,
 * engineering-director-20260719T100312 #3). */
export type HistorySession = {
  /** Newest commit in the session — "Restore this version" target. */
  latestSha: string;
  /** ISO date of the oldest member (session start). */
  startedAt: string;
  /** ISO date of the newest member (session end). */
  endedAt: string;
  commitCount: number;
  /** Distinct area badges across the session's members (collapsed-card
   * badge text), newest-first-seen order. Cosmetic only — see
   * sessionGrouping.ts; never used for any trust decision. */
  areas: string[];
  /** Members, newest-first. Each keeps its own sha/message/date so a
   * per-edit "Restore this edit" can target any individual member via the
   * SAME `revertDraft(sha)` below. */
  commits: CommitSummary[];
};

/** GET /api/draft/history — session-gated, no CSRF (read-only). Returns the
 * last 30 commits on editor-draft (newest first) grouped into sessions, or
 * null on failure (the caller renders the error state, never a
 * false-empty list). */
export async function fetchHistory(): Promise<{ sessions: HistorySession[] } | null> {
  const res = await fetch('/api/draft/history');
  if (!res.ok) return null;
  return parseJsonSafe<{ sessions: HistorySession[] }>(res);
}

export type RevertResult =
  | { ok: true; headSha?: string; revertedPaths?: string[] }
  | { ok: false; error: string };

/** POST /api/draft/revert — session+CSRF gated, body { targetSha } ONLY
 * (KB-0017 — client never sends paths/git-ops, the server re-derives which
 * whitelisted files the commit touched). Error contract: invalid_target
 * (400), unreachable_sha (409), no_content_paths (422), revert_conflict
 * (409), write_failed (502), csrf_invalid (403, handled generically below
 * via the reauth event same as every other mutating call). */
export async function revertDraft(targetSha: string): Promise<RevertResult> {
  const res = await fetch('/api/draft/revert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify({ targetSha }),
  });
  const data = await parseJsonSafe<{ headSha?: string; revertedPaths?: string[]; error?: string; action?: string }>(res);
  if (!res.ok) {
    checkReauthNeeded(res.status, data);
    return { ok: false, error: data?.error ?? `http_${res.status}` };
  }
  return { ok: true, headSha: data?.headSha, revertedPaths: data?.revertedPaths };
}

export async function publishDraft(): Promise<{ ok: boolean; conflict?: boolean; commitSha?: string }> {
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });
  if (res.status === 409) return { ok: false, conflict: true };
  if (!res.ok) {
    const data = await parseJsonSafe<{ error?: string; action?: string }>(res);
    checkReauthNeeded(res.status, data);
    return { ok: false };
  }
  const data = await res.json();
  return { ok: true, commitSha: data.commitSha };
}

export async function logoutAndRedirect(): Promise<void> {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });
  if (!res.ok) {
    const data = await parseJsonSafe<{ error?: string; action?: string }>(res);
    checkReauthNeeded(res.status, data);
  }
  // Logout always sends the user to '/' regardless of whether the CSRF
  // check on this call itself passed — a failed logout call still means
  // the user wants out of the editor, and a fresh visit re-establishes
  // whatever session state is valid.
  window.location.href = '/';
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Matches the server-side slug regex in src/lib/schemas.ts
 * (^[a-z0-9]+(-[a-z0-9]+)*$) so client-generated slugs always pass
 * validation on save. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return base.length > 0 ? base : `untitled-${Date.now().toString(36)}`;
}

export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The Hero headline is the one field rendered with `set:html` (raw,
 * unescaped) — see senior-backend-dev-20260716T030500 XSS note. Strip
 * everything except <br> before it ever reaches the network so a pasted
 * <script>/<img onerror> etc. can't survive the round trip even though the
 * editor is single-owner. Defense in depth alongside the server's
 * length-capped (not HTML-aware) Zod validation. */
export function sanitizeHeadlineHtml(rawHtml: string): string {
  const BR_PLACEHOLDER = ' BR ';
  return rawHtml
    .replace(/<br\s*\/?>/gi, BR_PLACEHOLDER)
    .replace(/<[^>]*>/g, '')
    .split(BR_PLACEHOLDER)
    .join('<br>');
}

/** Dot-path get/set into a plain object/array tree, e.g. "primaryCta.href"
 * or "paragraphs.1". Array segments are looked up positionally; object
 * segments (including non-numeric map keys used for id-keyed collections)
 * by property name. */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cur[key];
    if (next == null || typeof next !== 'object') {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'retrying' | 'error';

export function statusLabel(status: SaveStatus): string {
  switch (status) {
    case 'idle':
      return 'No changes';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved to draft';
    case 'retrying':
      // tech-lead-20260718T174921 Design A3: a 503 github_unavailable (or a
      // client-side network throw) is a TRANSIENT upstream blip, not a
      // terminal failure — the banner must say so honestly rather than
      // showing the same red "Save failed" state as a genuine error.
      return "Can't reach GitHub — retrying…";
    case 'error':
      return 'Save failed';
    default:
      return '';
  }
}

// --- Shared background-autosave helper (tech-lead-20260718T041814 D3) ---
//
// Every edit component's DOM update is already synchronous+optimistic; this
// helper only owns the *save* side: debouncing, status broadcast, and
// routing failures so they're never silently swallowed (KB-0017).

/** Areas (by opaque instance id) that currently have unsaved risk — status
 * is anything other than 'idle'/'saved'. Tracked centrally so a single
 * beforeunload listener (installed once, below) can warn regardless of how
 * many independent autosaver instances exist on the page (e.g. EditCollection
 * has one for entries + one for its emptyStates field). */
const unsavedAreas = new Set<number>();
let autosaverIdSeq = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (unsavedAreas.size === 0) return;
    event.preventDefault();
    // Legacy requirement for the prompt to actually show in most browsers.
    event.returnValue = '';
  });
}

export type Autosaver = {
  /** Call on every field change (continuous typing). Marks the area dirty
   * (registers it in `unsavedAreas` for the beforeunload guard) and clears
   * any pending transient-failure retry timer. Starts NO timer and NEVER
   * calls `runSave` — this is commit-on-blur, not commit-on-pause. The
   * actual git commit happens only via `flush()` (tech-lead-20260720T041354
   * save-trigger redesign). */
  markDirty: () => void;
  /** Call from a discrete-commit event (`<select>` change, picker/prompt
   * confirm, undo/redo apply, the Save button / `editor:save-all` path):
   * saves now — UNLESS called while an undo/redo apply is in progress
   * (`isApplying()`, tech-lead-20260720T164457Z), in which case it performs
   * no save and only refreshes the dirty/saved status by VALUE. Otherwise
   * unconditional + single-flight safe; this is the SOLE git-commit trigger.
   * Returns a promise so callers that need to know when the save (and any
   * trailing re-save chained onto it) has settled can await it. */
  flush: () => Promise<void>;
  /** Call from a blur handler: saves now, but ONLY if the current working
   * value actually differs from the last SAVED value (`isUnsaved()`,
   * value-based — tech-lead-20260720T164457Z, supersedes the boolean-only
   * `dirty` gate). A focus+blur with no typing is a no-op; so is a blur
   * landing back on an undo/redo'd state that matches what's already saved.
   * A blur on a state that differs from saved — whether from a real edit or
   * from undo/redo landing somewhere new — still saves exactly once. */
  flushIfDirty: () => Promise<void>;
};

export function makeAutosaver({
  save,
  snapshot,
}: {
  /** Must build its payload from CURRENT working state at call time — the
   * autosaver may call this again for a trailing re-save after the working
   * state has changed further. Return the existing SaveResult contract. */
  save: () => Promise<SaveResult>;
  /** Serializes the component's CURRENT working state to a comparable
   * string (e.g. `() => JSON.stringify(working)`), for the value-based
   * dirty-vs-saved comparison (tech-lead-20260720T164457Z §B). Must mirror
   * the actual payload `save()` persists — if `save()` transforms/holds back
   * part of `working` before sending, `snapshot` should apply the same
   * transform, or the comparison won't track what's really saved. */
  snapshot: () => string;
}): Autosaver {
  const id = autosaverIdSeq++;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let pendingResave = false;
  // tech-lead-20260720T110251: true once a real edit (markDirty) has
  // happened since the last SUCCESSFUL save. Cleared only on result.ok so a
  // failed save never silently drops a genuinely-unsaved change. Kept for
  // cheap per-keystroke status text ("Unsaved changes") — the AUTHORITATIVE
  // save gate is now `isUnsaved()` below (tech-lead-20260720T164457Z); the
  // two are kept in sync (never allowed to conflict) rather than merged,
  // since `dirty` needs to flip true on every keystroke (cheap) while
  // `isUnsaved()` re-serializes the whole working state (only called at
  // discrete decision points: flush()/flushIfDirty()/refreshDirtyStatus()).
  let dirty = false;
  // Value last successfully persisted by THIS autosaver, seeded at
  // construction (on load, working === draft, so this starts in sync).
  // Updated only on a confirmed result.ok — see runSave() below.
  let lastSavedSnapshot = snapshot();

  /** Value-based dirty check (the authoritative save gate) — true whenever
   * the current working state differs from what was last actually saved,
   * regardless of how it got that way (typing, or an undo/redo apply that
   * landed on a different state than the draft). */
  function isUnsaved(): boolean {
    return snapshot() !== lastSavedSnapshot;
  }

  // tech-lead-20260718T174921 Design A3: transient upstream failures
  // (503 github_unavailable from the server's retryable-GitHubApiError
  // contract, or a client-side network throw) get one more automatic
  // retry after a short delay, distinct from the debounce timer above —
  // the user didn't make a new edit, so this must not depend on one.
  // Server-side githubFetch has ALREADY exhausted its own bounded
  // retry/backoff budget before returning 503, so this is a single
  // lightweight follow-up, not a duplicate retry storm.
  const RETRY_DELAY_MS = 4000;

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function scheduleRetry() {
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void runSave();
    }, RETRY_DELAY_MS);
  }

  function setStatus(next: SaveStatus, opts?: { silent?: boolean }) {
    if (next === 'idle' || next === 'saved') {
      unsavedAreas.delete(id);
    } else {
      unsavedAreas.add(id);
    }
    if (opts?.silent) return;
    window.dispatchEvent(
      new CustomEvent('editor:area-status', { detail: { status: next, label: statusLabel(next) } })
    );
  }

  async function runSave(): Promise<void> {
    if (inFlight) {
      // Single-flight: mark exactly one trailing re-save, don't run
      // concurrently. The re-save (when it fires) re-invokes `save()`,
      // which reads working state at THAT later call time.
      pendingResave = true;
      return;
    }
    inFlight = true;
    setStatus('saving');
    // Captured SYNCHRONOUSLY, before the await — the same `working`
    // authority `save()` itself reads from at this call time (KB-0020-safe:
    // no risk of a concurrent edit during the await corrupting what we
    // compare against; a concurrent edit instead correctly makes the NEXT
    // isUnsaved() check see fresh, still-unsaved state).
    const sent = snapshot();
    let result: SaveResult;
    try {
      result = await save();
    } catch {
      result = { ok: false, error: 'network_error' };
    }
    inFlight = false;

    if (result.ok) {
      dirty = false;
      lastSavedSnapshot = sent;
      clearRetryTimer();
      setStatus('saved');
    } else if (result.error === 'github_unavailable' || result.error === 'network_error') {
      // TRANSIENT — never the terminal red "Save failed" state. Area stays
      // dirty (setStatus('retrying') keeps it out of idle/saved), and a
      // short automatic retry follows without waiting for another edit.
      setStatus('retrying');
      scheduleRetry();
    } else if (result.error === 'csrf_invalid') {
      // saveArea()/deleteBlogPost() already dispatched the EXISTING
      // editor:reauth-needed event (unchanged behavior) — EditorHarness
      // owns the "Session expired" status text for that case, so don't
      // fight it with a generic "Save failed" broadcast. Still track the
      // area as unsaved for the beforeunload warning.
      setStatus('error', { silent: true });
    } else if (result.error === 'stale_form') {
      // New event: EditorHarness (and any component with extra local
      // affordances, e.g. EditAbout's reload button) shows a "content
      // changed on the server — reload to continue" message. NEVER
      // auto-reload — that would silently drop unsaved edits.
      window.dispatchEvent(new CustomEvent('editor:stale-form'));
      setStatus('error', { silent: true });
    } else {
      // Generic/other failure: surface it and leave the area dirty so the
      // next blur/commit (flush()) or the Save button / editor:save-all
      // retries — a failed background save is never silently lost.
      setStatus('error');
    }

    if (pendingResave) {
      pendingResave = false;
      await runSave();
    }
  }

  function markDirty() {
    dirty = true;
    setStatus('dirty');
    clearRetryTimer();
  }

  /** Value-accurate refresh with NO save — used when flush() is called
   * mid-undo/redo apply (see flush() below). Keeps the status banner AND
   * the beforeunload `unsavedAreas` membership (driven by setStatus, see
   * above) truthful about whether the just-applied state actually differs
   * from what's saved, without performing (or scheduling) a real save. */
  function refreshDirtyStatus() {
    if (isUnsaved()) {
      dirty = true;
      setStatus('dirty');
    } else {
      dirty = false;
      setStatus('saved');
    }
  }

  async function flush(): Promise<void> {
    if (isApplying()) {
      // undo()/redo() just wrote `working` via controller.apply(); every
      // field's onApply still unconditionally calls autosaver.flush(), but
      // per the decoupled model (tech-lead-20260720T164457Z) an apply must
      // NEVER perform a real save/commit — only reconcile the visible
      // dirty/saved status against the new in-memory value.
      refreshDirtyStatus();
      return;
    }
    clearRetryTimer();
    await runSave();
  }

  async function flushIfDirty(): Promise<void> {
    if (!isUnsaved()) return;
    await flush();
  }

  return { markDirty, flush, flushIfDirty };
}
