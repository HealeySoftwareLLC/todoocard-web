import type { Aspect, Orientation, SearchResult } from '../../shared/api.js';
import type { ProviderSpec } from '../keys.js';

export interface SearchParams {
  query: string;
  page: number;
  perPage: number;
  orientation: Orientation;
}

export interface SearchProvider extends ProviderSpec {
  search(params: SearchParams, keys: Record<string, string>): Promise<{ results: SearchResult[]; hasMore: boolean }>;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  meta?: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  label?: string;
  recommended?: boolean;
}

export interface GenerateProvider extends ProviderSpec {
  generate(prompt: string, aspect: Aspect, keys: Record<string, string>, options: Record<string, string>): Promise<GeneratedImage>;
  /** Optional: list models the given keys can use, best first. */
  listModels?(keys: Record<string, string>): Promise<ModelInfo[]>;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** Map an upstream HTTP status to the status we return: client-side problems stay 4xx, everything else is 502. */
export function mapUpstreamStatus(status: number): number {
  if (status === 401 || status === 403) return 401;
  if (status === 400 || status === 404 || status === 422) return 400;
  if (status === 429) return 429;
  return 502;
}

/** Pull a human-readable message out of common JSON error envelopes. */
export function upstreamMessage(text: string): string {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = j.error as Record<string, unknown> | string | undefined;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    if (typeof j.message === 'string') return j.message;
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* not JSON */
  }
  return text.replace(/\s+/g, ' ').trim();
}

export async function upstreamJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(90000) });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 2000);
    const msg = upstreamMessage(text).slice(0, 300);
    console.error(`upstream ${what} ${init.method ?? 'GET'} ${new URL(url).host} -> ${res.status}: ${msg}`);
    throw new UpstreamError(`${what} returned ${res.status}${msg ? `: ${msg}` : ''}`, mapUpstreamStatus(res.status));
  }
  return (await res.json()) as T;
}

export async function fetchBytes(url: string, what: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new UpstreamError(`${what} download returned ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
