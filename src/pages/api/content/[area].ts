import type { APIRoute } from 'astro';
import {
  getFileOnBranch,
  putFileOnBranch,
  deleteFileOnBranch,
  GitHubApiError,
} from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, COMMIT_AUTHOR } from '../../../lib/gitConfig';
import {
  homeBodySchema,
  aboutBodySchema,
  contactBodySchema,
  projectsBodySchema,
  experienceBodySchema,
  blogPostBodySchema,
  emptyStatesBodySchema,
} from '../../../lib/schemas';
import { SITE_JSON_PATH, PROJECTS_JSON_PATH, EXPERIENCE_JSON_PATH, BLOG_DIR } from '../../../lib/contentPaths';
import { buildBlogMarkdown } from '../../../lib/blogMarkdown';

export const prerender = false;

// Whitelist-map area -> target file path. Every path is a literal constant
// (never derived from caller input) EXCEPT the blog per-post filename, which
// is derived from a slug that's regex-validated (schemas.ts `slugSchema`) to
// forbid path separators/traversal, then re-checked below before use.

type Area = 'home' | 'about' | 'contact' | 'projects' | 'experience' | 'blog' | 'emptyStates';
const VALID_AREAS: readonly Area[] = [
  'home',
  'about',
  'contact',
  'projects',
  'experience',
  'blog',
  'emptyStates',
];

function isValidArea(value: string): value is Area {
  return (VALID_AREAS as readonly string[]).includes(value);
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

// Web-standard base64 (not base64url) round-trip, UTF-8 safe — avoids a
// Node-only `Buffer` dependency so this route works on either the Node or
// Edge Vercel runtime.
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const POST: APIRoute = async ({ params, request }) => {
  const areaParam = params.area ?? '';
  if (!isValidArea(areaParam)) {
    return badRequest('unknown_area');
  }
  const area = areaParam;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const token = getWriteToken();
  const ref = getRepoRef();
  const branch = getDraftBranch();
  // tech-lead-20260718T041814 D1: no per-save merge here. The client's
  // once-per-page-load ensureDraft() (src/lib/editor/client.ts, guarded by
  // draftEnsured) already guarantees the draft branch exists (create-from-
  // master if missing) and is master-synced before the first save of the
  // session. Do not reintroduce a per-save ensure/merge or head-sha compare
  // — see src/pages/api/draft/ensure.ts for the sole remaining call site.

  try {
    if (area === 'home' || area === 'about' || area === 'contact' || area === 'emptyStates') {
      const existing = await getFileOnBranch(token, ref, SITE_JSON_PATH, branch);
      if (!existing) {
        return new Response(JSON.stringify({ error: 'site_json_missing' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const siteData = JSON.parse(fromBase64(existing.contentBase64)) as Record<string, unknown>;

      if (area === 'home') {
        const parsed = homeBodySchema.safeParse(rawBody);
        if (!parsed.success) return badRequest('validation_failed');
        // Split so a hero-field save and a highlights save (both post the
        // same flat `working` body from EditHome) never clobber each other
        // (tech-lead-20260720T113459Z 1d).
        const { highlights, ...hero } = parsed.data;
        siteData.home = { hero, highlights };
      } else if (area === 'about') {
        const parsed = aboutBodySchema.safeParse(rawBody);
        if (!parsed.success) return badRequest('validation_failed');
        const draftImage = (siteData.about && typeof siteData.about === 'object')
          ? ((siteData.about as { image?: unknown }).image ?? null) : null;
        if (parsed.data.baseImage !== draftImage) {
          return new Response(JSON.stringify({ error: 'stale_form', action: 'reload' }),
            { status: 409, headers: { 'content-type': 'application/json' } });
        }
        const { baseImage: _drop, ...aboutData } = parsed.data;
        siteData.about = aboutData;
      } else if (area === 'contact') {
        const parsed = contactBodySchema.safeParse(rawBody);
        if (!parsed.success) return badRequest('validation_failed');
        siteData.contact = parsed.data;
      } else {
        const parsed = emptyStatesBodySchema.safeParse(rawBody);
        if (!parsed.success) return badRequest('validation_failed');
        siteData.emptyStates = parsed.data;
      }

      const newContent = JSON.stringify(siteData, null, 2) + '\n';
      const { commitSha } = await putFileOnBranch(token, ref, {
        path: SITE_JSON_PATH,
        branch,
        contentBase64: toBase64(newContent),
        sha: existing.sha,
        message: `Update ${area} content`,
        author: COMMIT_AUTHOR,
      });

      // Orphan-image disposal removed (RC3 fix, tech-lead-20260717T090321
      // Decision 3a): deleting the old image reclaimed NOTHING (git keeps
      // the blob regardless — that's how the destroyed photo was
      // recovered), so it only ever risked destroying irreplaceable user
      // content for cosmetic tidiness. Do not reinstate.

      return new Response(JSON.stringify({ commitSha }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (area === 'projects' || area === 'experience') {
      const schema = area === 'projects' ? projectsBodySchema : experienceBodySchema;
      const parsed = schema.safeParse(rawBody);
      if (!parsed.success) return badRequest('validation_failed');

      const path = area === 'projects' ? PROJECTS_JSON_PATH : EXPERIENCE_JSON_PATH;
      const existing = await getFileOnBranch(token, ref, path, branch);
      const newContent = JSON.stringify(parsed.data, null, 2) + '\n';
      const { commitSha } = await putFileOnBranch(token, ref, {
        path,
        branch,
        contentBase64: toBase64(newContent),
        sha: existing?.sha ?? null,
        message: `Update ${area} content`,
        author: COMMIT_AUTHOR,
      });
      return new Response(JSON.stringify({ commitSha }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // area === 'blog'
    const parsed = blogPostBodySchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('validation_failed');

    // Trust-boundary invariant: blog slugs are immutable once a post exists
    // (PO acceptance criterion 5). The shipped client enforces this by
    // locking the field in the UI, but that's client-side only and is
    // bypassable with a direct POST — same class of gap as the headlineHtml
    // XSS (security-engineer B1): the real enforcement has to live here.
    // `originalSlug` is only ever sent for an edit of an existing post (see
    // schemas.ts). If it's present, the request MUST target the same slug
    // it was addressed for, and that post must actually exist — otherwise a
    // changed slug would silently write a new file and leave the old one
    // behind as an orphan (KB-0014) instead of erroring. A create (no
    // `originalSlug`) is also refused if a post already exists at that slug,
    // so a "create" call can never silently overwrite an unrelated post.
    if (parsed.data.originalSlug !== undefined && parsed.data.originalSlug !== parsed.data.slug) {
      return badRequest('slug_immutable');
    }

    const path = `${BLOG_DIR}${parsed.data.slug}.md`;
    // Defense in depth beyond the slug regex: refuse anything that would
    // resolve outside the blog directory.
    if (!path.startsWith(BLOG_DIR) || path.includes('..')) {
      return badRequest('invalid_slug');
    }

    const existing = await getFileOnBranch(token, ref, path, branch);
    if (parsed.data.originalSlug !== undefined && !existing) {
      // Client claimed this was an edit of an existing post, but no file is
      // there to edit — reject rather than silently falling back to create.
      return badRequest('not_found');
    }
    if (parsed.data.originalSlug === undefined && existing) {
      // Client claimed this was a new post, but a file already exists at
      // that slug — reject rather than silently overwriting it.
      return badRequest('slug_conflict');
    }

    const markdown = buildBlogMarkdown(parsed.data);
    const { commitSha } = await putFileOnBranch(token, ref, {
      path,
      branch,
      contentBase64: toBase64(markdown),
      sha: existing?.sha ?? null,
      message: `Update blog post: ${parsed.data.slug}`,
      author: COMMIT_AUTHOR,
    });
    return new Response(JSON.stringify({ commitSha }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(`content/${area} write failed`, err);
    // tech-lead-20260718T174921 Design A3: see draft/ensure.ts.
    if (err instanceof GitHubApiError && err.retryable) {
      return new Response(JSON.stringify({ error: 'github_unavailable', action: 'retry' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'write_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};

// Blog is the only area with per-entry files, so it's the only area that
// needs an explicit delete (projects/experience remove-an-entry is just a
// POST with that entry omitted from the whole-array body).
export const DELETE: APIRoute = async ({ params, request }) => {
  const areaParam = params.area ?? '';
  if (areaParam !== 'blog') {
    return badRequest('unsupported_area_for_delete');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const slugResult = blogPostBodySchema.pick({ slug: true }).safeParse(rawBody);
  if (!slugResult.success) return badRequest('validation_failed');

  const token = getWriteToken();
  const ref = getRepoRef();
  const branch = getDraftBranch();
  // tech-lead-20260718T041814 D1: see POST above — no per-save merge; the
  // once-per-load client ensureDraft() already guarantees branch existence.

  const path = `${BLOG_DIR}${slugResult.data.slug}.md`;
  if (!path.startsWith(BLOG_DIR) || path.includes('..')) {
    return badRequest('invalid_slug');
  }

  try {
    const existing = await getFileOnBranch(token, ref, path, branch);
    if (!existing) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    await deleteFileOnBranch(token, ref, {
      path,
      branch,
      sha: existing.sha,
      message: `Delete blog post: ${slugResult.data.slug}`,
      author: COMMIT_AUTHOR,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('content/blog delete failed', err);
    // tech-lead-20260718T174921 Design A3: see draft/ensure.ts.
    if (err instanceof GitHubApiError && err.retryable) {
      return new Response(JSON.stringify({ error: 'github_unavailable', action: 'retry' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'delete_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
