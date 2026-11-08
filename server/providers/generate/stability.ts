import type { GenerateProvider } from '../types.js';
import { UpstreamError } from '../types.js';

export const stability: GenerateProvider = {
  descriptor: {
    id: 'stability',
    kind: 'generate',
    name: 'Stability AI (Stable Image Core)',
    homepage: 'https://platform.stability.ai/docs/api-reference',
    notes: 'Supports a native 2:3 aspect ratio.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'model', label: 'Endpoint', optional: true, placeholder: 'core (or sd3, ultra)' },
    ],
  },
  env: { apiKey: 'STABILITY_API_KEY', model: 'STABILITY_MODEL' },
  async generate(prompt, aspect, keys, options) {
    const endpoint = (options.model || keys.model || 'core').replace(/[^a-z0-9-]/gi, '');
    const form = new FormData();
    form.set('prompt', prompt);
    form.set('aspect_ratio', aspect);
    form.set('output_format', 'png');
    const res = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keys.apiKey}`, accept: 'image/*' },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new UpstreamError(`Stability returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status === 401 ? 401 : 502);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/png', meta: { endpoint, aspect } };
  },
};
