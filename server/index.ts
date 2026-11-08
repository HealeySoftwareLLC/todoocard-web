import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigResponse, GenerateRequest, SearchRequest } from '../shared/api.js';
import { ALLOW_CLIENT_KEYS, KeyError, describe, resolveKeys } from './keys.js';
import { generateProviders, searchProviders } from './providers/index.js';
import { UpstreamError } from './providers/types.js';
import { ProxyError, fetchImage } from './proxy.js';
import { RateLimiter } from './ratelimit.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
/** Walk up from this file until package.json is found (works from server/ in dev and dist/server/server/ when built). */
function findPackageJson(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'package.json');
}
const pkg = require(findPackageJson(here)) as { version: string };
const webDir = [join(here, '../../web'), join(here, '../dist/web'), join(process.cwd(), 'dist/web')].find((d) => existsSync(join(d, 'index.html')));

const PORT = Number(process.env.PORT ?? 8787);
const APP_TOKEN = process.env.APP_ACCESS_TOKEN?.trim() || '';

const app = new Hono();
app.use(logger((s) => console.log(s)));
/**
 * Cache policy (Cloudflare and browsers honour these):
 * - /assets/* are content-hashed by Vite: cache for a year, immutable.
 * - the HTML shell must always be revalidated so a deploy is picked up at once.
 * - other static files (favicon) for a day; API responses never.
 */
app.use('/*', async (c, next) => {
  await next();
  const p = c.req.path;
  if (p.startsWith('/api/')) {
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
    return;
  }
  if (p.startsWith('/assets/')) c.res.headers.set('cache-control', 'public, max-age=31536000, immutable');
  else if (p === '/' || p.endsWith('.html') || c.res.headers.get('content-type')?.includes('text/html')) c.res.headers.set('cache-control', 'no-cache');
  else c.res.headers.set('cache-control', 'public, max-age=86400, must-revalidate');
});

app.use('/api/*', cors({ origin: (o) => o, allowHeaders: ['content-type', 'x-app-token'], exposeHeaders: ['x-generation-meta'] }));

const limits = {
  search: new RateLimiter(60, 1),
  generate: new RateLimiter(10, 10 / 60),
  image: new RateLimiter(120, 2),
};

function clientIp(c: { req: { header: (n: string) => string | undefined }; env: unknown }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  return 'local';
}

app.use('/api/*', async (c, next) => {
  // Health stays open for Kubernetes probes and uptime checks; it reveals only the version.
  if (c.req.path === '/api/health') return next();
  if (APP_TOKEN) {
    const provided = c.req.header('x-app-token') ?? c.req.query('token') ?? '';
    if (provided !== APP_TOKEN) return c.json({ error: 'Missing or invalid app token', code: 'unauthorized' }, 401);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, version: pkg.version }));

app.get('/api/config', (c) => {
  const body: ConfigResponse = {
    version: pkg.version,
    requiresAppToken: !!APP_TOKEN,
    allowClientKeys: ALLOW_CLIENT_KEYS,
    providers: [...Object.values(searchProviders), ...Object.values(generateProviders)].map(describe),
  };
  return c.json(body);
});

app.post('/api/search', async (c) => {
  if (!limits.search.take(clientIp(c))) return c.json({ error: 'Too many requests', code: 'ratelimit' }, 429);
  const req = (await c.req.json().catch(() => null)) as SearchRequest | null;
  if (!req?.provider || typeof req.query !== 'string' || !req.query.trim()) return c.json({ error: 'provider and query are required' }, 400);
  const provider = searchProviders[req.provider];
  if (!provider) return c.json({ error: `Unknown search provider ${req.provider}` }, 404);
  try {
    const keys = resolveKeys(provider, req.keys);
    const page = Math.max(1, Math.min(50, Number(req.page ?? 1) || 1));
    const r = await provider.search({ query: req.query.trim().slice(0, 200), page, perPage: 24, orientation: req.orientation ?? 'any' }, keys);
    return c.json({ results: r.results, page, hasMore: r.hasMore });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/generate', async (c) => {
  if (!limits.generate.take(clientIp(c))) return c.json({ error: 'Too many generation requests; wait a minute', code: 'ratelimit' }, 429);
  const req = (await c.req.json().catch(() => null)) as GenerateRequest | null;
  if (!req?.provider || typeof req.prompt !== 'string' || !req.prompt.trim()) return c.json({ error: 'provider and prompt are required' }, 400);
  const provider = generateProviders[req.provider];
  if (!provider) return c.json({ error: `Unknown generation provider ${req.provider}` }, 404);
  const aspect = req.aspect === '3:2' || req.aspect === '1:1' ? req.aspect : '2:3';
  try {
    const keys = resolveKeys(provider, req.keys);
    const img = await provider.generate(req.prompt.trim().slice(0, 4000), aspect, keys, req.options ?? {});
    c.header('content-type', img.contentType);
    c.header('cache-control', 'no-store');
    if (img.meta) c.header('x-generation-meta', JSON.stringify(img.meta));
    return c.body(img.bytes as unknown as ArrayBuffer);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/models', async (c) => {
  if (!limits.search.take(clientIp(c))) return c.json({ error: 'Too many requests', code: 'ratelimit' }, 429);
  const req = (await c.req.json().catch(() => null)) as { provider?: string; keys?: Record<string, string> } | null;
  const provider = req?.provider ? generateProviders[req.provider] : undefined;
  if (!provider) return c.json({ error: 'Unknown generation provider' }, 404);
  if (!provider.listModels) return c.json({ models: [] });
  try {
    const keys = resolveKeys(provider, req?.keys);
    return c.json({ models: await provider.listModels(keys) });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/image', async (c) => {
  if (!limits.image.take(clientIp(c))) return c.json({ error: 'Too many requests', code: 'ratelimit' }, 429);
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'url is required' }, 400);
  try {
    const img = await fetchImage(url);
    c.header('content-type', img.contentType);
    c.header('cache-control', 'private, max-age=3600');
    c.header('x-final-url', img.finalUrl);
    return c.body(img.bytes as unknown as ArrayBuffer);
  } catch (e) {
    return errorResponse(c, e);
  }
});

function errorResponse(c: { json: (b: unknown, s: number) => Response }, e: unknown): Response {
  if (e instanceof KeyError) return c.json({ error: e.message, code: 'missing-key' }, 400);
  if (e instanceof ProxyError) return c.json({ error: e.message, code: 'proxy' }, e.status);
  if (e instanceof UpstreamError) {
    console.error(`API upstream error (${e.status}): ${e.message}`);
    return c.json({ error: e.message, code: 'upstream' }, e.status);
  }
  const msg = (e as Error)?.message ?? String(e);
  const timeout = /aborted|timeout/i.test(msg);
  console.error('API error:', msg);
  return c.json({ error: timeout ? `The provider did not answer in time (${msg}). Try again or use a faster quality/model.` : msg, code: timeout ? 'timeout' : 'error' }, timeout ? 504 : 502);
}

if (webDir) {
  const root = webDir.startsWith('/') ? webDir : join(process.cwd(), webDir);
  const rel = root.replace(process.cwd() + '/', '');
  app.use('/*', serveStatic({ root: rel }));
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(indexHtml));
} else {
  app.get('/', (c) => c.text('todoocard-web API. The web build is missing; run `npm run build`.'));
}

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`todoocard-web ${pkg.version} listening on http://${info.address}:${info.port}${webDir ? '' : ' (API only)'}`);
});
