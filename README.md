# Isaiah Ho — Personal Website

Personal site for Isaiah Ho (business student, Singapore Management University) — home, about, projects, and a blog with RSS. Built as a scaffold to be filled in with real content over time.

## Tech stack

- **[Astro](https://astro.build)** (static output, no client-side framework) — content is plain Markdown + a TypeScript data file, compiled to static HTML at build time.
- **Vercel** as the deploy target (via `@astrojs/vercel`). See the devops setup notes for connecting the git remote and Vercel project — not covered here.
- Self-hosted fonts (`@fontsource/space-grotesk`, `@fontsource/source-serif-4`, `@fontsource/ibm-plex-mono`) — no external font requests.
- Astro's content collections (`src/content.config.ts`) power the blog.

**If you're here to edit content (bio, projects, blog posts, contact links) rather than code, skip straight to [`CONTENT-GUIDE.md`](./CONTENT-GUIDE.md) — it's written for a non-developer.**

## Local dev quickstart

Requires Node.js 22.12 or newer.

```sh
npm install       # one-time: install dependencies
npm run dev       # start local dev server at http://localhost:4321, live-reloads on save
npm run build     # build the production site to ./dist/
npm run preview   # serve the ./dist/ build locally, to sanity-check before deploying
```

There is no test suite and no linter configured.

## Project structure

```
src/
├── pages/
│   ├── index.astro          # Home — hero, positioning matrix, 2 latest projects, 2 latest posts
│   ├── about.astro           # About page — bio lives directly in this file
│   ├── projects.astro        # Projects page — renders src/data/projects.ts as a grid
│   ├── contact.astro         # Contact page — email + LinkedIn/GitHub placeholders
│   ├── rss.xml.ts            # RSS feed, auto-generated from the blog collection
│   └── blog/
│       ├── index.astro       # Blog listing, sorted newest-first
│       └── [slug].astro      # Individual post page (one route per file in src/content/blog/)
├── content/
│   └── blog/                 # Blog posts as Markdown files (see CONTENT-GUIDE.md)
├── content.config.ts         # Defines the blog collection's schema (required frontmatter fields)
├── data/
│   └── projects.ts           # Project entries as a typed TypeScript array (see CONTENT-GUIDE.md)
├── components/                # Reusable UI pieces: Nav, Band, Hero, PositioningMatrix, Card, Footer
├── layouts/
│   └── BaseLayout.astro       # Shared <head> (SEO/OG tags, fonts), skip-link, wraps every page
└── styles/
    └── global.css             # Design tokens (colors, spacing) used across components

astro.config.mjs               # Site config — includes the production domain (currently a placeholder)
public/                        # Static files served as-is (favicon, etc.)
```

For a full walkthrough of what to edit and how — adding blog posts, editing projects, the bio, and contact links — see **[CONTENT-GUIDE.md](./CONTENT-GUIDE.md)**.
