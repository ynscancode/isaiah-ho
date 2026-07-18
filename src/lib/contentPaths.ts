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
