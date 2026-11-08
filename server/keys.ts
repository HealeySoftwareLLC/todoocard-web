import type { ProviderDescriptor, ProviderField } from '../shared/api.js';

export interface ProviderSpec {
  descriptor: Omit<ProviderDescriptor, 'hasServerKey'>;
  /** field key -> environment variable holding a server-side default */
  env: Record<string, string>;
}

export const ALLOW_CLIENT_KEYS = (process.env.ALLOW_CLIENT_KEYS ?? 'true').toLowerCase() !== 'false';

export function serverHasKeys(spec: ProviderSpec): boolean {
  return spec.descriptor.fields.filter((f) => !f.optional).every((f) => !!process.env[spec.env[f.key] ?? '']);
}

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyError';
  }
}

/** Resolve the keys for a request: client-supplied first (if allowed), then server env. */
export function resolveKeys(spec: ProviderSpec, client?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.descriptor.fields as ProviderField[]) {
    const fromClient = ALLOW_CLIENT_KEYS ? client?.[f.key]?.trim() : undefined;
    const fromEnv = process.env[spec.env[f.key] ?? '']?.trim();
    const v = fromClient || fromEnv || '';
    if (!v && !f.optional) {
      throw new KeyError(`${spec.descriptor.name}: missing ${f.label}. Add it in Settings${ALLOW_CLIENT_KEYS ? '' : ' (server-side only)'}.`);
    }
    if (v) out[f.key] = v;
  }
  return out;
}

export function describe(spec: ProviderSpec): ProviderDescriptor {
  return { ...spec.descriptor, hasServerKey: serverHasKeys(spec) };
}
