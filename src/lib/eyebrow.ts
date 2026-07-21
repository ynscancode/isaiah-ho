// Shared derive-at-render eyebrow text for projects/experience cards
// (product-owner-20260717T200000 Decision 2 / tech-lead-20260717T044343
// Decision D). The stored fields are `category` + `startDate`/`endDate`
// (yyyy-mm-dd or null) — the display string is computed here, never stored,
// so there is exactly one place this formatting logic lives.
//
// Format: `MMM yyyy` (Title Case, e.g. "Jun 2024") — ui-ux-designer
// decision 20260722T040000Z. Derived via pure ISO string-slice into a
// static month-name lookup, never `new Date(isoString)` (KB-0003:
// `new Date("2025-06-01")` parses as UTC midnight and renders the prior
// day/month in a negative-offset TZ).

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Returns "MMM yyyy" when the full month can be parsed, falls back to the
// bare year (pre-fix behavior) when only a valid leading 4-digit year is
// present, or null when there's no usable date at all. Never returns a
// string containing "undefined" (qa-engineer-20260721T213235).
function monthYear(isoDate: string): string | null {
  const monthMatch = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (monthMatch) {
    const monthIndex = Number(monthMatch[2]) - 1;
    const month = MONTHS[monthIndex];
    if (month) return `${month} ${monthMatch[1]}`;
  }
  const yearMatch = /^\d{4}/.exec(isoDate);
  if (yearMatch) return yearMatch[0];
  return null;
}

export function deriveEyebrow(
  category: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate) return category;
  const startMonthYear = monthYear(startDate);
  // No usable start date (e.g. garbage input) — behave like no startDate.
  if (!startMonthYear) return category;
  if (!endDate) return `${category} · ${startMonthYear}`;
  const endMonthYear = monthYear(endDate);
  // No usable end date — degrade to the start-only branch rather than
  // rendering a dangling " – " separator.
  if (!endMonthYear) return `${category} · ${startMonthYear}`;
  // Same-month (or, when one side fell back to year-only, same-year)
  // collapse — compare the rendered values rather than raw prefixes so a
  // year-only fallback still collapses correctly instead of showing
  // "2024 – 2024".
  if (endMonthYear === startMonthYear) return `${category} · ${startMonthYear}`;
  return `${category} · ${startMonthYear} – ${endMonthYear}`;
}
