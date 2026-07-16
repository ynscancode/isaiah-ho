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
    lede: z.string().optional(),
    paragraphs: z.array(z.string()).optional(),
    // "contact" entry
    email: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
    github: z.string().nullable().optional(),
  }),
});

const projects = defineCollection({
  loader: file('src/data/projects.json'),
  schema: z.object({
    id: z.string(),
    slug: z.string(),
    eyebrow: z.string(),
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
    eyebrow: z.string(),
    title: z.string(),
    body: z.string(),
    href: z.string().optional(),
  }),
});

export const collections = { blog, site, projects, experience };
