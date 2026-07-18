import type { APIRoute } from 'astro';
import { getFileOnBranch, getBlobBase64BySha } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, MASTER_BRANCH } from '../../../lib/gitConfig';
import { ABOUT_IMAGE_PUBLIC_PATH_RE } from '../../../lib/contentPaths';

export const prerender = false;

// Authenticated draft-asset read proxy (tech-lead-20260718T025025, Finding 1
// of engineering-director-20260718T024800). Fixes the broken editor photo
// thumbnail: the editor page is served from production/master, but a
// just-uploaded image lives only on editor-draft until Publish. This route
// serves the image BYTES from draft-then-master so the thumbnail always
// resolves regardless of which origin the editor page itself was served
// from. Read-only — no put/merge/ensureDraftBranchSynced/force (KB-0019).
//
// Sits under /api/ so src/middleware.ts's session gate already covers it
// (unauth => generic 404, editor existence hidden). GET only => middleware
// requires CSRF only on non-GET, so none is needed here.

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const GET: APIRoute = async ({ request }) => {
  const publicPath = new URL(request.url).searchParams.get('path') ?? '';

  // VALIDATE FIRST — this regex is the entire security of the endpoint
  // (KB-0017). Anchored ^...$, only variable segment is [a-f0-9]{16}, fixed
  // extension alternation: no traversal, no extra segments, nothing but
  // /about/profile-<hash>.{jpg,png,webp} can pass. Never map or use the path
  // before this check.
  if (!ABOUT_IMAGE_PUBLIC_PATH_RE.test(publicPath)) {
    return notFound();
  }

  // MAP only after validation — identical to the upload endpoint's commitPath.
  const repoPath = 'public' + publicPath;
  const ext = publicPath.slice(publicPath.lastIndexOf('.') + 1);
  const mime = CONTENT_TYPE_BY_EXT[ext];
  if (!mime) {
    // Unreachable given the regex's fixed alternation, but fail closed.
    return notFound();
  }

  const token = getWriteToken();
  const ref = getRepoRef();
  const draftBranch = getDraftBranch();

  try {
    let file = await getFileOnBranch(token, ref, repoPath, draftBranch);
    if (!file) {
      file = await getFileOnBranch(token, ref, repoPath, MASTER_BRANCH);
    }
    if (!file) {
      return notFound();
    }

    // Contents API only inlines base64 for blobs <=1MB; for a 1-2MB image
    // (within the upload cap, about-image.ts) it returns content:""/
    // encoding:"none" instead of a throw. Fall back to the Git Blobs API,
    // which inlines base64 up to 100MB. `file.sha` is server-derived from
    // the already-path-validated `getFileOnBranch` read above — never
    // caller-controlled — so this fetches only the same already-identified
    // blob by its content-addressed sha (security-engineer LOW-1).
    let contentBase64 = file.contentBase64;
    if (!contentBase64 || contentBase64.trim() === '') {
      contentBase64 = (await getBlobBase64BySha(token, ref, file.sha)) ?? '';
    }
    if (!contentBase64 || contentBase64.trim() === '') {
      return notFound();
    }

    const bytes = base64ToBytes(contentBase64);
    // Cast: runtime accepts a Uint8Array body fine; the mismatch is a
    // TS-lib generic quirk (Uint8Array<ArrayBufferLike> vs the DOM lib's
    // narrower ArrayBufferView<ArrayBuffer>), not an actual type hazard.
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'content-type': mime,
        // `private` is mandatory — the bytes are session-gated; a
        // public/CDN-cacheable directive would let Vercel's edge serve
        // authenticated bytes keyed by URL alone, bypassing the session
        // gate. Do not change this value.
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('draft/asset read failed', err);
    return new Response(JSON.stringify({ error: 'asset_read_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
