import { z } from 'astro:content';

// Server-side validation for every git-write body (validate at the boundary —
// this IS the boundary: an authenticated-but-still-untrusted-payload write).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Server-side sanitizer for the ONE field rendered with `set:html`
 * (Hero.astro headline). The client's src/lib/editor/client.ts strip-regex
 * runs only in the browser and is trivially bypassed by calling the API
 * directly — and a strip-regex is itself bypassable (e.g. an unclosed
 * `<img src=x onerror=...`). This is the trust boundary, so enforce here by
 * *escaping* every character except the one permitted construct (`<br>`):
 * split on <br> variants, HTML-escape each segment, rejoin with a literal
 * `<br>`. Escaping (not stripping) means no tag can survive under any
 * malformed input. See TEAM-BOARD security-engineer review + backend XSS note. */
export function sanitizeHeadlineHtml(raw: string): string {
  return raw
    .split(/<br\s*\/?>/gi)
    .map(escapeHtml)
    .join('<br>');
}

export const ctaSchema = z.object({
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(2048),
});

export const heroBodySchema = z.object({
  eyebrow: z.string().max(200),
  // .max(500) caps the raw input first; the transform then guarantees the
  // committed value can only contain escaped text + literal <br> — the sole
  // set:html sink cannot receive attacker-controlled markup.
  headlineHtml: z.string().max(500).transform(sanitizeHeadlineHtml),
  lede: z.string().max(2000),
  primaryCta: ctaSchema,
  ghostCta: ctaSchema,
});

export const aboutBodySchema = z.object({
  lede: z.string().max(2000),
  paragraphs: z.array(z.string().max(5000)).max(50),
});

export const contactBodySchema = z.object({
  lede: z.string().max(2000),
  email: z.string().max(320).nullable(),
  linkedin: z.string().max(2048).nullable(),
  github: z.string().max(2048).nullable(),
});

const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens only');

export const projectEntrySchema = z.object({
  id: slugSchema,
  slug: slugSchema,
  eyebrow: z.string().max(200),
  title: z.string().max(300),
  body: z.string().max(5000),
  href: z.string().max(2048).optional(),
});

export const projectsBodySchema = z.array(projectEntrySchema).max(200);
export const experienceBodySchema = z.array(projectEntrySchema).max(200);

export const blogPostBodySchema = z.object({
  slug: slugSchema,
  // Present only when the client is saving an EDIT of an existing post (set
  // from the slug the /edit/blog/[slug] session was loaded for, never from
  // the mutable `slug`/title field). The API route enforces slug ===
  // originalSlug whenever this is present — see the trust-boundary note in
  // src/pages/api/content/[area].ts. Absent entirely on create.
  originalSlug: slugSchema.optional(),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(1000),
  date: z.string().min(1).max(40), // ISO date string
  draft: z.boolean().optional().default(false),
  tags: z.array(z.string().max(50)).max(30).optional().default([]),
  body: z.string().max(200_000), // markdown body
});

export type HeroBody = ReturnType<typeof heroBodySchema.parse>;
export type AboutBody = ReturnType<typeof aboutBodySchema.parse>;
export type ContactBody = ReturnType<typeof contactBodySchema.parse>;
export type ProjectsBody = ReturnType<typeof projectsBodySchema.parse>;
export type ExperienceBody = ReturnType<typeof experienceBodySchema.parse>;
export type BlogPostBody = ReturnType<typeof blogPostBodySchema.parse>;
