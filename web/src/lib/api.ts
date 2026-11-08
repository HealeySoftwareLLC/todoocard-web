import type { Aspect, ConfigResponse, GenerateRequest, Orientation, SearchRequest, SearchResponse } from '@shared/api';
import type { Settings } from './settings';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function headers(settings: Settings, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  if (settings.appToken) h['x-app-token'] = settings.appToken;
  return h;
}

async function parseError(res: Response): Promise<ApiError> {
  let msg = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; code?: string };
    if (body.error) msg = body.error;
    code = body.code;
  } catch {
    /* non-JSON */
  }
  return new ApiError(msg, res.status, code);
}

export async function getConfig(settings: Settings): Promise<ConfigResponse> {
  const res = await fetch('/api/config', { headers: headers(settings, false) });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ConfigResponse;
}

export async function searchImages(settings: Settings, provider: string, query: string, page: number, orientation: Orientation): Promise<SearchResponse> {
  const body: SearchRequest = { provider, query, page, orientation, keys: settings.providerKeys[provider] };
  const res = await fetch('/api/search', { method: 'POST', headers: headers(settings), body: JSON.stringify(body) });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as SearchResponse;
}

export async function generateImage(settings: Settings, provider: string, prompt: string, aspect: Aspect, options: Record<string, string> = {}): Promise<{ blob: Blob; meta?: Record<string, unknown> }> {
  const body: GenerateRequest = { provider, prompt, aspect, keys: settings.providerKeys[provider], options };
  const res = await fetch('/api/generate', { method: 'POST', headers: headers(settings), body: JSON.stringify(body) });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  let meta: Record<string, unknown> | undefined;
  const m = res.headers.get('x-generation-meta');
  if (m) {
    try {
      meta = JSON.parse(m) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return { blob, meta };
}

/** Fetch a remote image through the server proxy (needed for canvas pixel access). */
export async function fetchRemoteImage(settings: Settings, url: string): Promise<Blob> {
  const res = await fetch(`/api/image?url=${encodeURIComponent(url)}`, { headers: headers(settings, false) });
  if (!res.ok) throw await parseError(res);
  return res.blob();
}
