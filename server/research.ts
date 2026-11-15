import { addUsage, readUrls, webSearch, type ModelInfo, type Usage, type WebSource } from './llm';
import { findApprovedReferences, type ApprovedReference, type RejectedReference } from './references';

export type ResearchSource = WebSource;

export interface ResearchInput {
  topic: string;
  audience?: string;
  tone?: string;
  referenceUrls?: string[];
  /** Sites or pages the client accepts as references. Research may use any site; references come only from these. */
  approvedSources?: string[];
  /** Distinct sources the article needs (the client's reference count); research searches again if short. */
  minSources?: number;
}

export interface ResearchResult {
  topic: string;
  brief: string;
  styleNotes?: string;
  sources: ResearchSource[];
  searchQueries: string[];
  createdAt: string;
  tokenUsage: Usage;
  /** Set when the reference articles could not be read; research still succeeded. */
  styleNotesError?: string;
  /** The client's approved list this research used, when there is one. */
  approvedSources?: string[];
  /** Pages on approved sites that were checked to cover the topic: the only allowed references. */
  approvedReferences?: ApprovedReference[];
  rejectedReferences?: RejectedReference[];
  approvedReferencesError?: string;
}

function researchPrompt({ topic, audience, tone }: ResearchInput): string {
  return `Research this blog topic using web search before answering: "${topic}"
Readers: ${audience || 'general readers'}. Tone of the final article: ${tone || 'clear and practical'}.

Produce a research brief in Markdown that a writer will rely on. Use only what you find in search results.

## What readers are really asking
The 6 to 10 concrete questions people search for on this topic, phrased as a reader would ask them.

## Key facts and figures
Bullet points. Each one states a specific finding with its number, who was studied (sample size, population), the source type (trial, review, guideline, manufacturer data) and the year. Include the limitation when the source states one, e.g. "only 5 of 60 participants were men".

## Official guidance
What named national or professional bodies relevant to the readers' country say (for UK readers: NHS, NICE, MHRA, GMC or the relevant royal college). Name the body and document.

## Where evidence is weak or disputed
Claims that are commonly made but poorly supported, and genuine disagreements.

## Common myths
Misconceptions with the evidence-based correction.

Rules: prefer primary and authoritative sources (peer-reviewed journals, PubMed, government and professional bodies) over blogs and forums. Prefer sources from the last 5 years. Never state a statistic you did not find. If you could not find solid evidence for a section, say so plainly.`;
}

function stylePrompt(urls: string[]): string {
  return `Read these example articles:
${urls.map((u) => `- ${u}`).join('\n')}

Describe their house style so another writer can match it without copying any text:
- heading style (e.g. every H2 is a reader question) and typical section order
- named callout boxes and recurring blocks (e.g. "Evidence Note", "Myth vs Fact" table, Key Takeaways, FAQs)
- how evidence is introduced in the prose and how references are formatted
- paragraph length, reading level, point of view (second person?) and hedging language
- byline, disclaimers and calls to action
- approximate length
Be concrete and brief. Bullet points only.`;
}

function moreSourcesPrompt(input: ResearchInput, have: ResearchSource[], missing: number): string {
  return `Find at least ${missing} MORE authoritative sources about: "${input.topic}"
Readers: ${input.audience || 'general readers'}.

Already found (do NOT use these again):
${have.map((s) => `- ${s.url}`).join('\n')}

Prefer UK clinical guidance (NHS, NICE, British Association of Dermatologists or the relevant UK body), systematic reviews and peer-reviewed studies on PubMed or PMC. Avoid clinic marketing pages and blogs.
For each new source, give 1 to 3 bullet points stating exactly what it says that is relevant, with numbers, study size and year where available. Use only what you find.`;
}

/** Appends a follow-up search to the brief, renumbering its [n] markers onto one combined source list. */
export function mergeFindings(
  brief: string,
  sources: ResearchSource[],
  moreText: string,
  moreSources: ResearchSource[]
): { brief: string; sources: ResearchSource[] } {
  const norm = (u: string) => u.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
  const all = [...sources];
  const idMap = new Map<number, number>();
  for (const s of moreSources) {
    const existing = all.find((x) => norm(x.url) === norm(s.url));
    if (existing) idMap.set(s.id, existing.id);
    else {
      const id = all.length + 1;
      all.push({ ...s, id });
      idMap.set(s.id, id);
    }
  }
  const renumbered = moreText.replace(/\[(\d+)\]/g, (m, n) => (idMap.has(Number(n)) ? `[${idMap.get(Number(n))}]` : m));
  return { brief: `${brief}\n\n## Additional sources\n${renumbered}`, sources: all };
}

export async function runResearch(
  info: ModelInfo,
  input: ResearchInput,
  timeoutMs: number
): Promise<ResearchResult> {
  const referenceUrls = (input.referenceUrls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  const timeout = () => AbortSignal.timeout(timeoutMs);

  const approved = (input.approvedSources || []).map((s) => s.trim()).filter(Boolean);
  // Research searches any site. Approved references are found and checked in parallel.
  // Style notes are a nice-to-have: a slow or blocked reference page must not sink the research.
  const [search, style, refs] = await Promise.allSettled([
    webSearch(info, researchPrompt(input), { signal: timeout() }),
    referenceUrls.length ? readUrls(info, stylePrompt(referenceUrls), timeout()) : Promise.resolve(null),
    approved.length
      ? findApprovedReferences(info, { topic: input.topic, audience: input.audience, approved, needed: input.minSources || 5 }, timeoutMs)
      : Promise.resolve(null),
  ]);

  if (search.status === 'rejected') throw search.reason;
  let { text: brief, sources, searchQueries, usage } = search.value;
  if (!brief.trim()) throw new Error('Web research returned an empty brief.');
  if (sources.length === 0) throw new Error('Web research found no sources for this topic. Try rephrasing it.');

  // The article needs enough distinct sources for the client's reference count; search again if short.
  // With an approved list, references come from there, so the general search needs no top-up.
  const needed = approved.length ? 0 : input.minSources || 0;
  for (let round = 0; round < 2 && sources.length < needed; round++) {
    try {
      const more = await webSearch(info, moreSourcesPrompt(input, sources, needed - sources.length), {
        signal: timeout(),
      });
      const merged = mergeFindings(brief, sources, more.text, more.sources);
      if (merged.sources.length === sources.length) break;
      ({ brief, sources } = merged);
      searchQueries = [...searchQueries, ...more.searchQueries];
      usage = addUsage(usage, more.usage);
    } catch {
      break; // Keep what we have; the layout check reports a short reference list honestly.
    }
  }

  const styleValue = style.status === 'fulfilled' ? style.value : null;
  const refValue = refs.status === 'fulfilled' ? refs.value : null;
  return {
    topic: input.topic,
    brief,
    styleNotes: styleValue?.text.trim() || undefined,
    styleNotesError:
      style.status === 'rejected' ? `Reference articles could not be read: ${style.reason?.message || style.reason}` : undefined,
    sources,
    searchQueries,
    createdAt: new Date().toISOString(),
    tokenUsage: addUsage(usage, styleValue?.usage, refValue?.usage),
    ...(approved.length
      ? {
          approvedSources: approved,
          approvedReferences: refValue?.references || [],
          rejectedReferences: refValue?.rejected || [],
          approvedReferencesError:
            refs.status === 'rejected' ? `Approved sites could not be searched: ${refs.reason?.message || refs.reason}` : undefined,
        }
      : {}),
  };
}

/** Appended to every pipeline step prompt once research exists for the session. */
export function researchContext(
  pack: Pick<ResearchResult, 'brief' | 'sources' | 'styleNotes' | 'createdAt' | 'approvedReferences'>
): string {
  const sourceList = pack.sources.map((s) => `[${s.id}] ${s.title}. ${s.url}`).join('\n');
  const style = pack.styleNotes ? `\n\n## House style to follow (learned from reference articles)\n${pack.styleNotes}` : '';
  const approved = pack.approvedReferences;
  const approvedList = approved?.length
    ? approved.map((r) => `[R${r.id}] ${r.title}. ${r.url}${r.note ? `\n    Says: ${r.note}` : ''}`).join('\n')
    : '(none found)';
  const referenceRules = approved
    ? `
## Approved references (pages on the client's approved sites, checked to cover this topic)
${approvedList}

## Reference rules
- The References list may contain ONLY the approved references above, with their exact URLs. Never list any other source, including the research pack sources.
- Prefer facts the approved references support, and name the organisation or study they come from.
- Facts from other research sources may be used as background, written without a citation.
- If there are fewer approved references than the reference count, list only those. Never invent or pad references.`
    : `
- Any reference you list must be one of the Sources above, with its exact URL. Never invent studies, authors, journals, figures or links.`;
  return `

---
## Research source pack (from web search, ${pack.createdAt.slice(0, 10)})
${pack.brief}

### Sources
${sourceList}${style}

## Evidence rules
- Base factual claims, statistics, study findings and guidance on the source pack above.${referenceRules}
- If a point needs evidence the pack does not contain, write it without a specific figure or citation.
- Do not show the [n] markers in reader-facing prose unless the article format calls for numbered citations.`;
}

function normaliseUrl(url: string): string {
  return url.replace(/[)\].,;:'"]+$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
}

/** URLs in generated text that did not come from research: likely hallucinated references. */
export function findUnverifiedUrls(text: string, sources: { url: string }[]): string[] {
  const known = new Set(sources.map((s) => normaliseUrl(s.url)));
  const found = text.match(/https?:\/\/[^\s<>()\]]+/g) || [];
  return [...new Set(found.filter((u) => !known.has(normaliseUrl(u))))];
}
