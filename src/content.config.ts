import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().optional().default(false),
    tags: z.array(z.string()).optional().default([]),
  }),
});

const ctaSchema = z.object({
  label: z.string(),
  href: z.string(),
});

const contactLinkType = z.enum(['email', 'linkedin', 'github', 'other']);

const site = defineCollection({
  loader: file('src/data/site.json'),
  schema: z.object({
    // "home" entry
    hero: z
      .object({
        eyebrow: z.string(),
        headlineHtml: z.string(),
        lede: z.string(),
        primaryCta: ctaSchema,
        ghostCta: ctaSchema,
      })
      .optional(),
    // "about" entry
    // `lede` is ALSO used by the "contact" entry (kept there), so it stays
    // valid on the shared union schema even though it's no longer an about
    // field on its own — only `paragraphs` was fully removed.
    lede: z.string().optional(),
    body: z.string().optional(),
    image: z.string().nullable().optional(),
    // "contact" entry
    links: z
      .array(
        z.object({
          id: z.string(),
          type: contactLinkType,
          label: z.string(),
          value: z.string(),
        })
      )
      .optional(),
    // "emptyStates" entry
    projects: z.string().optional(),
    experience: z.string().optional(),
    blog: z.string().optional(),
    contact: z.string().optional(),
  }),
});

const projects = defineCollection({
  loader: file('src/data/projects.json'),
  schema: z.object({
    id: z.string(),
    slug: z.string(),
    category: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    title: z.string(),
    body: z.string(),
    href: z.string().optional(),
  }),
});

const experience = defineCollection({
  loader: file('src/data/experience.json'),
  schema: z.object({
    id: z.string(),
    slug: z.string(),
    category: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    title: z.string(),
    body: z.string(),
    href: z.string().optional(),
  }),
});

export const collections = { blog, site, projects, experience };
