import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const sorted = posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  // Renders a valid empty <rss> feed if the collection has no posts —
  // @astrojs/rss handles an empty items array without crashing.
  return rss({
    title: 'Isaiah Ho — Blog',
    description: 'Writing by Isaiah Ho on structured thinking, case work, and consulting.',
    site: context.site ?? 'https://example.com',
    items: sorted.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/blog/${post.id}/`,
    })),
  });
}
