import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface GItem {
  link: string;
  title: string;
  displayLink?: string;
  image?: { thumbnailLink: string; width: number; height: number; contextLink?: string };
}

export const googleCse: SearchProvider = {
  descriptor: {
    id: 'google-cse',
    kind: 'search',
    name: 'Google Programmable Search (images)',
    homepage: 'https://developers.google.com/custom-search/v1/overview',
    notes: 'Needs an API key and a search engine ID (cx) with image search enabled. 100 free queries/day.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'cx', label: 'Search engine ID (cx)' },
    ],
  },
  env: { apiKey: 'GOOGLE_CSE_KEY', cx: 'GOOGLE_CSE_CX' },
  async search({ query, page, perPage }, keys) {
    const num = Math.min(10, perPage);
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', keys.apiKey);
    u.searchParams.set('cx', keys.cx);
    u.searchParams.set('q', query);
    u.searchParams.set('searchType', 'image');
    u.searchParams.set('num', String(num));
    u.searchParams.set('start', String((page - 1) * num + 1));
    u.searchParams.set('safe', 'active');
    u.searchParams.set('imgSize', 'large');
    const data = await upstreamJson<{ items?: GItem[]; queries?: { nextPage?: unknown[] } }>(u.toString(), {}, 'Google Custom Search');
    return {
      results: (data.items ?? []).map((it, i) => ({
        id: `${page}-${i}`,
        provider: 'google-cse',
        title: it.title,
        thumbnailUrl: it.image?.thumbnailLink ?? it.link,
        imageUrl: it.link,
        width: it.image?.width,
        height: it.image?.height,
        sourceUrl: it.image?.contextLink,
        author: it.displayLink,
      })),
      hasMore: !!data.queries?.nextPage?.length,
    };
  },
};
