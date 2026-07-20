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
// fields, or an atomic action like a URL prompt) — NOT a keystroke. Undo/redo
// apply the value back through the field's own `apply()`, which is expected
// to write the DOM AND mark the owning autosaver's working state dirty AND
// call `flush()` (commit-on-blur redesign, tech-lead-20260720T041354 — an
// undo/redo has no following blur, so it must flush immediately rather than
// only markDirty()) — i.e. undo/redo are indistinguishable from a manual
// edit to the rest of the save pipeline (single-flight, stale_form 409
// handling, failure surfacing all unchanged).

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
  const controller = controllers.get(id);
  if (!controller) return;
  const from = lastValue.get(id) ?? '';
  const to = controller.read();
  if (from === to) return;
  undoStack.push({ id, from, to });
  lastValue.set(id, to);
  redoStack = [];
  emitChanged();
}

/** For edits with no natural blur boundary (e.g. a `window.prompt()` URL
 * edit) — push the step directly with known from/to values. */
export function commitAtomic(id: string, from: string, to: string): void {
  if (from === to) return;
  lastValue.set(id, to);
  undoStack.push({ id, from, to });
  redoStack = [];
  emitChanged();
}

export function undo(): void {
  const step = undoStack.pop();
  if (!step) return;
  const controller = controllers.get(step.id);
  if (controller) {
    controller.apply(step.from);
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
    controller.apply(step.to);
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
