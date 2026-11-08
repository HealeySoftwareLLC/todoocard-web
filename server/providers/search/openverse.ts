import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface OvResult {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  foreign_landing_url?: string;
  creator?: string;
  license?: string;
  license_version?: string;
}

export const openverse: SearchProvider = {
  descriptor: {
    id: 'openverse',
    kind: 'search',
    name: 'Openverse (Creative Commons)',
    homepage: 'https://openverse.org',
    notes: 'No key needed. Openly licensed images; anonymous use is rate limited by Openverse.',
    fields: [],
  },
  env: {},
  async search({ query, page, perPage, orientation }) {
    const u = new URL('https://api.openverse.org/v1/images/');
    u.searchParams.set('q', query);
    u.searchParams.set('page', String(page));
    u.searchParams.set('page_size', String(Math.min(20, perPage))); // anonymous limit
    if (orientation === 'portrait') u.searchParams.set('aspect_ratio', 'tall');
    if (orientation === 'landscape') u.searchParams.set('aspect_ratio', 'wide');
    const data = await upstreamJson<{ results: OvResult[]; page_count?: number }>(u.toString(), { headers: { accept: 'application/json' } }, 'Openverse');
    return {
      results: data.results.map((r) => ({
        id: r.id,
        provider: 'openverse',
        title: r.title,
        thumbnailUrl: r.thumbnail ?? r.url,
        imageUrl: r.url,
        width: r.width,
        height: r.height,
        sourceUrl: r.foreign_landing_url,
        author: r.creator,
        license: r.license ? `${r.license.toUpperCase()} ${r.license_version ?? ''}`.trim() : undefined,
      })),
      hasMore: (data.page_count ?? page) > page,
    };
  },
};
