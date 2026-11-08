import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface BraveImage {
  title?: string;
  url: string;
  source?: string;
  thumbnail?: { src: string };
  properties?: { url: string; width?: number; height?: number };
}

export const brave: SearchProvider = {
  descriptor: {
    id: 'brave',
    kind: 'search',
    name: 'Brave Image Search',
    homepage: 'https://brave.com/search/api/',
    notes: 'Needs a Brave Search API subscription token (free tier available).',
    fields: [{ key: 'token', label: 'Subscription token', secret: true }],
  },
  env: { token: 'BRAVE_SEARCH_KEY' },
  async search({ query, perPage }, keys) {
    const u = new URL('https://api.search.brave.com/res/v1/images/search');
    u.searchParams.set('q', query);
    u.searchParams.set('count', String(Math.min(100, perPage)));
    u.searchParams.set('safesearch', 'strict');
    const data = await upstreamJson<{ results: BraveImage[] }>(
      u.toString(),
      { headers: { accept: 'application/json', 'x-subscription-token': keys.token } },
      'Brave Search',
    );
    return {
      results: (data.results ?? [])
        .filter((r) => r.properties?.url)
        .map((r, i) => ({
          id: String(i),
          provider: 'brave',
          title: r.title,
          thumbnailUrl: r.thumbnail?.src ?? r.properties!.url,
          imageUrl: r.properties!.url,
          width: r.properties?.width,
          height: r.properties?.height,
          sourceUrl: r.url,
          author: r.source,
        })),
      hasMore: false,
    };
  },
};
