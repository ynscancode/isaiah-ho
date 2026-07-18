import { z } from 'astro:content';
import { ABOUT_IMAGE_PUBLIC_PATH_RE } from './contentPaths';

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
  body: z.string().max(20_000),
  image: z
    .string()
    .regex(ABOUT_IMAGE_PUBLIC_PATH_RE)
    .nullable(),
  // The image path the client's form was loaded with (RC3 3b, tech-lead-
  // 20260717T090321). Compared server-side against the freshly-read draft
  // value before write — never trusted on its own (KB-0017) — so a save
  // based on a stale page can never silently clobber an image change made
  // since the form was loaded. Stripped before persisting to site.json.
  baseImage: z
    .string()
    .regex(ABOUT_IMAGE_PUBLIC_PATH_RE)
    .nullable(),
});

// Contact link model (product-owner-20260717T200000 Decision 1, tech-lead-
// 20260717T044343 Decision B). `value` empty is allowed (per-item "Coming
// soon" state); a non-empty value is restricted to https?:// (link types) or
// a mailto-safe email shape (email type) — this is the load-bearing check
// that closes the `javascript:` href-injection sink on /contact + Footer
// (KB-0017: client-side validation is not a control, this server check is).
export const contactLinkType = z.enum(['email', 'linkedin', 'github', 'other']);

export const contactLinkSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, 'id must be alphanumeric with hyphens/underscores only'),
    type: contactLinkType,
    label: z.string().max(80),
    value: z.string().max(2048),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'other' && data.label.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['label'],
        message: 'label is required when type is "other"',
      });
    }
    if (data.value.length > 0) {
      const isValid =
        data.type === 'email'
          ? /^[^\s:]+@[^\s:]+$/.test(data.value)
          : /^https?:\/\//i.test(data.value);
      if (!isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message:
            data.type === 'email'
              ? 'value must be a plain email address'
              : 'value must be an http(s) URL',
        });
      }
    }
  });

export const contactBodySchema = z.object({
  lede: z.string().max(2000),
  links: z.array(contactLinkSchema).max(50),
});

const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens only');

// yyyy-mm-dd, empty string normalized to null so a new entry (empty date
// picker) can save without a date (product-owner Decision 4 / tech-lead
// Decision D — startDate is intentionally nullable, not required).
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z
  .union([dateStr, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const projectEntrySchema = z.object({
  id: slugSchema,
  slug: slugSchema,
  category: z.string().max(200),
  startDate: optDate,
  endDate: optDate,
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

// Per-collection editable empty-state copy (product-owner Decision 3 /
// tech-lead Decision D), stored as a 4th site-collection entry (id
// `emptyStates`) in site.json.
export const emptyStatesBodySchema = z.object({
  projects: z.string().max(500),
  experience: z.string().max(500),
  blog: z.string().max(500),
  contact: z.string().max(500),
});

export type HeroBody = ReturnType<typeof heroBodySchema.parse>;
export type AboutBody = ReturnType<typeof aboutBodySchema.parse>;
export type ContactBody = ReturnType<typeof contactBodySchema.parse>;
export type ProjectsBody = ReturnType<typeof projectsBodySchema.parse>;
export type ExperienceBody = ReturnType<typeof experienceBodySchema.parse>;
export type BlogPostBody = ReturnType<typeof blogPostBodySchema.parse>;
export type EmptyStatesBody = ReturnType<typeof emptyStatesBodySchema.parse>;
