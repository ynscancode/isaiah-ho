import { z } from 'astro:content';

// Server-side validation for every git-write body (validate at the boundary —
// this IS the boundary: an authenticated-but-still-untrusted-payload write).

export const ctaSchema = z.object({
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(2048),
});

export const heroBodySchema = z.object({
  eyebrow: z.string().max(200),
  headlineHtml: z.string().max(500),
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
