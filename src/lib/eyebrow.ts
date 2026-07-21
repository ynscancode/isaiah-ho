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

function monthYear(isoDate: string): string {
  const year = isoDate.slice(0, 4);
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1];
  return `${month} ${year}`;
}

export function deriveEyebrow(
  category: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate) return category;
  const startMonthYear = monthYear(startDate);
  if (!endDate) return `${category} · ${startMonthYear}`;
  // Same-month-AND-same-year collapse — compare the full yyyy-mm prefix,
  // not just the year.
  if (endDate.slice(0, 7) === startDate.slice(0, 7)) return `${category} · ${startMonthYear}`;
  const endMonthYear = monthYear(endDate);
  return `${category} · ${startMonthYear} – ${endMonthYear}`;
}
