import type { GenerateProvider, SearchProvider } from './types.js';
import { openverse } from './search/openverse.js';
import { wikimedia } from './search/wikimedia.js';
import { pexels } from './search/pexels.js';
import { unsplash } from './search/unsplash.js';
import { pixabay } from './search/pixabay.js';
import { googleCse } from './search/google.js';
import { brave } from './search/brave.js';
import { serpapi } from './search/serpapi.js';
import { openai } from './generate/openai.js';
import { stability } from './generate/stability.js';
import { googleImagen } from './generate/google.js';
import { replicate } from './generate/replicate.js';

export const searchProviders: Record<string, SearchProvider> = Object.fromEntries(
  [openverse, wikimedia, pexels, unsplash, pixabay, googleCse, brave, serpapi].map((p) => [p.descriptor.id, p]),
);

export const generateProviders: Record<string, GenerateProvider> = Object.fromEntries(
  [openai, stability, googleImagen, replicate].map((p) => [p.descriptor.id, p]),
);
