import type { GenerateProvider } from '../types.js';
import { base64ToBytes, upstreamJson } from '../types.js';

export const googleImagen: GenerateProvider = {
  descriptor: {
    id: 'google-imagen',
    kind: 'generate',
    name: 'Google Imagen (Gemini API)',
    homepage: 'https://ai.google.dev/gemini-api/docs/imagen',
    notes: 'Imagen offers 3:4, not 2:3; the editor pads or crops the small difference.',
    fields: [
      { key: 'apiKey', label: 'Gemini API key', secret: true },
      { key: 'model', label: 'Model', optional: true, placeholder: 'imagen-4.0-generate-001' },
    ],
  },
  env: { apiKey: 'GEMINI_API_KEY', model: 'GEMINI_IMAGE_MODEL' },
  async generate(prompt, aspect, keys, options) {
    const model = (options.model || keys.model || 'imagen-4.0-generate-001').replace(/[^a-z0-9.-]/gi, '');
    const aspectRatio = aspect === '2:3' ? '3:4' : aspect === '3:2' ? '4:3' : '1:1';
    const data = await upstreamJson<{ predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }>(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': keys.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio, personGeneration: 'allow_adult' } }),
      },
      'Google Imagen',
    );
    const p = data.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw new Error('Imagen returned no image data');
    return { bytes: base64ToBytes(p.bytesBase64Encoded), contentType: p.mimeType ?? 'image/png', meta: { model, aspectRatio } };
  },
};
