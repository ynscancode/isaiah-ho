// Client-side (in-session) undo/redo stack for the /edit editor — distinct
// from item 4's server/git version history. Gone on page reload (no
// persistence expected — product-owner-20260718T094512 item 5).
//
// ES-module singleton: every per-component <script> on a page and
// EditorHarness.astro import this SAME module instance (Vite/Astro dedupe
// modules by resolved path within one page load), so `register()` calls
// from EditHome/EditAbout/EditContact/EditCollection/EditBlogPost all land
// in one shared stack, matching the "one linear stack per editor session"
// design (tech-lead-20260718T082028).
//
// A "step" is a field-commit boundary (blur / debounce-settle for text
// fields, or an atomic action like a URL prompt) — NOT a keystroke.
//
// DECOUPLED MODEL (tech-lead-20260720T164457Z, supersedes the "undo/redo are
// indistinguishable from a manual edit" note that used to live here):
// undo()/redo() still write the value back through the field's own
// `apply()` (DOM + the owning component's `working` state), but they do
// this while `applying` (see `isApplying()` below) is true. Each field's
// `onApply` still unconditionally calls `autosaver.flush()` — that call is
// NOT removed here — but `client.ts`'s `flush()` checks `isApplying()` and,
// when true, short-circuits into a value-based status refresh instead of
// performing a real save. So undo/redo cycle the editor between in-memory
// states with ZERO per-step git commits; the user's normal save path (blur /
// Save button / editor:save-all) is what persists whatever state they land
// on, and landing back on the already-saved value is a no-op (value
// comparison in client.ts, not this file). No flush()/save call is added or
// removed in THIS file — the suppression lives entirely in client.ts.

export type FieldController = {
  /** Unique per field, e.g. "home:lede" or "contact:link:abc123.label". */
  id: string;
  /** Returns the CURRENT committed value (post-apply state). */
  read: () => string;
  /** Writes the value back into the DOM + working state + schedules a save. */
  apply: (value: string) => void;
};

type Step = { id: string; from: string; to: string };

const controllers = new Map<string, FieldController>();
const lastValue = new Map<string, string>();
let undoStack: Step[] = [];
let redoStack: Step[] = [];

/** Cap on in-memory undo steps (FIFO — oldest evicted first). Keeps the
 * client-side, reload-discarded history bounded for an unbounded editing
 * session; redoStack needs no separate cap — see commit()/commitAtomic(). */
const HISTORY_CAP = 100;

/** ROOT-CAUSE FIX (senior-frontend-dev-20260721 — refutes the prior
 * "already multi-step, only needs a cap" read, tech-lead-20260720T160521):
 * a plain `<button>` mousedown moves DOM focus to the button BEFORE its
 * `click` handler runs (default browser behavior on Win/Chrome/Firefox),
 * which fires a native `blur` on whatever field the user was just editing.
 * Every field's commit boundary IS that `blur` (wireField()'s own listener,
 * or the inline `el.addEventListener('blur', () => commit(...))` in
 * EditHome.astro) — so clicking the Undo/Redo toolbar buttons right after
 * typing (the single most natural way anyone reaches for Undo) synchronously
 * pushes a brand-new step for the just-typed, not-yet-intentionally-
 * committed text AND unconditionally clears `redoStack` (commit()'s
 * standard truncate-on-edit), ALL before `undo()`/`redo()` below even runs.
 * `undo()` then pops exactly that phantom step (LIFO) instead of walking
 * back to the real previous change, and any accumulated redo history is
 * gone — which is precisely the reported "Undo only ever steps back ONE
 * change" / Redo-not-working symptom. A capture-phase `mousedown` guard on
 * these two specific buttons stops the focus transfer (so no `blur`, so no
 * spurious commit) while leaving the subsequent `click` → undo()/redo()
 * unaffected — the standard technique toolbar buttons next to an editable
 * region use to avoid stealing focus/selection from it. */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousedown',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('#editor-undo-btn, #editor-redo-btn')) {
        event.preventDefault();
      }
    },
    true
  );
}

/** Set for the duration of `controller.apply()` inside undo()/redo() below —
 * the SINGLE unified apply-guard (tech-lead-20260720T164457Z). Serves two
 * purposes: (1) defense-in-depth, same as before — if any current or future
 * field's `setValue`/`onApply` ever synchronously reaches `commit()` /
 * `commitAtomic()`, this stops that from being recorded as a brand-new user
 * edit mid-undo/redo (must never look like a genuine divergent edit that
 * truncates `redoStack`); (2) read by `client.ts` via `isApplying()` so
 * `flush()` can tell an undo/redo-triggered apply apart from a real edit and
 * suppress the per-step git commit (the decoupled-model crux). */
let applying = false;

/** Whether an undo()/redo() call is currently mid-`controller.apply()`.
 * Imported by `client.ts` — one-directional (this file never imports
 * `client.ts`, no cycle). `flush()` uses this to turn an undo/redo's
 * `onApply -> autosaver.flush()` into a value-based status refresh instead
 * of a real save. */
export function isApplying(): boolean {
  return applying;
}

function emitChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('editor:history-changed', {
      detail: { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 },
    })
  );
}

/** Register a field's controller. Call once per field on page load (seeds
 * `lastValue` from the field's current DOM value so the first blur only
 * pushes a step if the user actually changed something). Safe to call again
 * for a field that gets re-created (e.g. a repeating-list row) — re-seeds
 * from the new element's current value. */
export function register(controller: FieldController): void {
  controllers.set(controller.id, controller);
  lastValue.set(controller.id, controller.read());
}

/** Remove a field's controller (e.g. its row was deleted from a repeating
 * list). Any existing undo/redo steps referencing this id become no-ops
 * (checked at apply time) rather than throwing — safer than trying to
 * reconstruct a removed row's DOM from an undo step. */
export function unregister(id: string): void {
  controllers.delete(id);
  lastValue.delete(id);
}

/** Call at the field-commit boundary (blur / debounce-settle). Pushes a step
 * only if the value actually changed since the last commit/undo/redo for
 * this id. Clears the redo stack (standard undo/redo semantics — PO
 * AC4/required). */
export function commit(id: string): void {
  if (applying) return;
  const controller = controllers.get(id);
  if (!controller) return;
  const from = lastValue.get(id) ?? '';
  const to = controller.read();
  if (from === to) return;
  undoStack.push({ id, from, to });
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  lastValue.set(id, to);
  redoStack = [];
  emitChanged();
}

/** For edits with no natural blur boundary (e.g. a `window.prompt()` URL
 * edit) — push the step directly with known from/to values. */
export function commitAtomic(id: string, from: string, to: string): void {
  if (applying) return;
  if (from === to) return;
  lastValue.set(id, to);
  undoStack.push({ id, from, to });
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  emitChanged();
}

export function undo(): void {
  const step = undoStack.pop();
  if (!step) return;
  const controller = controllers.get(step.id);
  if (controller) {
    applying = true;
    try {
      controller.apply(step.from);
    } finally {
      applying = false;
    }
    lastValue.set(step.id, step.from);
  }
  redoStack.push(step);
  emitChanged();
}

export function redo(): void {
  const step = redoStack.pop();
  if (!step) return;
  const controller = controllers.get(step.id);
  if (controller) {
    applying = true;
    try {
      controller.apply(step.to);
    } finally {
      applying = false;
    }
    lastValue.set(step.id, step.to);
  }
  undoStack.push(step);
  emitChanged();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** Convenience wiring for the common case: a text-ish DOM element (input,
 * textarea, select, or a contenteditable) whose value is read/written via
 * plain string get/set functions, committed on `blur` (or `change` for a
 * select — blur also fires on selects but change is the more natural
 * commit-boundary signal for a discrete-choice control). `onApply` is
 * called AFTER the DOM is written back, so it can mirror the existing
 * input-handler's working-state-update + autosave-schedule logic. */
export function wireField(opts: {
  id: string;
  el: HTMLElement;
  getValue: () => string;
  setValue: (value: string) => void;
  onApply: (value: string) => void;
  commitEvent?: 'blur' | 'change';
}): void {
  const { id, el, getValue, setValue, onApply } = opts;
  register({
    id,
    read: getValue,
    apply: (value) => {
      setValue(value);
      onApply(value);
    },
  });
  el.addEventListener(opts.commitEvent ?? 'blur', () => commit(id));
}
