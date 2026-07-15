// TODO(isaiah): these are placeholder projects grounded only in the mockup
// copy. Replace with your real projects (or remove entries entirely — the
// /projects page and home page both render a graceful empty state if this
// array is empty).
export type Project = {
  slug: string;
  eyebrow: string; // e.g. "CASE COMPETITION · 2025"
  title: string;
  body: string;
  href?: string; // optional external link (writeup, repo, deck)
};

export const projects: Project[] = [
  {
    slug: 'market-entry-fnb',
    eyebrow: 'Case competition · 2025',
    title: 'Market entry strategy for a regional F&B chain',
    body: 'Led a 4-person team through a market-sizing and go-to-market recommendation, placing top 3 of 40 teams.',
  },
  {
    slug: 'sme-digitalisation-grants',
    eyebrow: 'Research · 2024',
    title: 'SME digitalisation grants: uptake analysis',
    body: 'Independent research project analysing why SME uptake of government digitalisation grants lags projections.',
  },
];
