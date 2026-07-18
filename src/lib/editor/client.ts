// Browser-only helpers for the inline editor UI (src/pages/edit/**).
// Never imported by any public-facing page/component — only by
// src/pages/edit/[...path].astro and src/components/edit/*.astro /
// EditorHarness.astro, all of which are prerender=false and gated by
// src/middleware.ts. See TEAM-BOARD tech-lead-20260715T192159 (frontend
// contract) and senior-backend-dev-20260716T030500 (API contract, CSRF
// delivery via the `csrf_token` cookie).

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

export async function fetchPreview(): Promise<{ previewUrl: string; lastCommitSha: string } | null> {
  const res = await fetch('/api/draft/preview');
  if (!res.ok) return null;
  return res.json();
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

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

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
  /** Call on every field change. Marks the area dirty, (re)starts the
   * debounce timer, and — if a save is already in flight — schedules
   * exactly one trailing re-save once it resolves (never drops the last
   * edit, never runs two saves concurrently for the same area). */
  schedule: () => void;
  /** Call from the Save button / `editor:save-all` path: cancels any
   * pending debounce and saves now (still single-flight safe). Returns a
   * promise so callers that need to know when the save (and any trailing
   * re-save chained onto it) has settled can await it. */
  flush: () => Promise<void>;
};

export function makeAutosaver({
  save,
  debounceMs = 1500,
}: {
  /** Must build its payload from CURRENT working state at call time — the
   * autosaver may call this again for a trailing re-save after the working
   * state has changed further. Return the existing SaveResult contract. */
  save: () => Promise<SaveResult>;
  debounceMs?: number;
}): Autosaver {
  const id = autosaverIdSeq++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let pendingResave = false;

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
    let result: SaveResult;
    try {
      result = await save();
    } catch {
      result = { ok: false, error: 'network_error' };
    }
    inFlight = false;

    if (result.ok) {
      setStatus('saved');
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
      // next edit (schedule()) or the Save button / editor:save-all
      // (flush()) retries — a failed background save is never silently lost.
      setStatus('error');
    }

    if (pendingResave) {
      pendingResave = false;
      await runSave();
    }
  }

  function schedule() {
    setStatus('dirty');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runSave();
    }, debounceMs);
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    await runSave();
  }

  return { schedule, flush };
}
