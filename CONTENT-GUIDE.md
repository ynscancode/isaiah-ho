# Content Guide (for Isaiah — no coding required)

**The easiest way to edit content is the inline editor:** sign in at `/edit` on the live site, click any text and type, then Publish. Setup and usage are in [`docs/EDITOR-SETUP.md`](./docs/EDITOR-SETUP.md).

This guide covers editing the same content **directly in the files**, for when the editor isn't an option or a field isn't exposed there. You only edit text in data files; the layout and styling never need touching.

To preview changes locally, run `npx astro dev --background` from the project folder and open `http://localhost:4321` (stop it with `npx astro dev stop`). It reloads automatically when you save. To publish, commit and push to `master`; Vercel deploys automatically.

> If you edit files by hand, don't have unpublished editor changes waiting on the `editor-draft` branch at the same time. Publish or discard those first so the two don't conflict.

---

## 1. Where everything lives

| Homepage section | File | What to edit |
|---|---|---|
| Hero headline and intro | `src/data/site.json` → `home.hero` | `headlineHtml` (plain text; `<br>` for a line break), `lede` |
| About | `src/data/site.json` → `about` | `body` (blank line between paragraphs), `image` (path under `public/`) |
| Experience | `src/data/experience.json` | One entry per role (see section 2) |
| Projects | `src/data/projects.json` | One entry per project (see section 2) |
| Writing | `src/content/blog/*.md` | One file per post (see section 3) |
| Contact | `src/data/site.json` → `contact` | `lede` (the big headline), `links` (email, LinkedIn) |
| Text shown when a section is empty | `src/data/site.json` → `emptyStates` | `experience`, `projects`, `blog` |
| Order of category groups | `src/data/site.json` → `ordering.categoryOrder` | Lists of category names, e.g. `["Work", "Leadership"]` |

The "Say hello" and LinkedIn buttons in the hero and contact section come from the email and LinkedIn entries in `contact.links`.

---

## 2. Experience and projects

`experience.json` and `projects.json` are lists of entries with the same fields:

| Field | Required? | Notes |
|---|---|---|
| `id` | yes | Unique id, never changes. Any short string. |
| `slug` | yes | URL-safe id (lowercase, hyphens). The detail page is `/experience/<slug>` or `/projects/<slug>`. |
| `category` | yes | Group name, e.g. `Work`, `Leadership`. Experience rows are grouped by it; projects get one filter chip per category. |
| `startDate` / `endDate` | yes (can be `null`) | `YYYY-MM-DD`. Shown as e.g. "Aug 2025 – Apr 2026". |
| `title` | yes | Role or project name. |
| `body` | yes | One-line summary. |
| `detail` | no | Bullet points, each starting with `• ` and separated by a blank line. Experience rows with no `detail` can't be expanded. |
| `href` | no | Optional external link for a project. |

### Template

```json
{
  "id": "my-unique-id",
  "slug": "my-project-slug",
  "category": "Work",
  "startDate": "2026-08-01",
  "endDate": null,
  "title": "Role or project title",
  "body": "One-line summary.",
  "detail": "• First bullet.\n\n• Second bullet."
}
```

Add it inside the `[ ... ]` list, with a comma between entries. If a list is empty (`[]`), the section shows its `emptyStates` text instead.

---

## 3. Blog posts (the Writing section)

Posts are Markdown files in `src/content/blog/` (create the folder for the first post). Each file becomes `/blog/<filename>`, appears in the Writing section and on `/blog`, and goes into the RSS feed. Use lowercase words with hyphens for the filename.

| Field | Required? | Notes |
|---|---|---|
| `title` | yes | Post heading. |
| `description` | yes | One-liner for listings and SEO. |
| `date` | yes | `YYYY-MM-DD`. Sorts newest first. |
| `draft` | no | `true` hides the post everywhere until you set it to `false`. |
| `tags` | no | e.g. `["strategy", "operations"]`. |

```markdown
---
title: "Your post title"
description: "One sentence summarizing the post."
date: 2026-10-20
---

Your post in normal Markdown.
```

Delete a post by deleting its file.
