// Shared derive-at-render eyebrow text for projects/experience cards
// (product-owner-20260717T200000 Decision 2 / tech-lead-20260717T044343
// Decision D). The stored fields are `category` + `startDate`/`endDate`
// (yyyy-mm-dd or null) — the display string is computed here, never stored,
// so there is exactly one place this formatting logic lives.

export function deriveEyebrow(
  category: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate) return category;
  const startYear = startDate.slice(0, 4);
  if (!endDate) return `${category} · ${startYear}`;
  const endYear = endDate.slice(0, 4);
  if (endYear === startYear) return `${category} · ${startYear}`;
  return `${category} · ${startYear}–${endYear}`;
}
