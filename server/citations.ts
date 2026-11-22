// Real citation details (authors, year, title, journal) for reference pages, so the writer copies a
// correct Harvard reference instead of guessing journals and years from a page title.
// PubMed and PMC come from NCBI's free E-utilities; other sites from their citation_* meta tags.

import { ncbiGet } from './ncbi';

export interface CitationMeta {
  authors: string[]; // "Surname, I.I."
  year?: string;
  title?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  /** "1463-6" or "152-160"; written out as a full range. */
  pages?: string;
  /** Organisation for pages without named authors, e.g. "NHS". */
  organisation?: string;
}

const ORGS: Record<string, string> = {
  'nhs.uk': 'NHS',
  'nice.org.uk': 'NICE',
  'gov.uk': 'GOV.UK',
  'bad.org.uk': 'British Association of Dermatologists',
  'baaps.org.uk': 'BAAPS',
  'bapras.org.uk': 'BAPRAS',
  'fda.gov': 'U.S. Food and Drug Administration',
  'asa.org.uk': 'Advertising Standards Authority',
  'cqc.org.uk': 'Care Quality Commission',
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** "McKnight B" or "McKnight BA" (PubMed) -> "McKnight, B.A." */
function fromPubmedName(name: string): string {
  const m = name.trim().match(/^(.*\S)\s+([A-Z]{1,4})$/);
  return m ? `${m[1]}, ${m[2].split('').join('.')}.` : name.trim();
}

/** "Smith, John A." or "John A. Smith" (meta tags) -> "Smith, J.A." */
function fromMetaName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  const [surname, given] = n.includes(',') ? n.split(/,\s*/, 2) : [n.split(' ').pop()!, n.split(' ').slice(0, -1).join(' ')];
  const initials = (given || '')
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((g) => `${g[0].toUpperCase()}.`)
    .join('');
  return initials ? `${surname}, ${initials}` : surname;
}

const yearOf = (s?: string) => s?.match(/\b(19|20)\d{2}\b/)?.[0];
const cleanTitle = (t?: string) => t?.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

/** Citation meta tags from a page's HTML (Highwire/Google Scholar tags used by most journals). */
export function metaFromHtml(html: string): CitationMeta | null {
  const tags = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0]);
  const values = (name: string) =>
    tags
      .filter((t) => new RegExp(`(name|property)=["']${name}["']`, 'i').test(t))
      .map((t) => t.match(/content=["']([^"']*)["']/i)?.[1]?.trim())
      .filter((v): v is string => Boolean(v));
  const authors = values('citation_author').map(fromMetaName);
  const title = values('citation_title')[0];
  if (!title && !authors.length) return null;
  return {
    authors,
    title: cleanTitle(title),
    year: yearOf(values('citation_publication_date')[0] || values('citation_date')[0] || values('citation_online_date')[0]),
    journal: values('citation_journal_title')[0],
    volume: values('citation_volume')[0],
    issue: values('citation_issue')[0],
    pages: [values('citation_firstpage')[0], values('citation_lastpage')[0]].filter(Boolean).join('-') || undefined,
  };
}

/** PubMed id or PMC number from a URL. */
export function ncbiId(url: string): { db: 'pubmed' | 'pmc'; id: string } | null {
  const pm = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
  if (pm) return { db: 'pubmed', id: pm[1] };
  const pmc = url.match(/(?:pmc\.ncbi\.nlm\.nih\.gov\/articles|ncbi\.nlm\.nih\.gov\/pmc\/articles)\/PMC(\d+)/i);
  return pmc ? { db: 'pmc', id: pmc[1] } : null;
}

/** Looks up PubMed and PMC records in one request per database. */
export async function ncbiMeta(urls: string[], signal?: AbortSignal): Promise<Map<string, CitationMeta>> {
  const out = new Map<string, CitationMeta>();
  for (const db of ['pubmed', 'pmc'] as const) {
    const wanted = urls.map((u) => ({ u, ref: ncbiId(u) })).filter((x) => x.ref?.db === db);
    if (!wanted.length) continue;
    try {
      const ids = [...new Set(wanted.map((w) => w.ref!.id))].join(',');
      const res = await ncbiGet('esummary.fcgi', { db, id: ids, retmode: 'json' }, signal);
      if (!res) continue;
      const result = (await res.json())?.result || {};
      for (const w of wanted) {
        const r = result[w.ref!.id];
        if (!r?.title) continue;
        out.set(w.u, {
          authors: (r.authors || []).filter((a: any) => a.authtype !== 'CollectiveName' || a.name).map((a: any) => fromPubmedName(a.name)),
          year: yearOf(r.pubdate) || yearOf(r.epubdate),
          title: cleanTitle(r.title),
          journal: r.fulljournalname || r.source,
          volume: r.volume || undefined,
          issue: r.issue || undefined,
          pages: r.pages || undefined,
        });
      }
    } catch {
      /* look-up is best effort */
    }
  }
  return out;
}

const titleCaseJournal = (j: string) =>
  j
    .replace(/(?<![\w'’])([a-z])([a-z]*)\b/g, (w, a, b) => (/^(of|and|the|in|for|on|de|la)$/.test(w) ? w : a.toUpperCase() + b))
    .replace(/^./, (c) => c.toUpperCase());

/** "1463-6" -> "1463–1466", "152-160" -> "152–160" (en dash, as in the samples). */
export function pageRange(pages: string): string {
  const m = pages.trim().match(/^(\w*?)(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return pages.trim();
  const [, prefix, start, end] = m;
  const full = end.length < start.length ? start.slice(0, start.length - end.length) + end : end;
  return `${prefix}${start}–${prefix}${full}`;
}

/**
 * Harvard reference in the clients' sample style:
 * articles  Surname, A. et al. (Year) ‘Title’, Journal, 16(2), pp. 152–160. Available at: URL
 * web pages Organisation (Year) Title. Available at: URL
 */
export function harvard(meta: CitationMeta | undefined, fallbackTitle: string, url: string): string {
  const org = meta?.organisation || ORGS[Object.keys(ORGS).find((d) => host(url) === d || host(url).endsWith(`.${d}`)) || ''];
  const a = meta?.authors || [];
  const who = a.length === 0 ? org || '' : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]} et al.`;
  const year = meta?.year || 'no date';
  const title = cleanTitle(meta?.title) || cleanTitle(fallbackTitle) || url;
  const lead = `${who ? `${who} ` : ''}(${year})`;
  if (!meta?.journal) return `${lead} ${title}${/[.?!]$/.test(title) ? '' : '.'} Available at: ${url}`;
  const journal = titleCaseJournal(meta.journal.replace(/\s*:.*$/, '').replace(/\.\s+/g, ' ').trim());
  const volume = meta.volume ? `, ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}` : '';
  const pages = meta.pages ? `, pp. ${pageRange(meta.pages)}` : '';
  return `${lead} ‘${title}’, ${journal}${volume}${pages}. Available at: ${url}`;
}

/** Adds a ready-to-copy Harvard citation to each source. Page meta can be passed in when already fetched. */
export async function withCitations<T extends { title: string; url: string }>(
  sources: T[],
  pageMeta: Map<string, CitationMeta | null> = new Map(),
  signal?: AbortSignal
): Promise<(T & { citation: string })[]> {
  const ncbi = await ncbiMeta(
    sources.map((s) => s.url),
    signal
  );
  return Promise.all(
    sources.map(async (s) => {
      const meta = ncbi.get(s.url) ?? pageMeta.get(s.url) ?? undefined;
      // Search results often give a PDF's first line as its title ("Treatment options:").
      const title = !meta?.title && brokenTitle(s.title) ? (await pdfTitle(s.url, signal)) || titleFromFileName(s.url) || s.title : s.title;
      return { ...s, citation: harvard(meta, title, s.url) };
    })
  );
}

const isPdf = (url: string) => /\.pdf($|[?#])/i.test(url);

/** A title that was cut off mid-phrase or is just a label. */
export function brokenTitle(title?: string): boolean {
  const t = (title || '').trim();
  return !t || t.split(/\s+/).length < 2 || /[:;,(\-–]$/.test(t) || /\b(to|of|and|the|for|a|an|in|with|on|or|by)\.?$/i.test(t);
}

/** "Intracorneal-Rings-0354.pdf" -> "Intracorneal Rings" */
export function titleFromFileName(url: string): string {
  // ".../1095-having-a-ring-to-treat-x/file": use the last descriptive segment, not "file".
  const segments = decodeURIComponent(url.split(/[?#]/)[0])
    .split('/')
    .filter((x) => /[a-z]/i.test(x) && !/^(file|download|view|index(\.\w+)?)$/i.test(x));
  const descriptive = [...segments].reverse().find((x) => x.replace(/\.pdf$/i, '').split(/[-_]+/).length >= 2) || segments.pop() || '';
  const name = descriptive
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(web|version|final|v\d+|\d{3,})\b/gi, ' ')
    .replace(/^\s*\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? name.replace(/^./, (c) => c.toUpperCase()) : '';
}

/** The title stored inside a PDF (Info dictionary or XMP), when it reads like a real title. */
async function pdfTitle(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, { signal, headers: { Range: 'bytes=0-400000', 'User-Agent': 'Mozilla/5.0 (compatible; BlogCraftReferenceCheck/1.0)' } });
    if (!res.ok || !(isPdf(url) || /pdf/i.test(res.headers.get('content-type') || ''))) return null;
    const text = new TextDecoder('latin1').decode(new Uint8Array(await res.arrayBuffer()).slice(0, 400000));
    const found = [
      text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/)?.[1],
      text.match(/\/Title\s*\(([^)]{3,200})\)/)?.[1],
    ]
      .map((t) => t?.replace(/\s+/g, ' ').trim())
      .find((t) => t && /\s/.test(t) && !/^[A-Z0-9_]+$/.test(t) && !/^(untitled|microsoft word|document\d*)/i.test(t));
    return found || null;
  } catch {
    return null;
  }
}
