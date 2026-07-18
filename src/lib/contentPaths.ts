// Shared path constants for the git-backed content store. Imported by BOTH
// the reader (src/lib/draftContent.ts) and the writer
// (src/pages/api/content/[area].ts) so they can never drift onto different
// files — that drift was exactly the RC2 bug class (tech-lead-
// 20260717T090321 Decision 2, "reader and writer can never drift onto
// different files"). Do not duplicate these literals anywhere else.

export const SITE_JSON_PATH = 'src/data/site.json';
export const PROJECTS_JSON_PATH = 'src/data/projects.json';
export const EXPERIENCE_JSON_PATH = 'src/data/experience.json';
export const BLOG_DIR = 'src/content/blog/';

// Whitelist for about-profile-image public paths. This is the SOLE security
// control for the /api/draft/asset read proxy (tech-lead-20260718T025025,
// KB-0017) and is reused by src/lib/schemas.ts's write-path validation
// (aboutBodySchema.image / .baseImage) so both sides can never drift onto
// different patterns. Do not duplicate this literal anywhere else.
export const ABOUT_IMAGE_PUBLIC_PATH_RE = /^\/about\/profile-[a-f0-9]{16}\.(jpg|png|webp)$/;
