# Isaiah Ho — Personal Website

Personal site for Isaiah Ho (business student, Singapore Management University), live at https://isaiah-ho.vercel.app. A single-page homepage (hero, about, experience, projects, writing, contact), a blog with RSS, and a private inline content editor at `/edit`.

## Tech stack

- **[Astro](https://astro.build)** (static output, no client-side framework). Content lives in JSON data files and Markdown, read through Astro content collections (`src/content.config.ts`) and compiled to static HTML at build time.
- **Vercel** as the deploy target (via `@astrojs/vercel`). Pushing to `master` deploys production. See [`docs/DEVOPS-VERCEL-RUNBOOK.md`](./docs/DEVOPS-VERCEL-RUNBOOK.md).
- **Fonts:** the public site loads EB Garamond (display) and Literata (text) from Google Fonts. The editor loads the same fonts.
- **Inline editor** (`/edit`, GitHub OAuth, server-rendered): edits are saved to an `editor-draft` branch and published by merging into `master`. See [`docs/EDITOR-SETUP.md`](./docs/EDITOR-SETUP.md).

**If you're here to edit content rather than code, use the editor ([`docs/EDITOR-SETUP.md`](./docs/EDITOR-SETUP.md)), or see [`CONTENT-GUIDE.md`](./CONTENT-GUIDE.md) for editing the files directly.**

## Local dev quickstart

Requires Node.js 22.12 or newer.

```sh
npm install                  # one-time: install dependencies
npx astro dev --background   # start the dev server at http://localhost:4321 in the background
npx astro dev stop           # stop it (also: astro dev status, astro dev logs)
npm run build                # build the production site
npm run preview              # serve the build locally
```

There is no test suite and no linter configured. `npx astro check` type-checks the project.

## Routes

| Route | What it is |
|---|---|
| `/` | Single-page homepage with anchor sections `#about`, `#experience`, `#projects`, `#writing`, `#contact` |
| `/about`, `/experience`, `/projects`, `/contact` | 301 redirects to the matching homepage anchor (`astro.config.mjs`) |
| `/experience/<slug>`, `/projects/<slug>` | Detail page per entry |
| `/blog`, `/blog/<slug>`, `/rss.xml` | Blog listing, posts and feed |
| `/edit/**`, `/api/**` | Inline editor and its API (sign-in required; returns 404 otherwise) |

## Project structure

```
src/
├── pages/                     # Routes (see table above)
│   └── dev-repro/             # DEV-only editor harness (?view=), 404s in production
├── data/
│   ├── site.json              # Hero, about, contact, empty-state text, category order
│   ├── experience.json        # Experience entries
│   └── projects.json          # Project entries
├── content/blog/              # Blog posts as Markdown (created when the first post is added)
├── content.config.ts          # Collection schemas for all of the above
├── layouts/
│   ├── SiteLayout.astro       # Public site: <head>/SEO tags, header, footer
│   └── EditLayout.astro       # Editor (/edit): shell, footer, toolbar slot
├── components/
│   ├── site/                  # Public site sections (Hero, About, ExperienceLedger, ProjectGrid, WritingBand, Contact, …)
│   ├── edit/                  # Editor views, EditHeader, and the editable row/card twins
│   └── EditorHarness.astro    # Editor toolbar (save, undo/redo, preview, publish)
├── styles/
│   ├── tokens.css             # Design tokens (colours, fonts, widths) for the public site
│   ├── site.css               # Public site styles
│   └── editor.css             # Editor chrome; imports tokens + site
├── lib/                       # Shared helpers (date formatting, grouping, editor/GitHub/Vercel plumbing)
└── middleware.ts              # Editor session gate

astro.config.mjs               # Site URL, Vercel adapter, redirects
public/                        # Static files (favicon, about photo)
docs/                          # Editor setup and Vercel runbook
```

The public site's components take plain data as props, and the pages load the data. The editor renders in the same design and shares `site.css`'s class names, but it imports no public module (`site/` components, `SiteLayout`): the editable markup is written separately in `edit/`, and `editor.css` inlines `tokens.css` and `site.css`. This is by design, so editor work can't change the public build output.
