import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface PbHit {
  id: number;
  tags: string;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  pageURL: string;
  user: string;
}

export const pixabay: SearchProvider = {
  descriptor: {
    id: 'pixabay',
    kind: 'search',
    name: 'Pixabay',
    homepage: 'https://pixabay.com/api/docs/',
    notes: 'Free API key. Photos, illustrations and vectors.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }],
  },
  env: { apiKey: 'PIXABAY_API_KEY' },
  async search({ query, page, perPage, orientation }, keys) {
    const u = new URL('https://pixabay.com/api/');
    u.searchParams.set('key', keys.apiKey);
    u.searchParams.set('q', query);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(Math.max(3, perPage)));
    u.searchParams.set('safesearch', 'true');
    if (orientation === 'portrait') u.searchParams.set('orientation', 'vertical');
    if (orientation === 'landscape') u.searchParams.set('orientation', 'horizontal');
    const data = await upstreamJson<{ hits: PbHit[]; totalHits: number }>(u.toString(), {}, 'Pixabay');
    return {
      results: data.hits.map((h) => ({
        id: String(h.id),
        provider: 'pixabay',
        title: h.tags,
        thumbnailUrl: h.webformatURL,
        imageUrl: h.largeImageURL,
        width: h.imageWidth,
        height: h.imageHeight,
        sourceUrl: h.pageURL,
        author: h.user,
        license: 'Pixabay Content License',
      })),
      hasMore: page * perPage < data.totalHits,
    };
  },
};
