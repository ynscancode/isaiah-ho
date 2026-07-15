// TODO(isaiah): these are placeholder experience entries, not real roles or
// organizations. Replace with your real work/leadership history (or remove
// entries entirely — the /experience page renders a graceful empty state if
// this array is empty).
export type Experience = {
  slug: string;
  eyebrow: string; // e.g. "Internship · 2025"
  title: string;
  body: string;
  href?: string; // optional external link (writeup, reference, org page)
};

export const experience: Experience[] = [
  {
    slug: 'placeholder-internship',
    eyebrow: 'Internship · 2025',
    // TODO(isaiah): replace with your real role/organization.
    title: 'Role Title @ Company Name',
    body: 'One or two sentences on scope and impact — replace with a real placement.',
  },
  {
    slug: 'placeholder-leadership',
    eyebrow: 'Leadership · 2024–2025',
    // TODO(isaiah): replace with your real role/organization.
    title: 'Position @ Organization',
    body: 'One or two sentences on responsibilities and outcomes — replace with a real role.',
  },
];
