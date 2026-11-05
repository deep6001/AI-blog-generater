export interface ModelOption {
  /** "provider:model" */
  id: string;
  provider: 'openai' | 'google' | 'anthropic';
  model: string;
}

export interface ModelCatalog {
  defaultModel: string | null;
  providers: { id: ModelOption['provider']; label: string }[];
  models: ModelOption[];
}

export const EMPTY_CATALOG: ModelCatalog = { defaultModel: null, providers: [], models: [] };

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  const res = await fetch('/api/models');
  if (!res.ok) throw new Error(`Could not load models (HTTP ${res.status})`);
  return res.json();
}

/** "openai:gpt-5" -> "gpt-5" */
export function modelName(ref: string | null | undefined): string {
  return ref ? ref.slice(ref.indexOf(':') + 1) : '';
}
