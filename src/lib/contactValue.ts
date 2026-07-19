// Shared contact-value validity predicate (tech-lead-20260718T174921 Design
// B). Deliberately dependency-free and imports NOTHING server-only, so it is
// safe to import from BOTH server code (src/lib/schemas.ts, the trust
// boundary — KB-0017) and browser code (src/lib/editor/client.ts,
// src/components/edit/EditContact.astro's client script). Keeping the rule
// in exactly one place means the client's "don't transmit an in-progress
// value" gate and the server's hard-reject rule can never drift apart.
//
// Rule: an empty value is always persistable (per-item "Coming soon"
// state). A non-empty value must already be a plausible http(s) URL (link
// types) or a plain email shape (email type, no `:` — this is what closes
// the `javascript:` href-injection sink on /contact + Footer).
export function isPersistableContactValue(type: string, value: string): boolean {
  if (value === '') return true;
  if (type === 'email') return /^[^\s:]+@[^\s:]+$/.test(value);
  return /^https?:\/\//i.test(value);
}
