import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface SerpImage {
  position: number;
  thumbnail: string;
  original: string;
  original_width?: number;
  original_height?: number;
  title?: string;
  link?: string;
  source?: string;
}

export const serpapi: SearchProvider = {
  descriptor: {
    id: 'serpapi',
    kind: 'search',
    name: 'SerpApi (Google Images)',
    homepage: 'https://serpapi.com',
    notes: 'Paid service with a free monthly quota.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true }],
  },
  env: { apiKey: 'SERPAPI_KEY' },
  async search({ query, page }, keys) {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google_images');
    u.searchParams.set('q', query);
    u.searchParams.set('api_key', keys.apiKey);
    u.searchParams.set('ijn', String(page - 1));
    u.searchParams.set('safe', 'active');
    const data = await upstreamJson<{ images_results?: SerpImage[] }>(u.toString(), {}, 'SerpApi');
    return {
      results: (data.images_results ?? []).map((r) => ({
        id: String(r.position),
        provider: 'serpapi',
        title: r.title,
        thumbnailUrl: r.thumbnail,
        imageUrl: r.original,
        width: r.original_width,
        height: r.original_height,
        sourceUrl: r.link,
        author: r.source,
      })),
      hasMore: (data.images_results?.length ?? 0) > 0,
    };
  },
};
