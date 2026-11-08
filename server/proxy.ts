/**
 * Image proxy with SSRF protections. Browsers cannot read pixels from
 * cross-origin images without CORS headers, so the app fetches remote images
 * through this endpoint.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;

export class ProxyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + parseInt(p, 10), 0) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const inRange = (base: string, bits: number) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits));
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) ||
    inRange('240.0.0.0', 4)
  );
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('ff')) return true; // multicast
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (v4) return isPrivateV4(v4[1]);
  return false;
}

export function isPublicAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return !isPrivateV4(ip);
  if (fam === 6) return !isPrivateV6(ip);
  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProxyError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new ProxyError('Credentials in URLs are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ProxyError('Host not allowed');
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new ProxyError('Address not allowed');
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ProxyError('Host could not be resolved', 424);
  }
  if (addrs.length === 0 || !addrs.every((a) => isPublicAddress(a.address))) throw new ProxyError('Address not allowed');
}

export interface ProxiedImage {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

export async function fetchImage(rawUrl: string): Promise<ProxiedImage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProxyError('Invalid URL');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'user-agent': 'todoocard-web/0.1 (+https://github.com/brianhealey/todoocard-web)',
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ProxyError(`Fetch failed: ${(e as Error).message}`, 424);
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) throw new ProxyError('Redirect without location', 424);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new ProxyError(`Upstream returned ${res.status}`, 424);
    }
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) {
      clearTimeout(timer);
      throw new ProxyError('Image too large', 413);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      throw new ProxyError('Empty response', 424);
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw new ProxyError('Image too large', 413);
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.byteLength;
    }
    const sniffed = sniffImageType(bytes);
    const contentType = sniffed ?? (ct.startsWith('image/') ? ct : '');
    if (!contentType) throw new ProxyError('URL did not return an image', 415);
    return { bytes, contentType, finalUrl: url.toString() };
  }
  throw new ProxyError('Too many redirects', 424);
}

export function sniffImageType(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand.startsWith('avi')) return 'image/avif';
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image/heic';
  }
  if (b.length >= 5 && String.fromCharCode(...b.subarray(0, 5)).toLowerCase().startsWith('<svg')) return 'image/svg+xml';
  return null;
}
