import type { GenerateProvider } from '../types.js';
import { fetchBytes, upstreamJson } from '../types.js';

interface Prediction {
  id: string;
  status: string;
  output?: string[] | string;
  error?: string;
  urls?: { get: string };
}

export const replicate: GenerateProvider = {
  descriptor: {
    id: 'replicate',
    kind: 'generate',
    name: 'Replicate (FLUX and others)',
    homepage: 'https://replicate.com/docs',
    notes: 'Default model black-forest-labs/flux-schnell. Any model accepting prompt and aspect_ratio inputs works.',
    fields: [
      { key: 'token', label: 'API token', secret: true },
      { key: 'model', label: 'Model (owner/name)', optional: true, placeholder: 'black-forest-labs/flux-schnell' },
    ],
  },
  env: { token: 'REPLICATE_API_TOKEN', model: 'REPLICATE_MODEL' },
  async generate(prompt, aspect, keys, options) {
    const model = (options.model || keys.model || 'black-forest-labs/flux-schnell').replace(/[^a-z0-9._/-]/gi, '');
    const headers = { authorization: `Bearer ${keys.token}`, 'content-type': 'application/json', prefer: 'wait=60' };
    let pred = await upstreamJson<Prediction>(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      { method: 'POST', headers, body: JSON.stringify({ input: { prompt, aspect_ratio: aspect, output_format: 'png', num_outputs: 1 } }) },
      'Replicate',
    );
    const deadline = Date.now() + 180000;
    while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
      if (Date.now() > deadline) throw new Error('Replicate prediction timed out');
      await new Promise((r) => setTimeout(r, 2000));
      pred = await upstreamJson<Prediction>(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, { headers }, 'Replicate');
    }
    if (pred.status !== 'succeeded') throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? 'unknown error'}`);
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!url) throw new Error('Replicate returned no output');
    const img = await fetchBytes(url, 'Replicate');
    return { ...img, meta: { model, aspect } };
  },
};
