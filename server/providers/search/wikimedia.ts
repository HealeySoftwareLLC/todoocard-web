import type { SearchProvider } from '../types.js';
import { upstreamJson } from '../types.js';

interface WmPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    width?: number;
    height?: number;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value: string }>;
  }>;
}

export const wikimedia: SearchProvider = {
  descriptor: {
    id: 'wikimedia',
    kind: 'search',
    name: 'Wikimedia Commons',
    homepage: 'https://commons.wikimedia.org',
    notes: 'No key needed. Free media; check each file’s licence for attribution.',
    fields: [],
  },
  env: {},
  async search({ query, page, perPage }) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    u.searchParams.set('action', 'query');
    u.searchParams.set('format', 'json');
    u.searchParams.set('generator', 'search');
    u.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
    u.searchParams.set('gsrnamespace', '6');
    u.searchParams.set('gsrlimit', String(perPage));
    u.searchParams.set('gsroffset', String((page - 1) * perPage));
    u.searchParams.set('prop', 'imageinfo');
    u.searchParams.set('iiprop', 'url|size|mime|extmetadata');
    u.searchParams.set('iiurlwidth', '480');
    const data = await upstreamJson<{ query?: { pages: Record<string, WmPage> }; continue?: unknown }>(
      u.toString(),
      { headers: { 'user-agent': 'todoocard-web/0.1 (https://github.com/brianhealey/todoocard-web)' } },
      'Wikimedia Commons',
    );
    const pages = Object.values(data.query?.pages ?? {});
    const results = pages
      .filter((p) => p.imageinfo?.[0]?.mime?.startsWith('image/') && !p.imageinfo[0].mime.includes('svg'))
      .map((p) => {
        const ii = p.imageinfo![0];
        return {
          id: String(p.pageid),
          provider: 'wikimedia',
          title: p.title.replace(/^File:/, ''),
          thumbnailUrl: ii.thumburl ?? ii.url,
          imageUrl: ii.url,
          width: ii.width,
          height: ii.height,
          sourceUrl: ii.descriptionurl,
          author: ii.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '').trim(),
          license: ii.extmetadata?.LicenseShortName?.value,
        };
      });
    return { results, hasMore: !!data.continue };
  },
};
