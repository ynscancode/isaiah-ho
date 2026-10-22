// Page-wide emptyStates store (tech-lead-20261022T122044 D4).
//
// The server replaces `emptyStates` WHOLESALE on every POST (all five keys),
// so on the single continuous /edit page the five editable empty-state fields
// (Projects, Experience, Blog, Contact, Highlights) must share ONE working
// object and ONE autosaver. Independent per-view copies would each re-send
// their own stale snapshot of the other fields = lost writes.
//
// Browser-only; imported solely by src/components/edit/* scripts.

import { makeAutosaver, saveArea, type Autosaver } from './client';

export type EmptyStates = {
  projects: string;
  experience: string;
  blog: string;
  contact: string;
  highlights: string;
};

const KEYS: (keyof EmptyStates)[] = ['projects', 'experience', 'blog', 'contact', 'highlights'];

type Store = { working: EmptyStates; autosaver: Autosaver };

let store: Store | null | undefined;

/** Lazy module singleton. Returns null unless the page seeded all five keys
 * as strings — there are NO defaults, so a partial seed can never clobber
 * stored copy. Callers treat null as "field unwired / read-only". */
export function getEmptyStatesStore(): Store | null {
  if (store !== undefined) return store;
  const seed = (window as unknown as { __editorSeed?: { emptyStates?: Partial<Record<keyof EmptyStates, unknown>> | null } })
    .__editorSeed?.emptyStates;
  if (!seed || !KEYS.every((k) => typeof seed[k] === 'string')) {
    store = null;
    return store;
  }
  const working = { ...(seed as EmptyStates) };
  const autosaver = makeAutosaver({
    save: () => saveArea('emptyStates', working),
    snapshot: () => JSON.stringify(working),
  });
  // Save button: save only if something differs from what's persisted.
  window.addEventListener('editor:save-all', () => {
    void autosaver.flushIfDirty();
  });
  store = { working, autosaver };
  return store;
}
