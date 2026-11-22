import { addUsage, webSearch, type ModelInfo, type Usage, type WebSource } from './llm';
import { metaFromHtml, withCitations, type CitationMeta } from './citations';
import { findPubmedStudies } from './pubmed';

/** A page on one of the client's approved sites that was checked to cover the topic. */
export interface ApprovedReference extends WebSource {
  /** page: we opened the page and found the topic; search: the site blocks direct reads, but search cited it for this topic. */
  checkedBy: 'page' | 'abstract' | 'search';
  matchedTerms: string[];
  /** What the page says about the topic, from the search. */
  note?: string;
  /** Ready-to-copy Harvard reference built from the page's real authors, year and journal. */
  citation?: string;
}

export interface RejectedReference {
  url: string;
  title?: string;
  reason: string;
}

export interface ApprovedReferenceResult {
  references: ApprovedReference[];
  rejected: RejectedReference[];
  searchQueries: string[];
  usage: Usage;
}

const STOPWORDS = new Set(
  `a an and are as at be best better by can do does for from good guide how i in is it its me my of on or really right safe should than that the this to vs what when which who why will with work works you your
  about after before during into over under can't cannot really actually complete ultimate uk`.split(/\s+/)
);

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, '');

function normUrl(url: string): string {
  return url.trim().replace(/[#?].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
}

/** Splits the client's list into whole sites and specific pages or sections. */
export function parseApproved(list: string[]): { domains: string[]; prefixes: string[] } {
  const domains = new Set<string>();
  const prefixes = new Set<string>();
  for (const raw of list) {
    const entry = raw.trim();
    if (!entry) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`);
      if (u.pathname.replace(/\/+$/, '') === '') domains.add(stripWww(u.hostname));
      else prefixes.add(normUrl(u.href));
    } catch {
      /* not a site or URL */
    }
  }
  return { domains: [...domains], prefixes: [...prefixes] };
}

/** True when a URL is on an approved site, or inside an approved page or section. */
export function isApproved(url: string, approved: string[]): boolean {
  let host: string;
  try {
    host = stripWww(new URL(url).hostname);
  } catch {
    return false;
  }
  const { domains, prefixes } = parseApproved(approved);
  const n = normUrl(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`)) || prefixes.some((p) => n === p || n.startsWith(`${p}/`));
}

/** The words that say what the topic is about, without question filler. */
export function topicTerms(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

/** Does the page text discuss the topic or a closely related one? At least half the topic terms must appear. */
export function pageCoversTopic(text: string, terms: string[]): { covers: boolean; matched: string[] } {
  const hay = text.toLowerCase();
  const matched = terms.filter((t) => {
    const stem = t.length > 4 ? t.replace(/(es|s)$/, '') : t;
    return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay);
  });
  return { covers: terms.length > 0 && matched.length >= Math.max(1, Math.ceil(terms.length / 2)), matched };
}

/** Opens a page and returns its title and readable text, or null if it cannot be read as HTML. */
export async function fetchPageText(
  url: string,
  signal?: AbortSignal
): Promise<{ title: string; text: string; meta: CitationMeta | null } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlogCraftReferenceCheck/1.0)', Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok || !/html|xml/i.test(res.headers.get('content-type') || '')) return null;
    const html = (await res.text()).slice(0, 3_000_000);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
    const text = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
    return text.length > 200 ? { title, text, meta: metaFromHtml(html) } : null;
  } catch {
    return null;
  }
}

function searchPrompt(topic: string, audience: string | undefined, domains: string[], have: string[], needed: number): string {
  return `Search ONLY these websites (use site: queries): ${domains.join(', ')}
Find at least ${needed} different pages on them that discuss: "${topic}", or the closest related subject they cover (the condition, treatment or question behind the topic).
Look FIRST for original studies (trials, case series, cohort studies) of the exact device, product or treatment named in the topic, including studies of earlier versions of it. Then systematic reviews and official guidance.
Readers: ${audience || 'general readers'}.
${have.length ? `Already found, do NOT return these again:\n${have.map((u) => `- ${u}`).join('\n')}\n` : ''}
Use at most 5 searches.
For each page, write one bullet: the page title, then exactly what it says that is relevant. For a study give the year, number of participants (and how many were treated on the relevant area), the protocol (sessions and intervals), what was measured, the main result with its figures, and its limitations. Use only what the pages say. Do not use any other website.`;
}

/** Notes per URL from the search answer: the line each citation appears in. */
function notesBySource(text: string, sources: WebSource[]): Map<string, string> {
  const notes = new Map<string, string>();
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/\[(\d+)\]/g)) {
      const src = sources.find((s) => s.id === Number(m[1]));
      if (src && !notes.has(src.url)) notes.set(src.url, line.replace(/\[\d+\]/g, '').replace(/^[-*\s]+/, '').trim().slice(0, 300));
    }
  }
  return notes;
}

/**
 * Finds references for the article on the client's approved sites only, then opens each page
 * to confirm the topic (or a closely related one) is really there.
 */
export async function findApprovedReferences(
  info: ModelInfo,
  input: { topic: string; audience?: string; approved: string[]; needed: number },
  timeoutMs: number
): Promise<ApprovedReferenceResult> {
  const { domains, prefixes } = parseApproved(input.approved);
  const allDomains = [...new Set([...domains, ...prefixes.map((p) => p.split('/')[0])])];
  // PubMed and PMC are covered by the free PubMed look-up below, so the paid web search skips them.
  const pubmedApproved = isApproved('https://pubmed.ncbi.nlm.nih.gov/1/', input.approved);
  const NCBI = /(^|\.)ncbi\.nlm\.nih\.gov$/;
  // Journal publishers' medical papers are indexed on PubMed too, so the free look-up finds them.
  const JOURNALS =
    /(^|\.)(mdpi\.com|sciencedirect\.com|academic\.oup\.com|springer\.com|link\.springer\.com|onlinelibrary\.wiley\.com|tandfonline\.com|bmj\.com|thelancet\.com|nature\.com|frontiersin\.org|jamanetwork\.com|nejm\.org|journals\.lww\.com|karger\.com|cambridge\.org|sagepub\.com|cureus\.com|plos\.org|journals\.plos\.org)$/;
  const searchDomains = pubmedApproved ? allDomains.filter((d) => !NCBI.test(d) && !JOURNALS.test(d)) : allDomains;
  const terms = topicTerms(input.topic);
  const candidates = new Map<string, { title: string; url: string; domain: string; note?: string; fromSearch: boolean; abstract?: boolean }>();
  const searchQueries: string[] = [];
  const rejected: RejectedReference[] = [];
  let usage: Usage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

  // Specific pages the client listed are always candidates.
  for (const raw of input.approved) {
    if (!/^https?:\/\//i.test(raw.trim()) || !parseApproved([raw]).prefixes.length) continue;
    const url = raw.trim();
    candidates.set(normUrl(url), { title: url, url, domain: stripWww(new URL(url).hostname), fromSearch: false });
  }

  // Primary studies straight from PubMed, when the client accepts PubMed. Runs alongside the web search.
  const pubmed = pubmedApproved
    ? findPubmedStudies(info, input.topic, AbortSignal.timeout(timeoutMs)).catch((err) => {
        console.warn('PubMed study search failed:', err?.message || err);
        return null;
      })
    : Promise.resolve(null);

  // A couple of spare pages, since some fail the topic check. With PubMed supplying studies, one round is enough.
  const target = Math.max(input.needed, 3) + (pubmedApproved ? 1 : 3);
  const rounds = pubmedApproved ? 1 : 2;
  for (let round = 0; round < rounds && searchDomains.length; round++) {
    const found = [...candidates.values()].filter((c) => c.fromSearch).length;
    if (found >= target) break;
    try {
      const res = await webSearch(
        info,
        searchPrompt(input.topic, input.audience, searchDomains, [...candidates.values()].map((c) => c.url), target - found),
        { allowedDomains: searchDomains, signal: AbortSignal.timeout(timeoutMs) }
      );
      usage = addUsage(usage, res.usage);
      searchQueries.push(...res.searchQueries);
      const notes = notesBySource(res.text, res.sources);
      let added = 0;
      for (const s of res.sources) {
        const key = normUrl(s.url);
        if (candidates.has(key)) continue;
        if (!isApproved(s.url, input.approved)) {
          rejected.push({ url: s.url, title: s.title, reason: 'Not on an approved site.' });
          continue;
        }
        candidates.set(key, { title: s.title, url: s.url, domain: s.domain, note: notes.get(s.url), fromSearch: true });
        added++;
      }
      if (!added) break;
    } catch (err) {
      if (round === 0 && !candidates.size) throw err;
      break;
    }
  }

  const studies = await pubmed;
  if (studies) {
    usage = addUsage(usage, studies.usage);
    searchQueries.push(...studies.queries.map((q) => `PubMed: ${q}`));
    for (const st of studies.studies) {
      const key = normUrl(st.url);
      const existing = candidates.get(key);
      candidates.set(key, { ...(existing || {}), title: st.title, url: st.url, domain: 'pubmed.ncbi.nlm.nih.gov', note: st.note, fromSearch: true, abstract: true });
    }
  }

  // Open every candidate and confirm the topic is on the page.
  // PubMed studies were already checked by reading their abstracts.
  const pageMeta = new Map<string, CitationMeta | null>();
  const signal = AbortSignal.timeout(Math.min(timeoutMs, 30000));
  const checked = await Promise.all(
    [...candidates.values()].slice(0, 20).map(async (c) => {
      if (c.abstract) return { ref: { ...c, checkedBy: 'abstract' as const, matchedTerms: [] } };
      const page = await fetchPageText(c.url, signal);
      if (page) pageMeta.set(c.url, page.meta);
      if (page) {
        const { covers, matched } = pageCoversTopic(`${page.title} ${page.text}`, terms);
        if (covers) {
          const title = c.title && c.title !== c.url ? c.title : page.title || c.url;
          return { ref: { ...c, title, checkedBy: 'page' as const, matchedTerms: matched } };
        }
        return { reject: { url: c.url, title: page.title || c.title, reason: `Page does not discuss the topic (matched ${matched.join(', ') || 'no topic words'}).` } };
      }
      // Some approved sites block automated reads; trust a page the search engine cited for this topic.
      if (c.fromSearch) return { ref: { ...c, checkedBy: 'search' as const, matchedTerms: [] } };
      return { reject: { url: c.url, title: c.title, reason: 'Page could not be opened to check it.' } };
    })
  );

  const references: ApprovedReference[] = [];
  for (const r of checked) {
    if (r.reject) rejected.push(r.reject);
    if (r.ref) {
      const { fromSearch: _f, abstract: _a, ...rest } = r.ref as typeof r.ref & { abstract?: boolean };
      references.push({ ...rest, id: references.length + 1 });
    }
  }
  // Studies checked from their abstracts and pages confirmed by opening them come first.
  const rank = { abstract: 0, page: 1, search: 2 };
  references.sort((a, b) => rank[a.checkedBy] - rank[b.checkedBy]);
  references.forEach((r, i) => (r.id = i + 1));
  const cited = await withCitations(references, pageMeta, AbortSignal.timeout(15000));
  return { references: cited, rejected, searchQueries, usage };
}
