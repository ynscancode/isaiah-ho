// Pure grouping helper for the Experience page + its editor
// (tech-lead-20260720T160424Z Item 3, ratified). The category SET is
// entirely data-driven — grouping falls out of whatever distinct
// `category` strings exist on the entries passed in; nothing here
// enumerates a fixed list of categories. Adding a brand-new category to
// the data "just works" with zero changes to this file.
//
// The ONLY category-ish string literal in this file is `OTHER_LABEL`, a
// fallback LABEL for the null-group (entries with an empty/missing
// category) — not a category enumeration.
//
// Used by BOTH `src/pages/experience.astro` (public render) and
// `src/components/edit/EditCollection.astro` (experience-branch editor
// render, load-time only) — single source of the grouping rule, mirroring
// the `src/lib/eyebrow.ts` single-formatting-site pattern.

export const OTHER_LABEL = 'Other';

export type CategoryGroup<T> = {
  category: string;
  entries: T[];
};

/**
 * Groups `entries` by category, preserving:
 *  - category ORDER = first-appearance order (the order in which each
 *    distinct category's first entry appears in `entries`)
 *  - within-group order = original array order (no date or other sort)
 *
 * Entries whose category (per `getCategory`) is empty/whitespace-only are
 * collected into a single fallback group labeled `OTHER_LABEL`, always
 * rendered LAST regardless of where those entries appear in the input.
 *
 * `getCategory` is a plain accessor rather than a hardcoded `entry.category`
 * read so this one implementation can serve both call sites: the public
 * page's astro:content entries (category at `entry.data.category`) and the
 * editor's flat working entries (category at `entry.category`).
 */
export function groupByCategory<T>(
  entries: T[],
  getCategory: (entry: T) => string
): CategoryGroup<T>[] {
  const order: string[] = [];
  const byCategory = new Map<string, T[]>();
  const other: T[] = [];

  for (const entry of entries) {
    const category = (getCategory(entry) ?? '').trim();
    if (category === '') {
      other.push(entry);
      continue;
    }
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
      order.push(category);
    }
    byCategory.get(category)!.push(entry);
  }

  const groups: CategoryGroup<T>[] = order.map((category) => ({
    category,
    entries: byCategory.get(category) as T[],
  }));

  if (other.length > 0) {
    groups.push({ category: OTHER_LABEL, entries: other });
  }

  return groups;
}
