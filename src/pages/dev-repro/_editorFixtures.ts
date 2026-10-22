// Fixtures for the DEV-only editor harness (src/pages/dev-repro/editor.astro).
// The `_` prefix keeps this file from being treated as a route. Plain data
// only; the harness page picks one `view` and renders the REAL Edit*
// component with these props, so it looks and behaves exactly like /edit.
import type { CollectionEntry } from '../../components/edit/EditCollection.astro';
import type { ContactLink } from '../../components/edit/EditContact.astro';

export const emptyStates = {
  projects: 'Projects are on their way.',
  experience: 'Experience is on its way.',
  blog: 'No posts yet.',
  contact: 'Contact links are coming soon.',
  highlights: 'Highlights are coming soon.',
};

export const hero = {
  eyebrow: 'Singapore · Fixture eyebrow',
  headlineHtml: 'Structured thinking,<br>applied to real problems.',
  lede: 'A fixture lede, one or two sentences introducing the person behind the site.',
  primaryCta: { label: 'Fixture primary', href: 'https://example.com/primary' },
  ghostCta: { label: 'Fixture ghost', href: 'https://example.com/ghost' },
  graphic: 'radar' as const,
};

export const projectsPool = [
  { slug: 'alpha-project', title: 'Alpha project', category: 'Research', startDate: '2024-01-10', endDate: null },
  { slug: 'beta-project', title: 'Beta <b>&</b> project', category: 'Product', startDate: '2023-05-01', endDate: '2023-09-30' },
  { slug: 'gamma-project', title: 'Gamma project', category: 'Research', startDate: null, endDate: null },
];
export const blogPool = [
  { id: 'hello-world', title: 'Hello world', date: '2025-02-01' },
  { id: 'second-post', title: 'A second post', date: '2025-03-15' },
];
export const highlights = [
  { type: 'project' as const, ref: 'alpha-project' },
  { type: 'blog' as const, ref: 'hello-world' },
  { type: 'project' as const, ref: 'deleted-project' },
];

export const contactLinks: ContactLink[] = [
  { id: 'c-email', type: 'email', label: 'Email', value: 'hello@example.com' },
  { id: 'c-linkedin', type: 'linkedin', label: 'LinkedIn', value: 'https://www.linkedin.com/in/example' },
  { id: 'c-github', type: 'github', label: 'GitHub', value: 'https://github.com/example' },
  { id: 'c-other', type: 'other', label: 'Calendly', value: 'calendly.com/incomplete' },
];

export const projectEntries: CollectionEntry[] = [
  { id: 'p1', slug: 'p1', category: 'Research', startDate: '2024-01-10', endDate: '2024-06-30', title: 'Research project one', body: 'A short description of scope and impact.', detail: 'Longer text for the detail page.' },
  { id: 'p2', slug: 'p2', category: 'Research', startDate: '2023-09-01', endDate: null, title: 'Research project two', body: 'Line one\nLine two', href: 'https://example.com/p2' },
  { id: 'p3', slug: 'p3', category: 'Product', startDate: '2023-02-01', endDate: '2023-08-31', title: 'Product project', body: 'Shipped a thing.' },
  { id: 'p4', slug: 'p4', category: 'Open source', startDate: null, endDate: null, title: 'Open source project', body: 'Contributed upstream.' },
  { id: 'p5', slug: 'p5', category: '', startDate: null, endDate: null, title: 'Uncategorised project', body: 'Lands in the pinned Other group.' },
];
export const projectCategoryOrder = ['Product', 'Research', 'Open source'];

export const experienceEntries: CollectionEntry[] = [
  { id: 'e1', slug: 'e1', category: 'Work', startDate: '2024-06-03', endDate: '2025-03-20', title: 'Analyst, Example Corp', body: 'Line one\nLine two', detail: '• a\n\n• b' },
  { id: 'e2', slug: 'e2', category: 'Work', startDate: '2023-06-01', endDate: '2023-08-31', title: 'Intern, Sample Ltd', body: 'Summer internship, no detail bullets.' },
  { id: 'e3', slug: 'e3', category: 'Leadership', startDate: '2022-08-01', endDate: null, title: 'President, Debate Society', body: 'Led a team of twenty.', detail: 'Ran weekly sessions\nOrganised the annual tournament', href: 'https://example.com/debate' },
  { id: 'e4', slug: 'e4', category: 'Education', startDate: '2021-08-01', endDate: '2025-05-31', title: 'BSc, Example University', body: 'Majored in something.' },
  { id: 'e5', slug: 'e5', category: '', startDate: null, endDate: null, title: 'Uncategorised entry', body: 'Lands in the pinned Other group.' },
];
export const experienceCategoryOrder = ['Work', 'Leadership', 'Education'];

export const aboutBody = 'First paragraph about the person.\n\nSecond paragraph with more detail.';

export const blogPosts = [
  { id: 'hello-world', title: 'Hello world', description: 'The first post.', date: new Date('2025-02-01'), tags: ['intro'], draft: false },
  { id: 'work-in-progress', title: 'A work in progress', description: 'Not published yet.', date: new Date('2025-04-10'), tags: [], draft: true },
];

export const blogPost = {
  slug: 'hello-world',
  title: 'Hello world',
  description: 'The first post.',
  date: '2025-02-01',
  draft: false,
  tags: ['intro', 'meta'],
  body: 'Opening paragraph.\n\nSecond paragraph.',
};
export const newBlogPost = {
  slug: '',
  title: '',
  description: '',
  date: '2025-06-01',
  draft: true,
  tags: [] as string[],
  body: '',
};

// `history-fixture` view: answers GET /api/draft/history inside the harness.
export const historySessions = [
  {
    latestSha: 'aaaaaaa1111111',
    startedAt: '2026-07-20T09:00:00.000Z',
    endedAt: '2026-07-20T09:20:00.000Z',
    commitCount: 3,
    areas: ['home', 'about'],
    commits: [
      { sha: 'aaaaaaa1111111', message: 'Update home content', date: '2026-07-20T09:20:00.000Z' },
      { sha: 'aaaaaaa2222222', message: 'Update about content', date: '2026-07-20T09:10:00.000Z' },
      { sha: 'aaaaaaa3333333', message: 'Update home content', date: '2026-07-20T09:00:00.000Z' },
    ],
  },
  {
    latestSha: 'bbbbbbb1111111',
    startedAt: '2026-07-19T14:00:00.000Z',
    endedAt: '2026-07-19T14:00:00.000Z',
    commitCount: 1,
    areas: ['projects'],
    commits: [{ sha: 'bbbbbbb1111111', message: 'Update projects content', date: '2026-07-19T14:00:00.000Z' }],
  },
  {
    latestSha: 'ccccccc1111111',
    startedAt: '2026-07-18T10:00:00.000Z',
    endedAt: '2026-07-18T10:00:00.000Z',
    commitCount: 1,
    areas: ['blog'],
    commits: [{ sha: 'ccccccc1111111', message: 'Update blog post: hello-world', date: '2026-07-18T10:00:00.000Z' }],
  },
];
