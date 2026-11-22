// All calls to NCBI E-utilities (PubMed/PMC) go through here. NCBI allows 3 requests per second
// without an API key (10 with NCBI_API_KEY) and refuses bursts with HTTP 429, so requests are queued,
// spaced out and retried.

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const key = () => process.env.NCBI_API_KEY?.trim();
const gapMs = () => (key() ? 110 : 350);

let queue: Promise<unknown> = Promise.resolve();
let last = 0;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET an E-utilities endpoint, e.g. ncbiGet('esearch.fcgi', { db: 'pubmed', term: 'x' }). */
export function ncbiGet(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response | null> {
  const qs = new URLSearchParams({ ...params, tool: 'blogcraft', ...(key() ? { api_key: key()! } : {}) });
  const run = async (): Promise<Response | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = last + gapMs() - Date.now();
      if (delay > 0) await wait(delay);
      last = Date.now();
      try {
        const res = await fetch(`${BASE}/${path}?${qs}`, { signal });
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) return null;
      } catch (err) {
        if (signal?.aborted) return null;
      }
      await wait(1000 * (attempt + 1));
    }
    console.warn(`NCBI request failed after retries: ${path} ${params.term || params.id || ''}`.slice(0, 200));
    return null;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
