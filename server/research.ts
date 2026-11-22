import { addUsage, readUrls, webSearch, type ModelInfo, type Usage, type WebSource } from './llm';
import { findApprovedReferences, type ApprovedReference, type RejectedReference } from './references';
import { withCitations } from './citations';
import { findPubmedStudies } from './pubmed';

export type ResearchSource = WebSource & { citation?: string };

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

## Primary studies on this exact treatment
Search specifically for original studies (trials, case series, cohort studies) of the exact device, product or treatment named in the topic, including earlier versions of the same device. For each: first author and year, journal, number of participants and how many were treated on the area the topic is about, the protocol (number of sessions and interval), what was measured, the main result with its figures, and the limitations. If there are none for the exact treatment, say so and name the closest studies.

## Key facts and figures
Bullet points. Each one states a specific finding with its number, who was studied (sample size, population), the source type (trial, review, guideline, manufacturer data) and the year. Include the limitation when the source states one, e.g. "only 5 of 60 participants were men".

## Official guidance
What named national or professional bodies relevant to the readers' country say (for UK readers: NHS, NICE, MHRA, GMC or the relevant royal college). Name the body and document.

## Where evidence is weak or disputed
Claims that are commonly made but poorly supported, and genuine disagreements.

## Common myths
Misconceptions with the evidence-based correction.

Use 2 to 4 well-chosen searches, not more.
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
  const [search, style, refs, pubmed] = await Promise.allSettled([
    webSearch(info, researchPrompt(input), { signal: timeout() }),
    referenceUrls.length ? readUrls(info, stylePrompt(referenceUrls), timeout()) : Promise.resolve(null),
    approved.length
      ? findApprovedReferences(info, { topic: input.topic, audience: input.audience, approved, needed: input.minSources || 5 }, timeoutMs)
      : Promise.resolve(null),
    // Without an approved list, references come from research, so look up primary studies on PubMed too.
    approved.length ? Promise.resolve(null) : findPubmedStudies(info, input.topic, timeout()),
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

  const studies = pubmed.status === 'fulfilled' ? pubmed.value : null;
  if (studies?.studies.length) {
    const more = studies.studies.map((st, i) => ({ id: i + 1, title: st.title, url: st.url, domain: 'pubmed.ncbi.nlm.nih.gov' }));
    const text = studies.studies.map((st, i) => `- ${st.title}: ${st.note} [${i + 1}]`).join('\n');
    ({ brief, sources } = mergeFindings(brief, sources, text, more));
    brief = brief.replace('## Additional sources', '## Primary studies from PubMed');
    searchQueries = [...searchQueries, ...studies.queries.map((q) => `PubMed: ${q}`)];
    usage = addUsage(usage, studies.usage);
  }

  // Real authors, year and journal for PubMed and PMC sources, so references are not guessed.
  if (!approved.length) sources = await withCitations(sources, new Map(), AbortSignal.timeout(15000)).catch(() => sources);

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
  const cite = (c?: string) => (c ? `\n    Cite as: ${c}` : '');
  const sourceList = pack.sources.map((s) => `[${s.id}] ${s.title}. ${s.url}${cite(s.citation)}`).join('\n');
  const style = pack.styleNotes ? `\n\n## House style to follow (learned from reference articles)\n${pack.styleNotes}` : '';
  const approved = pack.approvedReferences;
  const approvedList = approved?.length
    ? approved.map((r) => `[R${r.id}] ${r.title}. ${r.url}${cite(r.citation)}${r.note ? `\n    Says: ${r.note}` : ''}`).join('\n')
    : '(none found)';
  const referenceRules = approved
    ? `
## Approved references (pages on the client's approved sites, checked to cover this topic)
${approvedList}

## Reference rules
- The References list may contain ONLY the approved references above, with their exact URLs. Never list any other source, including the research pack sources.
- For each reference, copy its "Cite as" text exactly. Never change or guess authors, years or journal names.
- Prefer facts the approved references support, and name the organisation or study they come from.
- Facts from other research sources may be used as background, written without a citation.
- If there are fewer approved references than the reference count, list only those. Never invent or pad references.`
    : `
- Any reference you list must be one of the Sources above, with its exact URL. Never invent studies, authors, journals, figures or links.
- Where a source has a "Cite as" line, copy it exactly as that reference. Never guess authors, years or journal names.`;
  return `

---
## Research source pack (from web search, ${pack.createdAt.slice(0, 10)})
${pack.brief}

### Sources
${sourceList}${style}

## Evidence rules
- Base factual claims, statistics, study findings and guidance on the source pack above.${referenceRules}
- When you describe a study (especially in an Evidence Note or Research Insight), give its year, size and main figures from the pack, e.g. "a 2017 study of 34 people, 7 treated on the arms". Never write only "a small study".
- Say each point once. Do not repeat the same study, caveat or warning in several sections. Give the reader the answer instead of only telling them to ask a practitioner.
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
