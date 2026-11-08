import { describe, expect, it } from 'vitest';
import { isOpenAiImageModel, rankOpenAiImageModels } from '../server/providers/generate/openai';

describe('OpenAI image model ranking', () => {
  it('prefers the newest GPT Image family, drops retired ids and demotes dated snapshots', () => {
    const ranked = rankOpenAiImageModels([
      'gpt-4o',
      'gpt-image-1',
      'dall-e-3',
      'gpt-image-1-mini',
      'gpt-image-2.5-sunburst-2026-09-08',
      'gpt-image-2.5-sunburst',
      'gpt-image-2.6-flare',
      'gpt-image-2',
      'text-embedding-3-small',
    ]).map((m) => m.id);
    expect(ranked).toEqual(['gpt-image-2.6-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-2', 'gpt-image-1-mini']);
    expect(rankOpenAiImageModels(['gpt-image-2.6-flare'])[0].recommended).toBe(true);
    expect(isOpenAiImageModel('gpt-image-1')).toBe(false);
    expect(isOpenAiImageModel('gpt-image-3-nova')).toBe(true);
  });
});
