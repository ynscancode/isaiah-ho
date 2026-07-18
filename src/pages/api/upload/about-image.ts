import type { APIRoute } from 'astro';
import { getFileOnBranch, putFileOnBranch, ensureDraftBranchSynced } from '../../../lib/github';
import { getRepoRef, getDraftBranch, getWriteToken, COMMIT_AUTHOR, MASTER_BRANCH } from '../../../lib/gitConfig';

export const prerender = false;

// About-profile-image upload (tech-lead-20260717T044343 Decision A). Sits
// under /api/ so the existing session+CSRF middleware gates it identically
// to every other mutating route (KB-0017 — the server is the trust
// boundary, this widget's client-side picker is untrusted). Repo-commit to
// public/, never Vercel Blob (see board entry — Blob can't preview-before-
// publish). No new env var: reuses GIT_WRITE_TOKEN/GITHUB_REPO/DRAFT_BRANCH.

const MAX_DECODED_BYTES = 2 * 1024 * 1024; // 2 MB, tech-lead-fixed cap

type Sniffed = { ext: 'jpg' | 'png' | 'webp' } | null;

// Type is decided by magic-byte signature sniffing of the DECODED bytes,
// never the client-supplied filename or declared MIME type (security-
// critical — a client-controlled extension/MIME would let an attacker
// upload arbitrary bytes under an image-looking name).
function sniffImageType(bytes: Uint8Array): Sniffed {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp' };
  }
  return null;
}

function fromBase64Bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  if (
    typeof rawBody !== 'object' ||
    rawBody === null ||
    typeof (rawBody as { contentBase64?: unknown }).contentBase64 !== 'string'
  ) {
    return badRequest('missing_contentBase64');
  }
  const contentBase64 = (rawBody as { contentBase64: string }).contentBase64;

  // Reject an oversized base64 payload before doing any decode work — a
  // cheap length check (base64 is ~4/3 the decoded size) bounds the work
  // done on unauthenticated-shaped input even though this route is already
  // session-gated.
  if (contentBase64.length > Math.ceil((MAX_DECODED_BYTES * 4) / 3) + 8) {
    return badRequest('file_too_large');
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Bytes(contentBase64);
  } catch {
    return badRequest('invalid_base64');
  }

  if (bytes.length === 0) {
    return badRequest('empty_file');
  }
  if (bytes.length > MAX_DECODED_BYTES) {
    return badRequest('file_too_large');
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return badRequest('unsupported_image_type');
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hash = toHex(digest).slice(0, 16);
  const publicUrl = `/about/profile-${hash}.${sniffed.ext}`;
  const commitPath = `public${publicUrl}`;

  const token = getWriteToken();
  const ref = getRepoRef();
  const branch = getDraftBranch();

  try {
    // ensureBranch -> ensureDraftBranchSynced (tech-lead-20260717T090321
    // Decision 1, RC1 fix) — not one of the spec's explicitly enumerated
    // call sites, but it's a 4th caller of the deleted single-caller
    // function, so it must move too or the build breaks. Return value
    // (syncState) isn't surfaced here; a stale-preview warning belongs to
    // the content-editing surface, not the image upload endpoint.
    await ensureDraftBranchSynced(token, ref, branch, MASTER_BRANCH);

    // Content-hash naming makes every distinct image a unique path, so a
    // re-upload of identical bytes would otherwise hit a 422 sha-conflict on
    // PUT. Short-circuit: if the path already exists, identical hash implies
    // identical content, so skip the write and just return the URL.
    const existing = await getFileOnBranch(token, ref, commitPath, branch);
    if (!existing) {
      await putFileOnBranch(token, ref, {
        path: commitPath,
        branch,
        contentBase64,
        sha: null,
        message: `Upload about profile image: ${publicUrl}`,
        author: COMMIT_AUTHOR,
      });
    }

    return new Response(JSON.stringify({ path: publicUrl }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('about-image upload failed', err);
    return new Response(JSON.stringify({ error: 'upload_failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
