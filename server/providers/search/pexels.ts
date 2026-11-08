import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface PxPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  alt?: string;
  src: { original: string; large2x: string; large: string; medium: string; small: string };
}

export const pexels: SearchProvider = {
  descriptor: {
    id: 'pexels',
    kind: 'search',
    name: 'Pexels',
    homepage: 'https://www.pexels.com/api/',
    notes: 'Free API key. Photos are free to use under the Pexels licence.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }],
  },
  env: { apiKey: 'PEXELS_API_KEY' },
  async search({ query, page, perPage, orientation }, keys) {
    const u = new URL('https://api.pexels.com/v1/search');
    u.searchParams.set('query', query);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(perPage));
    if (orientation !== 'any') u.searchParams.set('orientation', orientation);
    const data = await upstreamJson<{ photos: PxPhoto[]; next_page?: string }>(u.toString(), { headers: { authorization: keys.apiKey } }, 'Pexels');
    return {
      results: data.photos.map((p) => ({
        id: String(p.id),
        provider: 'pexels',
        title: p.alt || undefined,
        thumbnailUrl: p.src.medium,
        imageUrl: p.src.large2x,
        width: p.width,
        height: p.height,
        sourceUrl: p.url,
        author: p.photographer,
        license: 'Pexels License',
      })),
      hasMore: !!data.next_page,
    };
  },
};
