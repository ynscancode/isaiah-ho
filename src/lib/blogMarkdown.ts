// Blog post frontmatter markdown format — writer (buildBlogMarkdown) and its
// inverse (parseBlogMarkdown) co-located deliberately (tech-lead-
// 20260717T090321 Decision 2e): "A writer and a parser of the same format
// living in different files WILL drift." Moved out of
// src/pages/api/content/[area].ts (previously the only place this format was
// defined) so src/lib/draftContent.ts can read the same per-post files the
// API route writes, without re-deriving the format.

export type BlogPostRaw = {
  slug: string;
  title: string;
  description: string;
  date: string;
  draft: boolean;
  tags: string[];
  body: string;
};

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildBlogMarkdown(body: {
  title: string;
  description: string;
  date: string;
  draft?: boolean;
  tags?: string[];
  body: string;
}): string {
  const lines = [
    '---',
    `title: ${yamlString(body.title)}`,
    `description: ${yamlString(body.description)}`,
    `date: ${yamlString(body.date)}`,
    `draft: ${body.draft ? 'true' : 'false'}`,
    `tags: [${(body.tags ?? []).map(yamlString).join(', ')}]`,
    '---',
    '',
    body.body,
  ];
  return lines.join('\n');
}

/** Inverse of buildBlogMarkdown. Returns `null` on ANY structural parse
 * failure — never a partially-populated object (tech-lead spec 2e: a post
 * that won't parse must surface as an error for that post, never as a form
 * full of empty/defaulted fields — that shape is exactly what fed RC3 a
 * stale `null`). `slug` is not stored in the frontmatter (it's the
 * filename) — returned as `''`; callers overwrite it from the path after a
 * successful parse. */
export function parseBlogMarkdown(raw: string): BlogPostRaw | null {
  if (!raw.startsWith('---\n')) return null;

  const closeIdx = raw.indexOf('\n---', 4);
  if (closeIdx === -1) return null;

  const frontmatterBlock = raw.slice(4, closeIdx);
  let bodyStart = closeIdx + 4; // skip "\n---"
  if (raw[bodyStart] !== '\n') return null; // delimiter line's own newline
  bodyStart += 1;
  if (raw[bodyStart] === '\n') bodyStart += 1; // optional blank separator line
  const body = raw.slice(bodyStart);

  const fields: Record<string, unknown> = {};
  for (const line of frontmatterBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed[0] === '#') continue; // skip full-line YAML comments (tech-lead-20260719T095958 Issue 1)
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return null;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    let value: unknown;
    try {
      // Our own writer JSON-encodes every scalar (yamlString ===
      // JSON.stringify) and emits arrays as valid JSON (`tags: ["a", "b"]`).
      value = JSON.parse(rawValue);
    } catch {
      // Fall back to a trimmed/unquoted raw string for hand-authored posts
      // that may carry bare YAML scalars.
      value = rawValue.replace(/^["']|["']$/g, '');
    }
    fields[key] = value;
  }

  const { title, description, date } = fields;
  if (typeof title !== 'string' || typeof description !== 'string' || typeof date !== 'string') {
    return null;
  }
  const draft = typeof fields.draft === 'boolean' ? fields.draft : fields.draft === 'true';
  const tags = Array.isArray(fields.tags)
    ? fields.tags.filter((t): t is string => typeof t === 'string')
    : [];

  return { slug: '', title, description, date, draft, tags, body };
}
