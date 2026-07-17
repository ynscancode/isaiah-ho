// Shared escape-then-structure plain-text render transform, extracted from
// src/pages/blog/[slug].astro (product-owner-20260717T170000 ISSUE B) so
// src/pages/about.astro can reuse the exact same XSS-critical transform
// without a second, potentially-diverging copy (tech-lead-20260717T044343,
// Decision C). Behavior is unchanged: escape HTML first (so <, >, &, ", '
// and any markdown-looking characters always render literally), THEN wrap
// blank-line-separated blocks as <p> and convert single newlines within a
// block to <br>. Any set:html sink must be built ONLY from bodyToHtml's
// output — the raw body must never be passed to set:html directly.

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;') // must run first — escaping others would double-escape their entities
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function bodyToHtml(rawBody: string): string {
  const escaped = escapeHtml(rawBody.trim());
  return escaped
    .split(/\n{2,}/) // blank-line-separated blocks -> paragraphs
    .map((block) => block.split('\n').join('<br>')) // single newlines -> line breaks within a paragraph
    .map((block) => `<p>${block}</p>`)
    .join('');
}
