import type { GenerateProvider, ModelInfo } from '../types.js';
import { base64ToBytes, upstreamJson } from '../types.js';

/**
 * Preferred GPT Image models, best first. gpt-image-1 was retired on 2026-10-23 and
 * gpt-image-1.5 / gpt-image-1-mini / chatgpt-image-latest shut down on 2026-12-01, so the
 * default is discovered from the account's model list rather than hard-coded.
 */
export const OPENAI_IMAGE_PREFERENCE = [
  'gpt-image-2.6-flare',
  'gpt-image-2.6-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
];
const FALLBACK_MODEL = 'gpt-image-2.6-flare';
const RETIRED = new Set(['gpt-image-1', 'dall-e-2', 'dall-e-3']);

export function isOpenAiImageModel(id: string): boolean {
  return /^(gpt-image|chatgpt-image|dall-e)/.test(id) && !RETIRED.has(id);
}

/** Order model ids by the preference list; unknown image models go after known ones, snapshots last. */
export function rankOpenAiImageModels(ids: string[]): ModelInfo[] {
  const base = (id: string) => id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const score = (id: string) => {
    const i = OPENAI_IMAGE_PREFERENCE.indexOf(base(id));
    return (i === -1 ? 100 : i) + (base(id) === id ? 0 : 0.5);
  };
  const unique = [...new Set(ids.filter(isOpenAiImageModel))].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
  return unique.map((id, i) => ({ id, recommended: i === 0 }));
}

const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();

async function listModels(keys: Record<string, string>): Promise<ModelInfo[]> {
  const cacheKey = keys.apiKey.slice(-8);
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 3600000) return hit.models;
  const data = await upstreamJson<{ data: Array<{ id: string }> }>(
    'https://api.openai.com/v1/models',
    { headers: { authorization: `Bearer ${keys.apiKey}` } },
    'OpenAI models',
  );
  const models = rankOpenAiImageModels(data.data.map((m) => m.id));
  modelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

export const openai: GenerateProvider = {
  descriptor: {
    id: 'openai',
    kind: 'generate',
    name: 'OpenAI GPT Image',
    homepage: 'https://developers.openai.com/api/docs/guides/image-generation',
    notes: 'Leave Model empty to use the newest GPT Image model your key can access. Portrait 1024x1536 output matches the card\u2019s 2:3 panel exactly.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'model', label: 'Model', optional: true, placeholder: 'auto (newest available)', help: 'For example gpt-image-2.6-flare. gpt-image-1 was retired by OpenAI in October 2026.' },
      { key: 'quality', label: 'Quality', optional: true, placeholder: 'medium', help: 'low, medium or high. Low is fast and plenty for a six-colour e-paper panel.' },
    ],
  },
  env: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_IMAGE_MODEL', quality: 'OPENAI_IMAGE_QUALITY' },
  listModels,
  async generate(prompt, aspect, keys, options) {
    const size = aspect === '2:3' ? '1024x1536' : aspect === '3:2' ? '1536x1024' : '1024x1024';
    let model = (options.model || keys.model || '').trim();
    if (!model) {
      try {
        model = (await listModels(keys))[0]?.id ?? FALLBACK_MODEL;
      } catch {
        model = FALLBACK_MODEL;
      }
    }
    if (RETIRED.has(model)) {
      throw new Error(`OpenAI retired ${model}; clear the Model field to use the newest available model or set one such as ${FALLBACK_MODEL}.`);
    }
    const quality = (options.quality || keys.quality || 'medium').trim();
    const body: Record<string, unknown> = { model, prompt, n: 1, size, quality, output_format: 'png' };
    const data = await upstreamJson<{ data: Array<{ b64_json?: string; revised_prompt?: string }> }>(
      'https://api.openai.com/v1/images/generations',
      { method: 'POST', headers: { authorization: `Bearer ${keys.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(170000) },
      'OpenAI',
    );
    const item = data.data?.[0];
    if (!item?.b64_json) throw new Error('OpenAI returned no image data');
    return { bytes: base64ToBytes(item.b64_json), contentType: 'image/png', meta: { model, size, quality, revisedPrompt: item.revised_prompt } };
  },
};
