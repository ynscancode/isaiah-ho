# Content Guide (for Isaiah — no coding required)

This guide covers everything you need to edit on this site without touching any of the page layout or styling code. Everywhere below, "edit the file" means open it in a plain text editor (VS Code, Notepad, etc.), change the text, save it.

To see your changes before they go live, run `npm run dev` in a terminal from the project folder, then open `http://localhost:4321` in a browser. Leave it running while you edit — it reloads automatically on save.

---

## 1. Adding a new blog post

Blog posts live in `src/content/blog/` as `.md` (Markdown) files. Every `.md` file you put in that folder automatically becomes a page at `/blog/<filename>` and shows up on the `/blog` listing and in the RSS feed (`/rss.xml`) — you don't need to register it anywhere else.

**Required fields** (defined in `src/content.config.ts` — do not add fields that aren't listed here, they'll be ignored):

| Field | Required? | Type | Notes |
|---|---|---|---|
| `title` | yes | text | Shown as the page heading and in the blog list. |
| `description` | yes | text | One-liner shown on the blog list, used as the page's SEO description. |
| `date` | yes | date | Format `YYYY-MM-DD` (e.g. `2026-07-15`), no quotes needed. Controls sort order (newest first) and the date shown on the post. |
| `draft` | no | true/false | Defaults to `false`. Set to `true` to hide a post from `/blog`, the home page, and RSS while you're still writing it — the file can stay in the folder. |

There is **no `tags` field** in the current setup — don't add one, it won't do anything until the schema is extended.

### Template — copy this into a new file

Create a new file, e.g. `src/content/blog/my-new-post.md` (the filename becomes the URL, so use lowercase words separated by hyphens, no spaces), and paste:

```markdown
---
title: "Your post title here"
description: "One sentence summarizing the post, shown in the blog list."
date: 2026-07-15
---

Write your post body here using normal Markdown: paragraphs, and

## Headings like this

- bullet points
- more bullet points

> blockquotes for pull-quotes

and `inline code` or fenced code blocks if you ever need them.
```

To keep a post out of the public list while drafting, add `draft: true` as a fourth line in the frontmatter, then remove it (or set to `false`) when it's ready to publish.

Delete a post by deleting its `.md` file — it disappears from the blog list, home page, and RSS automatically.

---

## 2. Editing or adding projects

Projects live in a single file: `src/data/projects.ts`. It's a plain list — each project is one `{ ... }` entry.

**Fields** (from the `Project` type at the top of that file):

| Field | Required? | Notes |
|---|---|---|
| `slug` | yes | Short, unique, url-safe id (lowercase, hyphens). Used as an anchor link from the home page to the projects page. |
| `eyebrow` | yes | Small label above the title, e.g. `"Case competition · 2025"`. |
| `title` | yes | Project name/headline. |
| `body` | yes | One or two sentences describing it. |
| `href` | no | Optional external link (a write-up, deck, repo). Omit this field entirely if there's nothing to link to — the card just won't be clickable. |

### Template — copy this inside the `projects` array

```ts
  {
    slug: 'my-project-slug',
    eyebrow: 'Case competition · 2025',
    title: 'Project title here',
    body: 'One or two sentences describing what it was and the outcome.',
    href: 'https://link-to-writeup-or-deck.com', // optional — delete this line if there's no link
  },
```

Paste it as a new entry inside the square brackets `[ ... ]` in `src/data/projects.ts`, right after an existing `},`. Make sure each entry ends with a comma except optionally the last one.

If you remove all entries (empty array `[]`), both the projects page and home page gracefully show a "no projects yet" message instead of erroring — so it's safe to clear placeholders out while you're between real ones.

---

## 3. Editing the About page bio

File: `src/pages/about.astro`

The bio text is the plain paragraphs inside the `<div class="prose">` block, roughly lines 12–34. It's currently a placeholder — a comment right above it starting with `TODO(isaiah)` flags it and explains only verified facts (SMU, business student, targeting strategy/consulting) were used, with no invented achievements. Replace the `<p>...</p>` paragraphs with your real bio. Leave the surrounding `<Band>`, `<h1>`, and `<div class="prose">` wrapper tags in place — just change the text between the `<p>` and `</p>` tags.

---

## 4. Updating contact details / adding LinkedIn + GitHub

Contact info appears in **two places** — update both:

1. **`src/pages/contact.astro`** — the main contact page. Look for the `TODO(isaiah)` comments:
   - Email: already set to `isaiahho815@gmail.com`, with a comment asking you to confirm you're OK publishing it live.
   - LinkedIn / GitHub: currently show "Coming soon" placeholder text. To activate, replace the `<dd class="coming-soon">Coming soon</dd>` line with a real link, e.g.:
     ```html
     <dd><a href="https://linkedin.com/in/your-handle">linkedin.com/in/your-handle</a></dd>
     ```
     (Do the same for GitHub using its own `<dd>` block.)

2. **`src/components/Footer.astro`** — the footer shown on every page. It has the same "coming soon" placeholders for LinkedIn/GitHub with a matching `TODO(isaiah)` comment. Replace the `<span class="coming-soon">...</span>` elements with `<a href="...">...</a>` links once you have the URLs.

---

## 5. Pre-launch checklist — placeholders to replace

Everything below is intentionally left as a placeholder and marked with a `TODO(isaiah)` comment in the code. Search for `TODO(isaiah)` across the project to find all of them, or use this list:

- [ ] **Bio** — `src/pages/about.astro` (placeholder paragraphs, grounded in known facts only)
- [ ] **Projects** — `src/data/projects.ts` (2 placeholder entries: "Market entry strategy..." and "SME digitalisation grants...")
- [ ] **Blog posts** — `src/content/blog/` (2 placeholder posts: `case-interviews-teach-you.md`, `smu-x-as-client-engagement.md`) — replace or delete
- [ ] **Contact — email publish confirmation** — `src/pages/contact.astro` (confirm you're fine with `isaiahho815@gmail.com` being public)
- [ ] **Contact — LinkedIn/GitHub links** — `src/pages/contact.astro` and `src/components/Footer.astro` (both currently "Coming soon")
- [ ] **Site domain** — `astro.config.mjs`, the `site:` value is still `https://example.com`. Change it to your real domain once you have one (this affects RSS links and SEO canonical URLs).

---

## 6. Previewing and publishing

- **Preview locally:** run `npm run dev` from the project folder, open `http://localhost:4321`. Changes to Markdown/TypeScript/Astro files reload automatically.
- **Publishing:** once a git remote and Vercel project are connected (see the deployment setup notes — not covered in this guide), pushing your changes to the connected git remote will automatically trigger a new deployment on Vercel. You don't need to manually run `npm run build` to publish — that happens on Vercel's side during deploy. Running it locally is only useful to double-check the site builds without errors before you push.
