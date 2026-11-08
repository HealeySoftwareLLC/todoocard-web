import type { GenerateProvider } from '../types.js';
import { base64ToBytes, upstreamJson } from '../types.js';

export const openai: GenerateProvider = {
  descriptor: {
    id: 'openai',
    kind: 'generate',
    name: 'OpenAI Images (gpt-image-1)',
    homepage: 'https://platform.openai.com/docs/guides/image-generation',
    notes: 'Portrait 1024x1536 output matches the card’s 2:3 panel exactly.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'model', label: 'Model', optional: true, placeholder: 'gpt-image-1' },
    ],
  },
  env: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_IMAGE_MODEL' },
  async generate(prompt, aspect, keys, options) {
    const size = aspect === '2:3' ? '1024x1536' : aspect === '3:2' ? '1536x1024' : '1024x1024';
    const model = options.model || keys.model || 'gpt-image-1';
    const body: Record<string, unknown> = { model, prompt, n: 1, size };
    if (model.startsWith('gpt-image')) {
      body.quality = options.quality || 'medium';
      body.output_format = 'png';
    } else {
      body.response_format = 'b64_json';
    }
    const data = await upstreamJson<{ data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }>(
      'https://api.openai.com/v1/images/generations',
      { method: 'POST', headers: { authorization: `Bearer ${keys.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) },
      'OpenAI',
    );
    const item = data.data?.[0];
    if (!item?.b64_json) throw new Error('OpenAI returned no image data');
    return { bytes: base64ToBytes(item.b64_json), contentType: 'image/png', meta: { model, size, revisedPrompt: item.revised_prompt } };
  },
};
