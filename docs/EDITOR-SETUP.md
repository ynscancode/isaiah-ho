# Inline content editor — setup & usage

This document is for **Isaiah (the site owner)**. It covers one-time setup for the
inline content editor and how to use it day to day. It assumes no prior GitHub OAuth
App / API-token experience.

If you're looking for how to edit content *without* the editor (directly in
Markdown/JSON files), see [`CONTENT-GUIDE.md`](../CONTENT-GUIDE.md) instead — that
guide is now superseded for the fields the editor covers (see "What's editable"
below) but still applies to anything not yet exposed in the editor UI.

## 1. What the editor is

The inline editor lets you edit the site's content directly on the live-styled
pages — click a heading or paragraph and type, rather than filling out a separate
admin form. It's gated to a single GitHub account (yours) via GitHub OAuth; nobody
else can see or use it. Changes you make are saved to a dedicated git branch (a
"draft"), which gets its own Vercel preview deployment so you can check how a
change looks before it goes live. Nothing reaches the public site until you
explicitly click **Publish**, which merges the draft branch into `master` and
triggers the normal production deploy.

## 2. One-time setup (you need to do this yourself)

Do these once, in order. All values you produce here get set as environment
variables in step 2c.

### 2a. Register a GitHub OAuth App

1. Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** anything recognizable, e.g. `isaiah-ho-editor`.
   - **Homepage URL:** your production site origin, e.g. `https://isaiah-ho.vercel.app`.
   - **Authorization callback URL:** `{site origin}/api/auth/callback`. The editor
     validates the OAuth `state` against a single callback path baked into the code
     (`/api/auth/callback`), but GitHub OAuth Apps only accept **one fixed set of
     callback URLs** and Vercel preview deployments get a different origin per
     deployment — so you need one entry for production and, if you plan to log in
     on a preview deployment (e.g. the draft branch's own preview URL) rather than
     always logging in on production, an additional callback URL entry for that
     preview origin too:
     - `https://isaiah-ho.vercel.app/api/auth/callback` (production)
     - `https://<draft-branch-preview-domain>/api/auth/callback` (preview, if you
       need to log in there — see the operational note in §2c on how the preview
       domain is determined)
   - GitHub OAuth Apps support multiple callback URLs on the same app — add both as
     separate lines in the "Authorization callback URL" field.
3. Click **Register application**.
4. On the app's settings page: copy the **Client ID** shown at the top — this is
   `GITHUB_OAUTH_CLIENT_ID`.
5. Click **Generate a new client secret**, copy it immediately (GitHub only shows
   it once) — this is `GITHUB_OAUTH_CLIENT_SECRET`.
6. No scopes to configure on the app itself — the editor requests scope
   `read:user` at login time (just enough to read your GitHub username; it never
   reads your repos or private data through this token).

### 2b. Create a fine-grained GitHub Personal Access Token (repo-write access)

This is a **separate** credential from the OAuth App above. The OAuth App only
proves *who you are* (login gate); this token is what the editor's backend uses to
actually commit content changes to the repo on your behalf. Keep it scoped to the
absolute minimum — if it ever leaked, an attacker with a broadly-scoped token could
touch every repo you own, while a correctly-scoped one can only touch this one
repo's file contents.

1. Go to **https://github.com/settings/personal-access-tokens/new** (fine-grained
   tokens).
2. **Resource owner:** your account (`ynscancode`).
3. **Repository access:** "Only select repositories" → select **`ynscancode/isaiah-ho`** only.
4. **Permissions** → **Repository permissions** → **Contents:** set to **Read and write**.
   Leave every other permission at "No access."
5. Set an expiration (GitHub requires one for fine-grained tokens) and note it
   somewhere — you'll need to regenerate and re-set this env var before it expires,
   or draft saves/publishes will start failing with an auth error from GitHub.
6. Generate the token, copy it immediately — this is `GIT_WRITE_TOKEN`.

*(A GitHub App installation token is the longer-term, more precisely-scoped
upgrade path noted in the architecture, but is not required for this MVP — the
fine-grained PAT above is the supported path today.)*

### 2c. Set the environment variables

Two places need these values:
- **Local dev:** copy `.env.local.example` → `.env.local` (already gitignored) and
  fill in real values, for running the editor against `localhost:4321`.
- **Vercel (production + preview):** set the same variables as Vercel project
  environment variables so the deployed site (and the draft branch's preview
  deployment) can use them.

> **Operational note — Vercel provisioning is out of scope for this document.**
> The exact `vercel env add` commands, which Vercel **environment** (Production /
> Preview / Development) each variable belongs to, and how to read off the actual
> preview-deployment domain pattern for `VERCEL_PREVIEW_URL_TEMPLATE` (needed to
> complete the second OAuth callback URL in §2a) are the responsibility of the
> **Vercel provisioning runbook at [`DEVOPS-VERCEL-RUNBOOK.md`](./DEVOPS-VERCEL-RUNBOOK.md)**.
> That runbook is the source of truth for the CLI commands — follow it directly
> rather than re-deriving the commands from this table. This document only tells
> you *what* each variable means and *where its value comes from*; see
> `DEVOPS-VERCEL-RUNBOOK.md` for the *how-to-set-it-in-Vercel* step.

| Variable | Purpose | Value / how to get it | Where it's set |
|---|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | Identifies your OAuth App to GitHub during login | Copied in §2a step 4 | `.env.local` (dev) + Vercel (all environments) |
| `GITHUB_OAUTH_CLIENT_SECRET` | Proves the login request came from your app when exchanging the OAuth code | Generated in §2a step 5 | `.env.local` (dev) + Vercel (server-only — never exposed to the browser) |
| `ADMIN_GITHUB_USERNAME` | The only GitHub login allowed to get an editor session; compared constant-time against the OAuth-resolved user on every login attempt | `ynscancode` | `.env.local` + Vercel |
| `SESSION_SECRET` | HMAC-signs the session cookie, the OAuth `state` cookie, and the CSRF token. Rotating it instantly invalidates every existing session. | Generate a real high-entropy value, e.g. `openssl rand -base64 32`. Never reuse a value across environments. | `.env.local` (own local value) + Vercel (its own value, ideally different from local) |
| `PUBLIC_SITE_URL` | Canonical site origin (no trailing slash) — used to build the OAuth redirect URI and validate absolute URLs server-side | `http://localhost:4321` locally; your production origin (e.g. `https://isaiah-ho.vercel.app`) on Vercel Production | `.env.local` + Vercel |
| `GIT_WRITE_TOKEN` | The fine-grained PAT the backend uses to commit/read/delete content files via the GitHub API | Generated in §2b step 6 | `.env.local` (dev) + Vercel (server-only) |
| `GITHUB_REPO` | `owner/repo` — the single repo the git-write API is allowed to touch | `ynscancode/isaiah-ho` | `.env.local` + Vercel |
| `DRAFT_BRANCH` | The branch name the editor commits drafts to; Publish merges this into `master` | `editor-draft` (or whatever the devops runbook / repo actually uses — confirm it matches what's configured, since a mismatch means Save/Publish silently target the wrong branch) | `.env.local` + Vercel |
| `VERCEL_PREVIEW_URL_TEMPLATE` *(optional)* | Template for the draft branch's live preview link shown in the editor's **Preview** button, with a `{branch}` placeholder, e.g. `https://isaiah-ho-git-{branch}-<vercel-scope>.vercel.app` | Devops runbook is the source of truth for the exact pattern — it depends on the Vercel project/team scope. If unset, Preview falls back to a plain GitHub branch URL instead of a real Vercel preview link (still functional, just not a live rendered preview). | Vercel only (not needed locally, since local dev doesn't have preview deployments) |

### 2d. Never commit secrets

`.env.local` is already covered by `.gitignore` (`.env*` is ignored) — don't rename
it to something outside that pattern, and don't paste any of the values above into
a commit, a board note, or a screenshot. `.env.local.example` in the repo root only
ever holds placeholder values — if you ever edit that file, keep it that way.

## 3. Day-to-day usage

1. **Log in:** visit `/api/auth/login?redirect_to=/edit` on the site (e.g.
   `https://isaiah-ho.vercel.app/api/auth/login?redirect_to=/edit`). You'll be
   redirected to GitHub to authorize, then back to the site, landing directly on
   `/edit`. Log in with `ynscancode` — any other GitHub account is rejected (see
   Security notes). (`redirect_to` is optional — visiting plain `/api/auth/login`
   still logs you in, but drops you on the normal public homepage afterward
   instead of the editor; you'd then navigate to `/edit` yourself. Bookmarking the
   `redirect_to=/edit` version is the more convenient entry point.)
2. **The edit view:** once logged in, the site's editable pages mirror the public
   URL structure under `/edit`:
   - `/edit` — home hero
   - `/edit/about` — about page
   - `/edit/contact` — contact page
   - `/edit/projects` — projects list
   - `/edit/experience` — experience list
   - `/edit/blog` — blog post list
   - `/edit/blog/new` — create a new post
   - `/edit/blog/<slug>` — edit an existing post
3. **Edit:** click into a heading, paragraph, or field to edit it in place (most
   text fields are directly click-and-type on the live-styled page). Link fields
   (CTA hrefs, project/experience links, contact URLs) use a small "edit" button
   that prompts for the URL rather than being directly click-to-type. Blog post
   fields (title, description, date, tags, draft toggle, body) use a form-style
   editor rather than inline click-to-type, since a blog post's body is raw
   Markdown, not the rendered page text.
4. **What's editable (MVP scope):**
   - **Hero (home)** — eyebrow text, headline, lede paragraph, both CTA buttons'
     label and link.
   - **About** — the lede and body paragraphs, edited as one block (not
     individually add/remove-able in this MVP).
   - **Contact** — the lede, plus email/LinkedIn/GitHub. Each of the three can be
     set to a URL or cleared back to blank.
   - **Projects** — add, remove, and edit entries (eyebrow, title, body, optional
     link).
   - **Experience** — same as Projects (add, remove, edit).
   - **Blog** — full add/remove/edit: title, description, date, tags, draft
     toggle, and body.
   - Not editable here (by design — see the product-owner scope note on the team
     board): the positioning-matrix diagram on the hero, nav labels, site-wide
     title, design tokens/colors, and page layout/structure. These require a code
     change, not the editor.
5. **Save to draft:** click **Save to draft** in the bottom toolbar, or just wait —
   most fields autosave a couple of seconds after you stop typing. The toolbar's
   status text shows whether there are unsaved changes, a save in progress, or a
   save error.
6. **Preview:** click **Preview** to get a link to the draft branch's Vercel
   preview deployment — this is the actual site rendered with your unpublished
   changes, safe to check before anyone else sees them. If nothing has been saved
   to the draft yet, Preview will tell you to save a change first.
7. **Publish:** click **Publish**, confirm the prompt. This merges the draft
   branch into `master`, which triggers the normal production deploy — your
   changes go live once that deploy finishes (same timing as any other push to
   `master`). If the merge can't complete cleanly (a conflict), Publish reports
   that and nothing is merged — see Troubleshooting.
8. **Log out:** click **Log out** in the toolbar when you're done, especially on a
   shared or unattended machine.

**Two immutability rules to know:**
- **Blog post slugs are locked after the post's first save.** The slug (used in
  the post's URL) is generated from the title once, on creation; editing the
  title afterward does not change the URL. This is intentional — it protects
  existing links and the RSS feed.
- **Project/experience slugs are the same** — generated once on creation from the
  title, used for the `#slug` anchor links from the home/projects pages, and
  immutable afterward.

**Contact "Coming soon" behavior:** when email/LinkedIn/GitHub is empty, the
public contact page shows an italic "Coming soon" label instead of a link — never
a broken/empty link. Clearing a filled-in value back out returns it to that
"Coming soon" state; filling in a URL replaces "Coming soon" with a real link.

## 4. Security notes

- Only the GitHub account named in `ADMIN_GITHUB_USERNAME` (`ynscancode`) can ever
  get an editor session. Anyone else attempting to log in — or anyone hitting
  `/edit/*` without a session at all — sees the same generic "not found" response
  as a genuinely nonexistent page; there is no visible sign the editor exists.
- The two secrets that matter are `GITHUB_OAUTH_CLIENT_SECRET` and
  `GIT_WRITE_TOKEN`. If either is ever exposed (accidentally committed, pasted
  somewhere, or you suspect a leak):
  - **OAuth client secret:** go back to the OAuth App's settings page
    (github.com/settings/developers → your app) and generate a new client secret,
    then update the Vercel env var (and `.env.local` if applicable) and redeploy.
    The old secret stops working immediately once replaced.
  - **Git-write token:** go to
    https://github.com/settings/personal-access-tokens and delete/regenerate the
    fine-grained token, then update `GIT_WRITE_TOKEN` in Vercel and redeploy.
  - If you suspect `SESSION_SECRET` itself leaked, rotate it too — this instantly
    invalidates every active session (including your own; you'll need to log in
    again).
- Content saved through the editor is stored as plain JSON/Markdown data files,
  never as executable page markup — this is a deliberate defense so that even a
  malicious or malformed save can't turn into runnable code on the site.

## 5. Troubleshooting

- **Login redirects back with `?auth_error=1`:** this is a single generic error
  covering several possible causes on purpose (so a would-be attacker can't tell
  *why* a login failed) — most commonly it means you authorized with a GitHub
  account other than `ynscancode`. Log out of that GitHub account (or use a
  private browser window) and retry with the correct one. Other possible causes:
  the OAuth callback URL registered on the GitHub OAuth App doesn't match the
  origin you're logging in from (see §2a — production and preview origins each
  need their own registered callback URL), or `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET` don't match what's registered.
- **`/edit` (or any `/edit/*` page) 404s even though you're logged in:** the
  session cookie may have expired (sessions last about 8 hours) — log in again at
  `/api/auth/login`. If it persists, double-check `SESSION_SECRET` is set and
  identical between the app and however it was deployed (a value change
  invalidates all sessions).
- **Preview link doesn't reflect a recent save:** the draft branch's Vercel
  preview deployment has to finish its own build after each commit, same as any
  other deploy — give it a minute and refresh. If it's been longer than a normal
  build takes, check the Vercel dashboard for that branch's deployment status
  (devops runbook covers where to look).
- **Publish fails / reports a conflict (409):** this means the draft branch and
  `master` have diverged in a way that can't be auto-merged (for example, someone
  pushed directly to `master` outside the editor after the draft was created).
  The editor does not attempt to auto-resolve this — resolve it manually in git
  (rebase or recreate the draft branch from current `master`), or ask
  engineering/devops for help; nothing is published until the conflict is
  resolved.
- **A save fails or the toolbar shows an error status:** check that
  `GIT_WRITE_TOKEN` hasn't expired (fine-grained tokens require an explicit
  expiration — see §2b step 5) and that it still has Contents: Read & write on
  `ynscancode/isaiah-ho`.
