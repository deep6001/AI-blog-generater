// Finds primary studies on PubMed for a topic. Web search often misses them because brand names
// (e.g. "Exilis") rarely appear in abstracts, which describe the technology instead. The model writes
// technology-based PubMed queries, we run them on NCBI E-utilities, read the abstracts, and the model
// keeps only the studies that are really about the topic, noting their figures.

import { addUsage, generate, type ModelInfo, type Usage } from './llm';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

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

export async function searchPubmed(term: string, max: number, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${max}&term=${encodeURIComponent(term)}`, { signal });
  if (!res.ok) return [];
  return (await res.json())?.esearchresult?.idlist || [];
}

/** Title, year and abstract for each PubMed id. */
export async function fetchAbstracts(
  pmids: string[],
  signal?: AbortSignal
): Promise<{ pmid: string; title: string; year: string; abstract: string }[]> {
  if (!pmids.length) return [];
  const res = await fetch(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(',')}`, { signal });
  if (!res.ok) return [];
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
    prompt: `Write 5 PubMed search queries to find original clinical studies for this blog topic: "${topic}".
Brand and device names rarely appear in abstracts, so describe the technology generically (e.g. a branded device combining radiofrequency and ultrasound becomes "focused radiofrequency ultrasound").
1. the generic technology + the body area or condition
2. the generic technology + "skin laxity" or the outcome the topic is about
3. the generic technology alone
4. the generic technology + "body contouring" or the closest treatment category
5. the body area or condition + "non-invasive treatment"
Never use the brand name on its own. Plain keywords, at most 6 words each, no field tags.
Reply with only a JSON array of 5 strings.`,
    temperature: 0.2,
    signal,
  });
  const queries = (parseJson<string[]>(q.text) || []).filter((s) => typeof s === 'string').slice(0, 5);
  if (!queries.length) return { studies: [], queries: [], usage: q.usage };

  const ids = [...new Set((await Promise.all(queries.map((t) => searchPubmed(t, 8, signal).catch(() => [])))).flat())].slice(0, 30);
  const papers = (await fetchAbstracts(ids, signal)).filter((p) => p.pmid && p.title);
  if (!papers.length) return { studies: [], queries, usage: q.usage };

  const pick = await generate(info, {
    prompt: `Blog topic: "${topic}"
Below are PubMed records. Keep only those that are genuinely useful evidence for this topic: studies of the same technology or treatment (or its earlier versions), on the same body area or problem, and reviews or guidance that discuss it directly. Leave out anything about other conditions, unrelated devices or other body areas.

For each one you keep, write a note using ONLY the abstract: year, study type, number of participants (and how many were treated on the relevant area), protocol (sessions and interval), what was measured, the main result with its figures, and any limitation.

Reply with only a JSON array: [{"pmid": "...", "note": "..."}]. Reply [] if none qualify.

${papers.map((p) => `PMID ${p.pmid} (${p.year}): ${p.title}\n${p.abstract.slice(0, 1200)}`).join('\n\n')}`,
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
