import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface UsPhoto {
  id: string;
  width: number;
  height: number;
  description?: string;
  alt_description?: string;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location?: string };
  user: { name: string };
}

export const unsplash: SearchProvider = {
  descriptor: {
    id: 'unsplash',
    kind: 'search',
    name: 'Unsplash',
    homepage: 'https://unsplash.com/developers',
    notes: 'Free Access Key (demo apps are limited to 50 requests/hour).',
    fields: [{ key: 'accessKey', label: 'Access Key', secret: true }],
  },
  env: { accessKey: 'UNSPLASH_ACCESS_KEY' },
  async search({ query, page, perPage, orientation }, keys) {
    const u = new URL('https://api.unsplash.com/search/photos');
    u.searchParams.set('query', query);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(perPage));
    if (orientation !== 'any') u.searchParams.set('orientation', orientation);
    const data = await upstreamJson<{ results: UsPhoto[]; total_pages: number }>(
      u.toString(),
      { headers: { authorization: `Client-ID ${keys.accessKey}`, 'accept-version': 'v1' } },
      'Unsplash',
    );
    return {
      results: data.results.map((p) => ({
        id: p.id,
        provider: 'unsplash',
        title: p.description || p.alt_description || undefined,
        thumbnailUrl: p.urls.small,
        imageUrl: `${p.urls.raw}&w=1600&q=85&fm=jpg`,
        width: p.width,
        height: p.height,
        sourceUrl: p.links.html,
        author: p.user.name,
        license: 'Unsplash License',
      })),
      hasMore: data.total_pages > page,
    };
  },
};
