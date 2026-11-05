// One entry point for every model call. Writing goes through LangChain chat models;
// web search uses each provider's built-in search tool so we get real citations back.
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, type AIMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export type Provider = 'openai' | 'google' | 'anthropic';

export interface ModelInfo {
  /** "provider:model", the value stored on projects and steps. */
  id: string;
  provider: Provider;
  model: string;
}

export interface Usage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface WebSource {
  id: number;
  title: string;
  url: string;
  domain: string;
}

export interface WebResult {
  /** Answer text with [n] markers pointing at `sources`. */
  text: string;
  sources: WebSource[];
  searchQueries: string[];
  usage: Usage;
}

export const PROVIDER_LABELS: Record<Provider, string> = { openai: 'OpenAI', google: 'Google Gemini', anthropic: 'Anthropic Claude' };

const keys: Record<Provider, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GEMINI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
};

// Used when a provider's model list cannot be fetched, and as each provider's default.
const fallbackModels: Record<Provider, string | undefined> = {
  openai: process.env.OPENAI_MODEL,
  google: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
};

const MAX_OUTPUT_TOKENS = 16000;

export function availableProviders(): Provider[] {
  return (Object.keys(keys) as Provider[]).filter((p) => Boolean(keys[p]));
}

let googleClient: GoogleGenAI | null = null;
function google(): GoogleGenAI {
  if (!keys.google) throw new Error('GEMINI_API_KEY is not configured on the server.');
  googleClient ??= new GoogleGenAI({ apiKey: keys.google });
  return googleClient;
}

// Model listing --------------------------------------------------------------------

const LIST_TTL_MS = 10 * 60 * 1000;
let listCache: { at: number; models: ModelInfo[] } | null = null;

async function listProvider(provider: Provider): Promise<string[]> {
  const key = keys[provider]!;
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`OpenAI models: HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: { id: string }[] };
    return data
      .map((m) => m.id)
      .filter((id) => /^(gpt-\d|o\d|chatgpt-)/.test(id) && !/^gpt-3\.5/.test(id))
      .filter((id) => !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|codex|moderation|-\d{4}-\d{2}-\d{2}$)/.test(id));
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Anthropic models: HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: { id: string }[] };
    return data.map((m) => m.id);
  }
  const ids: string[] = [];
  for await (const m of await google().models.list({ config: { pageSize: 100 } })) {
    const id = (m.name || '').replace('models/', '');
    if (/^gemini-[\d.]+-(flash|pro)(-lite)?$/.test(id)) ids.push(id);
  }
  return ids;
}

/** GPT models before the older o-series, then newest-looking names first (gpt-5.5 before gpt-5). */
function byVersionDesc(a: string, b: string): number {
  const rank = (id: string) => (/^o\d/.test(id) ? 1 : 0);
  return rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true });
}

/** A sensible default from a provider's list: its newest general model, not a pro/mini/nano/chat variant. */
function pickDefault(ids: string[]): string | undefined {
  return ids.find((id) => !/(pro|mini|nano|lite|chat|latest|preview)/.test(id)) ?? ids[0];
}

export async function listModels(): Promise<ModelInfo[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.models;

  const perProvider = await Promise.all(
    availableProviders().map(async (provider) => {
      let ids: string[] = [];
      try {
        ids = await listProvider(provider);
      } catch (err: any) {
        console.warn(`Could not list ${provider} models:`, err?.message || err);
      }
      const fallback = fallbackModels[provider];
      if (fallback && !ids.includes(fallback)) ids.push(fallback);
      return ids.sort(byVersionDesc).map((model) => ({ id: `${provider}:${model}`, provider, model }));
    })
  );

  const models = perProvider.flat();
  listCache = { at: Date.now(), models };
  return models;
}

export async function defaultModelRef(): Promise<string | null> {
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  const models = await listModels();
  for (const p of availableProviders()) {
    // An explicitly configured provider model wins over the guessed one.
    const explicit = p === 'openai' ? process.env.OPENAI_MODEL : p === 'google' ? process.env.GEMINI_MODEL : process.env.ANTHROPIC_MODEL;
    if (explicit) return `${p}:${explicit}`;
    const picked = pickDefault(models.filter((m) => m.provider === p).map((m) => m.model));
    if (picked) return `${p}:${picked}`;
  }
  return null;
}

export class ModelConfigError extends Error {}

/** Accepts "provider:model" from the client; falls back to the server default. */
export async function resolveModel(ref: unknown): Promise<ModelInfo> {
  const value = typeof ref === 'string' && ref.includes(':') ? ref : await defaultModelRef();
  if (!value) throw new ModelConfigError('No AI provider is configured. Add OPENAI_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.');
  const [provider, ...rest] = value.split(':');
  const model = rest.join(':');
  if (!(provider in keys) || !model) throw new ModelConfigError(`Unknown model "${value}".`);
  if (!keys[provider as Provider]) {
    throw new ModelConfigError(`${PROVIDER_LABELS[provider as Provider]} is not configured on the server (missing API key).`);
  }
  return { id: value, provider: provider as Provider, model };
}

// Plain generation via LangChain ---------------------------------------------------

// Some OpenAI models (reasoning, newer GPT) reject a custom temperature. Learned on first rejection.
const fixedTemperatureModels = new Set<string>();
const fixedTemperatureOpenAI = (model: string) => /^o\d/.test(model) || fixedTemperatureModels.has(model);
const isTemperatureRejection = (err: any) => /temperature/i.test(String(err?.message)) && /unsupported|not support/i.test(String(err?.message));

function chatModel({ provider, model }: ModelInfo, temperature?: number): BaseChatModel {
  if (provider === 'openai') {
    return new ChatOpenAI({
      model,
      apiKey: keys.openai,
      ...(temperature !== undefined && !fixedTemperatureOpenAI(model) ? { temperature } : {}),
    });
  }
  if (provider === 'anthropic') {
    return new ChatAnthropic({ model, apiKey: keys.anthropic, temperature, maxTokens: MAX_OUTPUT_TOKENS });
  }
  return new ChatGoogleGenerativeAI({ model, apiKey: keys.google, temperature, maxOutputTokens: MAX_OUTPUT_TOKENS });
}

function usageOf(msg: AIMessage): Usage {
  const u = msg.usage_metadata;
  return {
    promptTokens: u?.input_tokens ?? 0,
    candidatesTokens: u?.output_tokens ?? 0,
    totalTokens: u?.total_tokens ?? (u ? u.input_tokens + u.output_tokens : 0),
  };
}

export async function generate(
  info: ModelInfo,
  opts: { prompt: string; system?: string; temperature?: number; signal?: AbortSignal }
): Promise<{ text: string; usage: Usage }> {
  const messages = [...(opts.system ? [new SystemMessage(opts.system)] : []), new HumanMessage(opts.prompt)];
  let msg: AIMessage;
  try {
    msg = (await chatModel(info, opts.temperature).invoke(messages, { signal: opts.signal })) as AIMessage;
  } catch (err) {
    if (info.provider !== 'openai' || opts.temperature === undefined || !isTemperatureRejection(err)) throw err;
    fixedTemperatureModels.add(info.model);
    msg = (await chatModel(info).invoke(messages, { signal: opts.signal })) as AIMessage;
  }
  return { text: msg.text, usage: usageOf(msg) };
}

// Web search ---------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Drops utm_* and similar tracking parameters that search tools add to links. */
export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_[a-z]+$|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

class SourceList {
  readonly sources: WebSource[] = [];
  idFor(rawUrl: string, title?: string): number {
    const url = stripTracking(rawUrl);
    const existing = this.sources.find((s) => s.url === url);
    if (existing) return existing.id;
    const domain = hostOf(url);
    const source = { id: this.sources.length + 1, url, domain, title: title || domain || url };
    this.sources.push(source);
    return source.id;
  }
}

const markers = (ids: number[]) => [...new Set(ids)].map((id) => `[${id}]`).join('');

/** Google Search grounding returns short-lived redirect links; follow one hop to the publisher URL. */
async function resolveRedirect(uri: string): Promise<string> {
  if (!uri.includes('grounding-api-redirect')) return uri;
  try {
    const res = await fetch(uri, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return res.headers.get('location') || uri;
  } catch {
    return uri;
  }
}

async function geminiCited(response: GenerateContentResponse, insertMarkers: boolean): Promise<Omit<WebResult, 'usage'>> {
  const meta = response.candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks || [];
  const urls = await Promise.all(chunks.map((c) => (c.web?.uri ? resolveRedirect(c.web.uri) : Promise.resolve(''))));
  const list = new SourceList();
  const chunkIds = urls.map((url, i) => (url ? list.idFor(url, chunks[i].web?.title) : 0));

  // Grounding offsets are bytes per part, so match on segment text and insert from the end.
  let text = response.text || '';
  const supports = [...(meta?.groundingSupports || [])].sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));
  for (const s of supports) {
    const seg = s.segment?.text;
    const ids = (s.groundingChunkIndices || []).map((i) => chunkIds[i]).filter(Boolean);
    const at = seg ? text.lastIndexOf(seg) : -1;
    if (!insertMarkers || at < 0 || ids.length === 0) continue;
    const end = at + seg!.length;
    text = text.slice(0, end) + markers(ids) + text.slice(end);
  }
  return { text, sources: list.sources, searchQueries: meta?.webSearchQueries || [] };
}

/** OpenAI and Anthropic citations arrive as LangChain standard citation annotations on text blocks. */
function standardCited(msg: AIMessage, insertMarkers: boolean): Omit<WebResult, 'usage'> {
  const list = new SourceList();
  const searchQueries: string[] = [];
  let text = '';

  for (const block of msg.contentBlocks as any[]) {
    if (block.type === 'server_tool_call' && typeof block.args?.query === 'string') searchQueries.push(block.args.query);
    if (block.type !== 'text') continue;

    let blockText: string = block.text || '';
    const citations = (block.annotations || []).filter((a: any) => a?.type === 'citation' && typeof a.url === 'string');
    const positioned = citations.filter((c: any) => Number.isInteger(c.endIndex));
    const unpositioned = citations.filter((c: any) => !Number.isInteger(c.endIndex));

    for (const c of [...positioned].sort((a: any, b: any) => b.endIndex - a.endIndex)) {
      const id = list.idFor(c.url, c.title);
      if (insertMarkers) blockText = blockText.slice(0, c.endIndex) + markers([id]) + blockText.slice(c.endIndex);
    }
    // Anthropic splits text into one block per cited passage; mark the end of the passage.
    const extra = unpositioned.map((c: any) => list.idFor(c.url, c.title));
    if (insertMarkers && extra.length) blockText += markers(extra);
    text += blockText;
  }
  // Inline links like ([nice.org.uk](https://...)) duplicate the [n] markers; drop them.
  if (insertMarkers) text = text.replace(/\s?\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)/g, '');
  return { text, sources: list.sources, searchQueries };
}

export async function webSearch(
  info: ModelInfo,
  prompt: string,
  opts: { allowedDomains?: string[]; signal?: AbortSignal; insertMarkers?: boolean } = {}
): Promise<WebResult> {
  const domains = (opts.allowedDomains || []).filter(Boolean);
  const insertMarkers = opts.insertMarkers ?? true;

  if (info.provider === 'google') {
    const res = await google().models.generateContent({
      model: info.model,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, abortSignal: opts.signal },
    });
    const u = res.usageMetadata;
    return {
      ...(await geminiCited(res, insertMarkers)),
      usage: { promptTokens: u?.promptTokenCount || 0, candidatesTokens: u?.candidatesTokenCount || 0, totalTokens: u?.totalTokenCount || 0 },
    };
  }

  const model =
    info.provider === 'openai'
      ? new ChatOpenAI({ model: info.model, apiKey: keys.openai, useResponsesApi: true }).bindTools([
          { type: 'web_search', ...(domains.length ? { filters: { allowed_domains: domains } } : {}) } as any,
        ])
      : new ChatAnthropic({ model: info.model, apiKey: keys.anthropic, maxTokens: MAX_OUTPUT_TOKENS }).bindTools([
          { type: 'web_search_20250305', name: 'web_search', max_uses: 8, ...(domains.length ? { allowed_domains: domains } : {}) } as any,
        ]);

  const msg = (await model.invoke([new HumanMessage(prompt)], { signal: opts.signal })) as AIMessage;
  return { ...standardCited(msg, insertMarkers), usage: usageOf(msg) };
}

/** Reads specific pages (reference articles). */
export async function readUrls(info: ModelInfo, prompt: string, signal?: AbortSignal): Promise<{ text: string; usage: Usage }> {
  if (info.provider === 'google') {
    const res = await google().models.generateContent({
      model: info.model,
      contents: prompt,
      config: { tools: [{ urlContext: {} }], temperature: 0.2, abortSignal: signal },
    });
    const u = res.usageMetadata;
    return {
      text: res.text || '',
      usage: { promptTokens: u?.promptTokenCount || 0, candidatesTokens: u?.candidatesTokenCount || 0, totalTokens: u?.totalTokenCount || 0 },
    };
  }
  const model =
    info.provider === 'openai'
      ? new ChatOpenAI({ model: info.model, apiKey: keys.openai, useResponsesApi: true }).bindTools([{ type: 'web_search' } as any])
      : new ChatAnthropic({ model: info.model, apiKey: keys.anthropic, maxTokens: MAX_OUTPUT_TOKENS }).bindTools([
          { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 10 } as any,
        ]);
  const msg = (await model.invoke([new HumanMessage(prompt)], { signal })) as AIMessage;
  return { text: msg.text, usage: usageOf(msg) };
}

export function addUsage(...items: (Usage | undefined)[]): Usage {
  return items.reduce<Usage>(
    (acc, u) => ({
      promptTokens: acc.promptTokens + (u?.promptTokens || 0),
      candidatesTokens: acc.candidatesTokens + (u?.candidatesTokens || 0),
      totalTokens: acc.totalTokens + (u?.totalTokens || 0),
    }),
    { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 }
  );
}

/** Maps provider errors to a status code and a message the UI can show. */
export function describeModelError(err: any, info?: ModelInfo): { status: number; message: string } {
  const raw = String(err?.message || err || 'unknown error');
  const who = info ? PROVIDER_LABELS[info.provider] : 'The AI provider';
  if (err instanceof ModelConfigError) return { status: 503, message: raw };
  if (err?.name === 'AbortError' || /aborted|timed out/i.test(raw)) {
    return { status: 504, message: `${who} took too long to respond. Please retry.` };
  }
  if (/no credits remaining|insufficient_quota|credit balance is too low/i.test(raw)) {
    return { status: 402, message: `${who} account has no credit left. Add credit in the provider's billing settings, then retry.` };
  }
  if (err?.status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota|"code":\s*429/i.test(raw)) {
    return { status: 429, message: `${who} quota or rate limit reached for this API key. Check its billing and limits, then retry.` };
  }
  if (err?.status === 401 || /invalid.*api key|unauthori[sz]ed|incorrect api key/i.test(raw)) {
    return { status: 502, message: `${who} rejected the API key. Check it in .env.` };
  }
  if (err?.status === 404 || /model.*(not found|does not exist|no longer available)/i.test(raw)) {
    return { status: 502, message: `${who} does not offer "${info?.model}" to this API key. Pick another model.` };
  }
  return { status: 502, message: `AI model request failed: ${raw}` };
}
