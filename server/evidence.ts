// How evidence is used in the text: specific figures, named guidance bodies and trials, a UK Guidance
// Note that cites real guidance, and every reference described where its point is made. Measured on the
// client's sample (like the "you" voice) so new articles match it.

/**
 * Statistics: percentages, "1 in 8", "one in five", study sizes like "3,420 women", durations and doses
 * from studies ("34.7 months", "four weekly sessions" is not counted), and hazard or odds ratios.
 */
const STAT =
  /\b\d+(?:\.\d+)?\s?(?:%|per cent)|\b\d+ in \d+\b|\bone in (?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+ (?:women|men|people|patients|participants|babies|births|deliveries|eyes|children|adults)\b|\b\d+(?:\.\d+)? (?:months|weeks|days|years|hours|mg|mmHg)\b|\b(?:hazard|odds|risk) ratio (?:of |was |\()?\d+(?:\.\d+)?|\bHR \d+(?:\.\d+)?/gi;

/** UK and international guidance bodies, and named trials or reviews. */
const BODY_NAMES =
  /\b(NICE|RCOG|RCOphth|RCP|RCS|NHS|MHRA|GMC|UKHSA|SIGN|Cochrane|WHO|BAUS|BAD|BAAPS|BAPRAS|EAU|ESMO|Royal College of [A-Z][a-z]+(?: (?:and|of) [A-Z][a-z]+| [A-Z][a-z]+)*|National Institute for Health and Care Excellence|British Association of [A-Z][a-z]+(?: (?:and|of) [A-Z][a-z]+| [A-Z][a-z]+)*)\b/g;
const TRIALS = /\b[A-Z][A-Z0-9-]{2,}\s+(?:trial|study|review)\b/g;

const ALIASES: [string, string][] = [
  ['Royal College of Obstetricians and Gynaecologists', 'RCOG'],
  ['National Institute for Health and Care Excellence', 'NICE'],
  ['Medicines and Healthcare products Regulatory Agency', 'MHRA'],
  ['UK Health Security Agency', 'UKHSA'],
  ['World Health Organization', 'WHO'],
  ['British Association of Dermatologists', 'BAD'],
  ['British Association of Urological Surgeons', 'BAUS'],
  ['Royal College of Ophthalmologists', 'RCOphth'],
];

const words = (t: string) => (t.match(/[A-Za-z’'][A-Za-z’'-]*/g) || []).length;
const count = (t: string, re: RegExp) => (t.match(new RegExp(re.source, re.flags)) || []).length;

export interface Evidence {
  /** Statistics per 1,000 words. */
  statsPer1000: number;
  /** Named guidance bodies, guidelines and trials per 1,000 words. */
  namedPer1000: number;
}

/** A sensible bar when the sample doesn't record its own (about 9 figures and 4 names in 3,000 words). */
export const DEFAULT_EVIDENCE: Evidence = { statsPer1000: 3, namedPer1000: 1.5 };

export function measureEvidence(text: string): Evidence | null {
  const n = words(text);
  if (n < 300) return null;
  const per1000 = (k: number) => Math.round((10000 * k) / n) / 10;
  return { statsPer1000: per1000(count(text, STAT)), namedPer1000: per1000(count(text, BODY_NAMES) + count(text, TRIALS)) };
}

export const evidenceLine = (e: Evidence) =>
  `[Evidence: ~${e.statsPer1000} statistics and ~${e.namedPer1000} named guidelines, bodies or trials per 1,000 words]`;

export function evidenceFromOutline(outline: string | null | undefined): Evidence | null {
  const m = outline?.match(/\[Evidence: ~([\d.]+) statistics and ~([\d.]+) named guidelines, bodies or trials per 1,000 words\]/);
  return m ? { statsPer1000: Number(m[1]), namedPer1000: Number(m[2]) } : null;
}

/** Instruction for the writer, for an article of about `targetWords`. */
export function evidenceRule(e: Evidence, targetWords: number): string {
  // Capped: past about 20 figures an article starts padding with numbers.
  const stats = Math.min(20, Math.max(6, Math.round((e.statsPer1000 * targetWords) / 1000)));
  const named = Math.min(15, Math.max(3, Math.round((e.namedPer1000 * targetWords) / 1000)));
  return `Use specific figures like the client's sample: about ${stats} statistics across the article (rates, percentages, "1 in 8", study sizes such as "3,420 women"), including real figures in the comparison table. Name the guidance and evidence you rely on about ${named} times (e.g. "RCOG guidance advises", "NICE recommends", "the ANODE trial found", "a Cochrane review of 31 trials"). Describe every reference where its point is made, by its guideline, trial or lead author, so no reference is listed without being used in the text.`;
}

/** Reference priority for UK patient articles. */
export const REFERENCE_PRIORITY =
  'Choose references in this order of preference: UK national guidance (NICE, the relevant royal college such as RCOG, NHS, MHRA), then systematic reviews (Cochrane), then randomised trials, then other studies. Prefer UK sources for UK readers; use individual hospital or overseas cohort studies only to add figures that guidance and reviews do not give.';

/** What kind of source a reference is, to show the writer next to each one. */
export function sourceKind(url: string, title = ''): string {
  const t = `${url} ${title}`;
  if (/nice\.org\.uk|rcog\.org\.uk|rcophth\.ac\.uk|rcplondon\.ac\.uk|nhs\.uk|gov\.uk|sign\.ac\.uk|who\.int|bad\.org\.uk|baus\.org\.uk/i.test(url) || /green-top|guideline|guidance|National Institute for Health and Care Excellence|Royal College of|NHS England/i.test(title)) {
    return 'guidance';
  }
  if (/cochranelibrary|cochrane/i.test(t) || /systematic review|meta-analysis/i.test(title)) return 'systematic review';
  if (/randomi[sz]ed|controlled trial|\btrial\b/i.test(title)) return 'trial';
  return /pubmed|pmc\.ncbi|doi\.org|journal|sciencedirect|mdpi|springer|wiley|oup\.com|bmj\.com|thelancet/i.test(url) ? 'study' : 'web page';
}

/** Ways a reference can be named in the text: lead author, organisation (full or acronym), trial acronym. */
export function referenceNames(ref: string): string[] {
  const names = new Set<string>();
  const lead = ref.replace(/^\d+[.)]\s*/, '').split(/\s*\(\s*(?:\d{4}|no date|n\.d\.)/i)[0].trim();
  const surname = lead.split(/,| and | et al/)[0].trim();
  if (surname && !/^(NHS|NICE)$/.test(surname)) names.add(surname);
  for (const [full, short] of ALIASES) {
    if (ref.includes(full) || new RegExp(`\\b${short}\\b`).test(ref)) {
      names.add(full);
      names.add(short);
    }
  }
  if (/^NHS\b/.test(lead)) names.add('NHS');
  if (/^NICE\b/.test(lead)) names.add('NICE');
  for (const m of ref.matchAll(/\b([A-Z][A-Z0-9-]{3,})\b/g)) if (!/^(NHS|NICE|RCOG|PMID|HTTPS?|DOI)$/.test(m[1])) names.add(m[1]);
  return [...names].filter((n) => n.length > 2);
}

/**
 * Evidence problems: too few figures or named sources for the sample, a UK Guidance Note that names
 * no guidance, and references never described in the text.
 */
export function evidenceIssues(markdown: string, target: Evidence | null): string[] {
  const issues: string[] = [];
  if (!target) return issues;
  const e = target;
  const [bodyPart, refsPart = ''] = markdown.replace(/\r\n/g, '\n').split(/\n(?=#{1,3}\s+References:?\s*$)/im);
  const n = words(bodyPart);
  const stats = count(bodyPart, STAT);
  const named = count(bodyPart, BODY_NAMES) + count(bodyPart, TRIALS);
  const wantStats = Math.min(15, Math.max(5, Math.round(((e.statsPer1000 * n) / 1000) * 0.6)));
  const wantNamed = Math.min(8, Math.max(3, Math.round(((e.namedPer1000 * n) / 1000) * 0.5)));
  if (stats < wantStats) {
    issues.push(
      `Use more specific figures from the research, as the sample does: this article has ${stats} statistics; give at least ${wantStats} (rates, percentages, "1 in 8", study sizes), especially in the risks, comparison and recovery sections and the table.`
    );
  }
  if (named < wantNamed) {
    issues.push(
      `Name the guidance and evidence you rely on, as the sample does: this article names guidance bodies, guidelines or trials ${named} time${named === 1 ? '' : 's'}; name them at least ${wantNamed} times (e.g. "RCOG guidance advises", "NICE recommends", "the ANODE trial found").`
    );
  }
  const ukNote = bodyPart.match(/^\*\*UK Guidance Note\*\*:?\s*\n([\s\S]*?)(?=\n\*\*[^*\n]+\*\*:?\s*\n|\n##\s|(?![\s\S]))/im)?.[1];
  if (ukNote !== undefined && !new RegExp(BODY_NAMES.source).test(ukNote)) {
    issues.push('The UK Guidance Note must cite real UK guidance by name (e.g. "RCOG Green-top Guideline No. 26", "NICE guideline NG194") and say what it recommends.');
  }
  const refs = refsPart.split('\n').filter((l) => /^\s*\d+[.)]\s/.test(l));
  const unused = refs.filter((r) => !referenceNames(r).some((name) => bodyPart.includes(name)));
  if (unused.length) {
    issues.push(
      `Describe each reference in the text where its point is made, by its guideline, trial or lead author (e.g. "RCOG guidance advises…", "the ANODE trial found…", "a 2022 Canadian study led by Muraca…"). Not mentioned in the text: ${unused
        .map((r) => r.replace(/^\s*\d+[.)]\s*/, '').slice(0, 90))
        .join(' | ')}.`
    );
  }
  return issues;
}
