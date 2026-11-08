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

export interface GenerateProvider extends ProviderSpec {
  generate(prompt: string, aspect: Aspect, keys: Record<string, string>, options: Record<string, string>): Promise<GeneratedImage>;
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

export async function upstreamJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60000) });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new UpstreamError(`${what} returned ${res.status}${text ? `: ${text}` : ''}`, res.status === 401 || res.status === 403 ? 401 : 502);
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
