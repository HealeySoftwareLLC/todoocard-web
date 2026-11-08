/** Types shared between the browser app and the backend API. */

export interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export type ProviderKind = 'search' | 'generate';

export interface ProviderDescriptor {
  id: string;
  kind: ProviderKind;
  name: string;
  homepage?: string;
  notes?: string;
  fields: ProviderField[];
  /** The server has keys configured for every required field. */
  hasServerKey: boolean;
}

export interface ConfigResponse {
  version: string;
  requiresAppToken: boolean;
  allowClientKeys: boolean;
  providers: ProviderDescriptor[];
}

export type Orientation = 'portrait' | 'landscape' | 'any';

export interface SearchRequest {
  provider: string;
  query: string;
  page?: number;
  orientation?: Orientation;
  keys?: Record<string, string>;
}

export interface SearchResult {
  id: string;
  provider: string;
  title?: string;
  thumbnailUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
  sourceUrl?: string;
  author?: string;
  license?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  page: number;
  hasMore: boolean;
}

export type Aspect = '2:3' | '3:2' | '1:1';

export interface GenerateRequest {
  provider: string;
  prompt: string;
  aspect: Aspect;
  keys?: Record<string, string>;
  options?: Record<string, string>;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
