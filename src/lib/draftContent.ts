// The ONLY content source for /edit/** (tech-lead-20260717T090321 Decision
// 2a). Fixes RC2: the editor route previously read build-time
// astro:content snapshots of MASTER while writing to the draft branch, so a
// save could never be seen reflected back. Every loader here reads the
// draft branch first, falls back to master, and only falls back to the
// build-time astro:content snapshot if GitHub itself is unreachable — never
// silently resurrecting content the user deliberately deleted from the
// draft (see the blog-directory 404 handling below, Decision 2d).
//
// Path constants come from contentPaths.ts and blog frontmatter
// parsing comes from blogMarkdown.ts — both shared with the writer
// (src/pages/api/content/[area].ts) so reader and writer can never drift
// onto different files/formats, which was the RC2 bug class.
//
// ARCH-0005 invariant: this module is imported ONLY by
// src/pages/edit/[...path].astro (prerender=false, session-gated). No
// public page may import it.

import { getCollection, getEntry } from 'astro:content';
import {
  getFileOnBranch,
  listDirectoryOnBranch,
  GitHubApiError,
  type RepoRef,
} from './github';
import { getRepoRef, getDraftBranch, getWriteToken, MASTER_BRANCH } from './gitConfig';
import { SITE_JSON_PATH, PROJECTS_JSON_PATH, EXPERIENCE_JSON_PATH, BLOG_DIR } from './contentPaths';
import { parseBlogMarkdown, type BlogPostRaw } from './blogMarkdown';

export type { BlogPostRaw };
export type ContentSource = 'draft' | 'master' | 'build';
export type Loaded<T> = { data: T; source: ContentSource };

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

type Ctx = { token: string; ref: RepoRef; draftBranch: string };

function getCtx(): Ctx {
  return { token: getWriteToken(), ref: getRepoRef(), draftBranch: getDraftBranch() };
}

/** Read a single file draft-then-master (Decision 2b, steps 1-2). A miss
 * (404) at draft falls through to master; a miss at master means the file
 * genuinely doesn't exist on either branch (returns null content, source
 * 'master') — NOT an error. A `GitHubApiError`/network throw at either step
 * propagates to the caller, which is responsible for the build-time
 * fallback (step 3) per Decision 2b. */
async function readFileDraftThenMaster(
  ctx: Ctx,
  path: string
): Promise<{ contentBase64: string | null; source: 'draft' | 'master' }> {
  const draftFile = await getFileOnBranch(ctx.token, ctx.ref, path, ctx.draftBranch);
  if (draftFile) return { contentBase64: draftFile.contentBase64, source: 'draft' };

  const masterFile = await getFileOnBranch(ctx.token, ctx.ref, path, MASTER_BRANCH);
  if (masterFile) return { contentBase64: masterFile.contentBase64, source: 'master' };

  return { contentBase64: null, source: 'master' };
}

// ---- site.json (home / about / contact / emptyStates) ----

export async function loadSiteJson(): Promise<Loaded<Record<string, unknown> | null>> {
  try {
    const ctx = getCtx();
    const result = await readFileDraftThenMaster(ctx, SITE_JSON_PATH);
    if (result.contentBase64 === null) return { data: null, source: result.source };
    const data = JSON.parse(fromBase64(result.contentBase64)) as Record<string, unknown>;
    return { data, source: result.source };
  } catch (err) {
    console.error('loadSiteJson: GitHub read failed, falling back to build-time content', err);
    const entries = await getCollection('site');
    const data: Record<string, unknown> = {};
    for (const e of entries) data[e.id] = e.data;
    return { data, source: 'build' };
  }
}

// ---- projects.json / experience.json ----

export async function loadCollectionJson(area: 'projects' | 'experience'): Promise<Loaded<unknown[]>> {
  const path = area === 'projects' ? PROJECTS_JSON_PATH : EXPERIENCE_JSON_PATH;
  try {
    const ctx = getCtx();
    const result = await readFileDraftThenMaster(ctx, path);
    if (result.contentBase64 === null) return { data: [], source: result.source };
    const data = JSON.parse(fromBase64(result.contentBase64)) as unknown[];
    return { data, source: result.source };
  } catch (err) {
    console.error(`loadCollectionJson(${area}): GitHub read failed, falling back to build-time content`, err);
    const entries = await getCollection(area);
    return { data: entries.map((e) => e.data), source: 'build' };
  }
}

// ---- blog (per-file markdown on the draft/master branch) ----

function toBlogPostRaw(slug: string, raw: string): BlogPostRaw | null {
  const parsed = parseBlogMarkdown(raw);
  if (!parsed) return null;
  return { ...parsed, slug };
}

/** List + read every *.md file on one branch. Throws (propagates) on any
 * GitHub read failure OR on a structural frontmatter parse failure — both
 * are treated as "this branch's read failed", which the caller uses to
 * fall through to the next tier (master, then build). This deliberately
 * does NOT special-case an individual post's parse failure by silently
 * dropping it from the list: a post that won't parse must never be
 * invisible without explanation, so treating it the same as an
 * unreachable branch (fall through, and ultimately still visible via the
 * build-time snapshot) is the closest fit to Decision 2e's "surfaced as an
 * error, never a partial object" within this function's list-shaped return
 * type. */
async function listBlogPostsOnBranch(
  ctx: Ctx,
  branch: string
): Promise<{ posts: BlogPostRaw[] } | null> {
  const listing = await listDirectoryOnBranch(ctx.token, ctx.ref, BLOG_DIR, branch);
  if (listing === null) return null; // 404 on the directory = zero posts, not an error (Decision 2d).

  const mdEntries = listing.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  const posts = await Promise.all(
    mdEntries.map(async (entry) => {
      const file = await getFileOnBranch(ctx.token, ctx.ref, entry.path, branch);
      if (!file) throw new GitHubApiError(`Listed file vanished: ${entry.path}`, 404);
      const slug = entry.name.replace(/\.md$/, '');
      const post = toBlogPostRaw(slug, fromBase64(file.contentBase64));
      if (!post) throw new Error(`Blog post failed to parse: ${entry.path}`);
      return post;
    })
  );
  return { posts };
}

export async function loadBlogList(): Promise<Loaded<BlogPostRaw[]>> {
  const ctx = getCtx();

  // Draft attempt. A 404 on the directory listing means zero posts on the
  // draft — render an EMPTY list, never fall back to master (Decision 2d:
  // today's draft deliberately has zero blog posts; falling back would
  // resurrect posts the user deleted).
  try {
    const draftResult = await listBlogPostsOnBranch(ctx, ctx.draftBranch);
    if (draftResult === null) return { data: [], source: 'draft' };
    return { data: draftResult.posts, source: 'draft' };
  } catch (err) {
    console.error('loadBlogList: draft branch read failed, falling back to master', err);
  }

  // Master attempt — only reached because the draft listing itself threw
  // (GitHub error or a parse failure), never because of a clean 404.
  try {
    const masterResult = await listBlogPostsOnBranch(ctx, MASTER_BRANCH);
    if (masterResult === null) return { data: [], source: 'master' };
    return { data: masterResult.posts, source: 'master' };
  } catch (err) {
    console.error('loadBlogList: master branch read failed, falling back to build-time content', err);
  }

  // Build-time fallback (step 3).
  const entries = await getCollection('blog');
  const posts: BlogPostRaw[] = entries.map((e) => ({
    slug: e.id,
    title: e.data.title,
    description: e.data.description,
    date: e.data.date.toISOString().slice(0, 10),
    draft: e.data.draft,
    tags: e.data.tags,
    body: e.body ?? '',
  }));
  return { data: posts, source: 'build' };
}

export async function loadBlogPost(slug: string): Promise<Loaded<BlogPostRaw | null>> {
  const ctx = getCtx();
  const path = `${BLOG_DIR}${slug}.md`;

  try {
    const draftFile = await getFileOnBranch(ctx.token, ctx.ref, path, ctx.draftBranch);
    if (draftFile) {
      const post = toBlogPostRaw(slug, fromBase64(draftFile.contentBase64));
      // Parse failure surfaces as an error for this post (Decision 2e) —
      // never a partially-populated object. data: null lets the route
      // 404 rather than render a form full of empty/defaulted fields.
      return { data: post, source: 'draft' };
    }

    const masterFile = await getFileOnBranch(ctx.token, ctx.ref, path, MASTER_BRANCH);
    if (masterFile) {
      const post = toBlogPostRaw(slug, fromBase64(masterFile.contentBase64));
      return { data: post, source: 'master' };
    }

    return { data: null, source: 'master' };
  } catch (err) {
    console.error(`loadBlogPost(${slug}): GitHub read failed, falling back to build-time content`, err);
    const entry = await getEntry('blog', slug);
    if (!entry) return { data: null, source: 'build' };
    const post: BlogPostRaw = {
      slug: entry.id,
      title: entry.data.title,
      description: entry.data.description,
      date: entry.data.date.toISOString().slice(0, 10),
      draft: entry.data.draft,
      tags: entry.data.tags,
      body: entry.body ?? '',
    };
    return { data: post, source: 'build' };
  }
}
