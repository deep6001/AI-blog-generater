// Finds primary studies on PubMed for a topic. Web search often misses them because brand names
// (e.g. "Exilis") rarely appear in abstracts, which describe the technology instead. The model writes
// technology-based PubMed queries, we run them on NCBI E-utilities, read the abstracts, and the model
// keeps only the studies that are really about the topic, noting their figures.

import { addUsage, generate, type ModelInfo, type Usage } from './llm';
import { ncbiGet } from './ncbi';

export interface PubmedStudy {
  pmid: string;
  title: string;
  url: string;
  /** Year, participants, protocol and main result, from the abstract. */
  note: string;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The first JSON value in a model reply. */
function parseJson<T>(text: string): T | null {
  const m = text.match(/[[{][\s\S]*[\]}]/);
  try {
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}

export async function searchPubmed(term: string, max: number, signal?: AbortSignal, sort: 'relevance' | 'pub_date' = 'relevance'): Promise<string[]> {
  const res = await ncbiGet('esearch.fcgi', { db: 'pubmed', retmode: 'json', sort, retmax: String(max), term }, signal);
  if (!res) return [];
  return (await res.json())?.esearchresult?.idlist || [];
}

/** Title, year and abstract for each PubMed id. */
export async function fetchAbstracts(
  pmids: string[],
  signal?: AbortSignal
): Promise<{ pmid: string; title: string; year: string; abstract: string }[]> {
  if (!pmids.length) return [];
  const res = await ncbiGet('efetch.fcgi', { db: 'pubmed', retmode: 'xml', id: pmids.join(',') }, signal);
  if (!res) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)].map(([, a]) => ({
    pmid: a.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] || '',
    title: decode(a.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] || ''),
    year: a.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] || a.match(/<Year>(\d{4})<\/Year>/)?.[1] || '',
    abstract: decode([...a.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => m[1]).join(' ')),
  }));
}

export async function findPubmedStudies(
  info: ModelInfo,
  topic: string,
  signal?: AbortSignal
): Promise<{ studies: PubmedStudy[]; queries: string[]; usage: Usage }> {
  const q = await generate(info, {
    prompt: `Write PubMed search queries to find clinical studies for this blog topic: "${topic}".

"exact": 2 queries using the exact term researchers use for the treatment or condition in the topic, aimed at the topic's specific question. For a procedure or condition name (e.g. "CAIRS", "keratoconus", "apalutamide") use that name, e.g. "CAIRS removal", "CAIRS explantation exchange". For a commercial brand that abstracts rarely mention (e.g. "Exilis Ultra 360"), use the generic technology name instead (e.g. "focused radiofrequency ultrasound").
"generic": 3 broader queries: the technology or treatment class with the body area or condition, with the outcome the topic is about, and the condition with "treatment" or "complications".
Plain keywords, at most 6 words each, no field tags.
Reply with only JSON: {"exact": ["...", "..."], "generic": ["...", "...", "..."]}`,
    temperature: 0.2,
    signal,
  });
  const parsed = parseJson<{ exact?: unknown[]; generic?: unknown[] } | string[]>(q.text);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
  const exact = Array.isArray(parsed) ? list(parsed).slice(0, 2) : list(parsed?.exact).slice(0, 2);
  const generic = Array.isArray(parsed) ? list(parsed).slice(2, 5) : list(parsed?.generic).slice(0, 3);
  const queries = [...exact, ...generic];
  if (!queries.length) return { studies: [], queries: [], usage: q.usage };

  // The exact-term searches run twice: most relevant, and newest first, so recent studies on the
  // topic's own question are not crowded out by older, broader papers.
  const searches = [
    ...exact.map((t) => searchPubmed(t, 6, signal, 'pub_date')),
    ...exact.map((t) => searchPubmed(t, 6, signal)),
    ...generic.map((t) => searchPubmed(t, 5, signal)),
    // Guidelines, systematic reviews and trials on the topic, which carry most weight for patients.
    ...exact.slice(0, 1).map((t) => searchPubmed(`(${t}) AND (systematic[sb] OR guideline[pt] OR randomized controlled trial[pt])`, 6, signal)),
  ];
  const ids = [...new Set((await Promise.all(searches.map((p) => p.catch(() => [] as string[])))).flat())].slice(0, 24);
  const papers = (await fetchAbstracts(ids, signal)).filter((p) => p.pmid && p.title);
  if (!papers.length) return { studies: [], queries, usage: q.usage };

  const pick = await generate(info, {
    prompt: `Blog topic: "${topic}"
Below are PubMed records. Keep only those that are genuinely useful evidence for this topic: studies of the same technology or treatment (or its earlier versions), on the same body area or problem, and reviews or guidance that discuss it directly. Leave out anything about other conditions, unrelated devices or other body areas.
Rank what you keep: guidelines and consensus statements first, then systematic reviews and meta-analyses (Cochrane above all), then randomised trials, then other studies. Within each, studies that answer the topic's own question come first. Keep at most 10, and start each note with the study type.

For each one you keep, write a note using ONLY the abstract: year, study type, number of participants (and how many were treated on the relevant area), protocol (sessions and interval), what was measured, the main result with its figures, and any limitation.

Reply with only a JSON array: [{"pmid": "...", "note": "..."}]. Reply [] if none qualify.

${papers.map((p) => `PMID ${p.pmid} (${p.year}): ${p.title}\n${p.abstract.slice(0, 900)}`).join('\n\n')}`,
    temperature: 0.1,
    signal,
  });
  const picked = parseJson<{ pmid: string; note: string }[]>(pick.text) || [];
  const byId = new Map(papers.map((p) => [p.pmid, p]));
  const studies = picked
    .filter((x) => x && byId.has(String(x.pmid)))
    .map((x) => {
      const p = byId.get(String(x.pmid))!;
      return { pmid: p.pmid, title: p.title, url: `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`, note: String(x.note || '').slice(0, 600) };
    });
  return { studies, queries, usage: addUsage(q.usage, pick.usage) };
}
