import { isApproved } from './references';
import { describeBlocks, patternsFromOutline, patternsText, type PatternBlock, type SamplePatterns, type SectionPattern } from './samplePatterns';
// Checks a finished article against the client's sample template and word range, and builds the
// instructions for a correction pass. The checks are deterministic so the model can't "agree"
// that it followed the format when it didn't. Body sections are compared with the sample's exact
// section patterns, so a layout the sample never uses is caught even if no rule names it.

export type BlockKind = 'para' | 'table' | 'bullets' | 'numbered' | 'faq' | 'callout';

export interface Section {
  heading: string;
  blocks: { kind: BlockKind; label?: string; leadIn?: boolean; cols?: number; items?: number }[];
}

export interface LayoutSpec {
  minWords: number;
  maxWords: number;
  callouts: string[];
  /** Closing sections in order, with the only block kinds each may contain. */
  closing: { heading: string; kinds: BlockKind[] }[];
  faqCount: number;
  /** Paragraphs that follow each callout label in the sample. */
  calloutParas: number;
  /** The sample's exact intro and body section patterns. */
  patterns: SamplePatterns;
  /** Exact References heading text used by the sample, e.g. "References:". */
  referencesHeading: string;
  minReferences: number;
  noDoiLinks: boolean;
  internalLinkUrls: string[];
  /** Client-approved sites or pages; when set, every reference must come from them. */
  approvedSources?: string[];
}

type SpecBase = Omit<
  LayoutSpec,
  'callouts' | 'closing' | 'faqCount' | 'calloutParas' | 'patterns' | 'referencesHeading'
>;

export interface LayoutReport {
  wordCount: number;
  issues: string[];
}

const KIND_NAMES: Record<BlockKind, string> = {
  para: 'paragraph',
  table: 'table',
  bullets: 'bulleted list',
  numbered: 'numbered list',
  faq: 'FAQ item',
  callout: 'callout label',
};

const isReferencesHeading = (h: string) => /^references:?$/i.test(h.trim());
const CLOSING_ORDER = ['Myth vs Fact', 'Key Takeaways', 'Frequently Asked Questions', 'Final Thoughts', 'References'];

/** Words in the article, excluding the References section (the range the client defines). */
export function countWords(markdown: string): number {
  const body = markdown.split(/\n(?=#{1,3}\s+References:?\s*$)/im)[0];
  const plain = body
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/[#*_>|`]/g, ' ');
  return (plain.match(/[\p{L}\p{N}][\p{L}\p{N}’'.,%–-]*/gu) || []).length;
}

const BOLD_ONLY = /^\*\*([^*]+?)\*\*:?$/;
const isQuestion = (t: string) => /^\d+[.)]\s/.test(t) || /\?$/.test(t);

/** Splits Markdown into "## " sections and classifies their blocks. */
export function parseSections(markdown: string): Section[] {
  const sections: Section[] = [{ heading: '', blocks: [] }];
  const groups: string[][] = [];
  let current: string[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const pushGroup = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  const classify = (group: string[]) => {
    const sec = sections[sections.length - 1];
    const first = group[0].trim();
    if (first.startsWith('|')) {
      return sec.blocks.push({ kind: 'table', cols: first.replace(/^\||\|$/g, '').split('|').length });
    }
    const items = group.filter((l) => /^\s*([-*+]|\d+[.)])\s/.test(l));
    if (/^[-*+]\s/.test(first)) {
      return sec.blocks.push({ kind: 'bullets', leadIn: items.every((l) => /^\s*[-*+]\s+\*\*[^*]+\*\*/.test(l)), items: items.length });
    }
    if (/^\d+[.)]\s/.test(first)) return sec.blocks.push({ kind: 'numbered', items: items.length });
    if (first.startsWith('>')) {
      const label = first.replace(/^>\s*/, '').match(/^\*\*([^*]+?):?\*\*/)?.[1];
      sec.blocks.push(label ? { kind: 'callout', label: label.replace(/:$/, '') } : { kind: 'para' });
      if (group.length > 1 || first.replace(/^>\s*\*\*[^*]+\*\*:?/, '').trim()) sec.blocks.push({ kind: 'para' });
      return;
    }
    const bold = first.match(BOLD_ONLY);
    if (bold && isQuestion(bold[1].trim())) return sec.blocks.push({ kind: 'faq' });
    if (bold) {
      sec.blocks.push({ kind: 'callout', label: bold[1].replace(/:$/, '').trim() });
      if (group.length > 1) sec.blocks.push({ kind: 'para' });
      return;
    }
    sec.blocks.push({ kind: 'para' });
  };

  for (const line of lines) {
    const t = line.trim();
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      pushGroup();
      groups.forEach(classify);
      groups.length = 0;
      if (h[1] === '#') continue;
      if (h[1] === '###' && /^\d+[.)]\s|\?$/.test(h[2].replace(/\*\*/g, '').trim())) {
        // "### 1. Question?" FAQ style counts as an FAQ item.
        sections[sections.length - 1].blocks.push({ kind: 'faq' });
        continue;
      }
      if (h[1] === '###') continue;
      sections.push({ heading: h[2].replace(/\*\*/g, '').trim(), blocks: [] });
      continue;
    }
    if (!t) {
      pushGroup();
      continue;
    }
    // A list or table directly after text starts a new block.
    const startsStructure = /^(\||[-*+]\s|\d+[.)]\s|>)/.test(t);
    const prev = current[current.length - 1]?.trim() ?? '';
    const prevStructure = /^(\||[-*+]\s|\d+[.)]\s|>)/.test(prev);
    if (current.length && startsStructure !== prevStructure && !(prev.match(BOLD_ONLY) && !startsStructure)) pushGroup();
    current.push(line);
  }
  pushGroup();
  groups.forEach(classify);
  // An FAQ answer is part of its question, not a separate paragraph.
  for (const s of sections) {
    s.blocks = s.blocks.filter((b, i, arr) => !(b.kind === 'para' && arr[i - 1]?.kind === 'faq' && arr[i - 1] !== b));
  }
  return sections;
}

const closingKey = (heading: string) => CLOSING_ORDER.find((c) => heading.toLowerCase().startsWith(c.toLowerCase()));

/** Reads the template outline produced by sampleDoc.ts into a spec. */
const mostCommon = (values: number[], fallback: number) => {
  const freq = new Map<number, number>();
  values.forEach((n) => freq.set(n, (freq.get(n) || 0) + 1));
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? fallback;
};

export function specFromOutline(outline: string | null | undefined, base: SpecBase): LayoutSpec {
  const defaults: LayoutSpec = {
    ...base,
    callouts: ['Clinical Note', 'UK Guidance Note', 'Evidence Note', 'Research Insight'],
    closing: [
      { heading: 'Myth vs Fact', kinds: ['table'] },
      { heading: 'Key Takeaways', kinds: ['bullets'] },
      { heading: 'Frequently Asked Questions', kinds: ['faq'] },
      { heading: 'Final Thoughts', kinds: ['para', 'para'] },
      { heading: 'References', kinds: ['numbered'] },
    ],
    faqCount: 10,
    calloutParas: 2,
    patterns: patternsFromOutline(null),
    referencesHeading: 'References:',
  };
  if (!outline) return defaults;

  const lines = outline.split('\n');
  const callouts = [...new Set(lines.map((l) => l.match(/^\*\*(.+?)\*\*/)?.[1]).filter((x): x is string => Boolean(x)))];
  const calloutRuns: number[] = [];
  const closing: LayoutSpec['closing'] = [];
  let faqCount = defaults.faqCount;
  let referencesHeading = defaults.referencesHeading;
  let inClosing: LayoutSpec['closing'][number] | null = null;

  for (const [i, l] of lines.entries()) {
    const h = l.match(/^##\s+(.*)$/);
    if (h) {
      const key = closingKey(h[1]);
      inClosing = key ? { heading: key, kinds: [] } : null;
      if (inClosing) closing.push(inClosing);
      if (key === 'References') referencesHeading = h[1].trim();
      continue;
    }
    if (l.startsWith('**')) {
      const after = Number(lines[i + 1]?.match(/^\[(\d+) paragraphs?/)?.[1] || 0);
      if (after) calloutRuns.push(after);
      continue;
    }
    const faq = l.match(/^\[(\d+) FAQ items/);
    if (faq) faqCount = Number(faq[1]);
    if (!inClosing) continue;
    const paras = Number(l.match(/^\[(\d+) paragraphs?/)?.[1] || 0);
    inClosing.kinds.push(
      ...(l.startsWith('[Table')
        ? (['table'] as BlockKind[])
        : /^\[Bulleted list/.test(l)
          ? (['bullets'] as BlockKind[])
          : /^\[Numbered list/.test(l)
            ? (['numbered'] as BlockKind[])
            : /FAQ items/.test(l)
              ? (['faq'] as BlockKind[])
              : (Array(paras).fill('para') as BlockKind[]))
    );
  }

  return {
    ...base,
    callouts: callouts.length ? callouts : defaults.callouts,
    closing: closing.length ? closing.map((c) => ({ ...c, kinds: collapse(c.kinds) })) : defaults.closing,
    faqCount,
    calloutParas: mostCommon(calloutRuns, defaults.calloutParas),
    patterns: patternsFromOutline(outline),
    referencesHeading,
  };
}

/** A section's exact blocks in pattern terms; list items split by blank lines count as one list. */
function sectionBlocks(s: Section): { blocks: PatternBlock[]; tableCols?: number; listItems: number; leadIn: boolean } {
  const blocks: PatternBlock[] = [];
  let tableCols: number | undefined;
  let listItems = 0;
  let leadIn = true;
  for (const b of s.blocks) {
    const kind: PatternBlock =
      b.kind === 'callout' ? 'callout' : b.kind === 'table' ? 'table' : b.kind === 'bullets' || b.kind === 'numbered' ? 'list' : 'para';
    if (kind === 'table') tableCols ??= b.cols;
    if (kind === 'list') {
      listItems += b.items || 0;
      leadIn &&= !!b.leadIn;
      if (blocks[blocks.length - 1] === 'list') continue;
    }
    blocks.push(kind);
  }
  return { blocks, tableCols, listItems, leadIn: leadIn && blocks.includes('list') };
}

const LIST_HEADING =
  /side effects?|signs?|symptoms?|ways?|tips|options|types|risks?|benefits?|steps|causes|triggers|strategies|what can you do|how can (you|adults|families)|what (should|can)/i;

/**
 * The body section best suited to become the sample's lead-in list: a plain-paragraph section
 * (no callout or table) whose heading suggests several items, else a plain section mid-article.
 */
export function listCandidate(body: Section[]): string | null {
  const plain = body.filter((s) => s.blocks.length > 0 && s.blocks.every((b) => b.kind === 'para'));
  return (plain.find((s) => LIST_HEADING.test(s.heading)) ?? plain[Math.floor(plain.length / 2)])?.heading ?? null;
}

/** FAQ items and list items collapse to one block per run for comparison. */
function collapse(kinds: BlockKind[]): BlockKind[] {
  return kinds.filter((k, i) => !(k !== 'para' && k === kinds[i - 1]));
}

const describe = (kinds: BlockKind[]) => {
  const parts: string[] = [];
  for (let i = 0; i < kinds.length; ) {
    let n = 1;
    while (kinds[i + n] === kinds[i]) n++;
    parts.push(n > 1 ? `${n} ${KIND_NAMES[kinds[i]]}s` : `a ${KIND_NAMES[kinds[i]]}`);
    i += n;
  }
  return parts.join(', then ') || 'nothing';
};

export function checkLayout(markdown: string, spec: LayoutSpec): LayoutReport {
  const issues: string[] = [];
  const wordCount = countWords(markdown);
  if (wordCount < spec.minWords || wordCount > spec.maxWords) {
    const target = Math.round((spec.minWords + spec.maxWords) / 2);
    issues.push(
      `Word count is ${wordCount} (excluding References) but must be between ${spec.minWords} and ${spec.maxWords}. ` +
        (wordCount > spec.maxWords
          ? `Cut about ${wordCount - target} words by tightening paragraphs, not by removing required sections.`
          : `Add about ${target - wordCount} words of genuinely useful detail.`)
    );
  }

  const sections = parseSections(markdown);
  const body = sections.filter((s) => s.heading && !closingKey(s.heading));

  const usedCallouts = new Set(sections.flatMap((s) => s.blocks.filter((b) => b.kind === 'callout').map((b) => b.label?.toLowerCase())));
  const missing = spec.callouts.filter((c) => !usedCallouts.has(c.toLowerCase()));
  if (missing.length) {
    const calloutPattern = spec.patterns.body.find((p) => p.blocks.includes('callout'));
    issues.push(
      `Add the missing callout block${missing.length > 1 ? 's' : ''} ${missing.map((m) => `**${m}**`).join(', ')}, each in its own body section shaped exactly as: ${
        calloutPattern ? describeBlocks(calloutPattern.blocks) : `the bold label alone on its own line, then ${spec.calloutParas} paragraphs`
      }.`
    );
  }

  // Every body section must match one of the sample's section patterns exactly.
  const { intro, body: patterns } = spec.patterns;
  const has = (blocks: PatternBlock[], b: PatternBlock) => blocks.includes(b);
  const plainPattern = [...patterns].filter((p) => !p.blocks.some((b) => b !== 'para')).sort((a, b) => b.count - a.count)[0];
  const targetFor = (blocks: PatternBlock[]): SectionPattern | undefined =>
    (['callout', 'table', 'list'] as PatternBlock[]).map((k) => (has(blocks, k) ? patterns.find((p) => has(p.blocks, k)) : undefined)).find(Boolean) ??
    (['callout', 'table', 'list'].some((k) => has(blocks, k as PatternBlock)) ? undefined : plainPattern);
  if (patterns.length) {
    const wrong: string[] = [];
    const details: string[] = [];
    for (const s of body) {
      const got = sectionBlocks(s);
      const match = patterns.find((p) => p.blocks.join() === got.blocks.join());
      if (!match) {
        const target = targetFor(got.blocks) ?? plainPattern;
        wrong.push(`"${s.heading}" has ${describeBlocks(got.blocks)}; make it ${target ? describeBlocks(target.blocks, target) : 'like the sample'}`);
        continue;
      }
      if (match.tableCols && got.tableCols && got.tableCols !== match.tableCols) {
        details.push(`the table in "${s.heading}" has ${got.tableCols} columns; the sample's has ${match.tableCols}`);
      }
      if (match.leadIn && !got.leadIn) {
        details.push(`every bullet in "${s.heading}" must start with a bold lead-in ("- **Lead-in:** explanation.")`);
      }
      if (match.listItems && got.listItems < Math.max(3, match.listItems - 2)) {
        details.push(`the list in "${s.heading}" has ${got.listItems} items; the sample's has ${match.listItems}, so give at least ${Math.max(3, match.listItems - 2)}`);
      }
    }
    if (wrong.length) {
      issues.push(`Every body section must match one of the sample's section patterns exactly (same number of paragraphs in the same places). Fix: ${wrong.join('; ')}.`);
    }
    if (details.length) issues.push(`Match the sample: ${details.join('; ')}.`);

    // Table and list sections appear exactly as often as in the sample.
    for (const kind of ['table', 'list'] as PatternBlock[]) {
      const p = patterns.find((x) => has(x.blocks, kind));
      const n = body.filter((s) => has(sectionBlocks(s).blocks, kind)).length;
      const want = p?.count ?? 0;
      if (n === want) continue;
      const name = kind === 'table' ? 'table section' : 'list section';
      if (n > want) {
        issues.push(
          want
            ? `The sample has exactly ${want} body ${name}${want > 1 ? 's' : ''}; this article has ${n}. Rewrite the extra one${n - want > 1 ? 's' : ''} as ${describeBlocks(plainPattern?.blocks ?? ['para', 'para'])}.`
            : `The sample has no body ${name}; rewrite ${n > 1 ? 'those sections' : 'that section'} as ${describeBlocks(plainPattern?.blocks ?? ['para', 'para'])}.`
        );
      } else if (kind === 'list') {
        const target = listCandidate(body);
        issues.push(
          `The sample has ${want} body list section${want > 1 ? 's' : ''} but this article has ${n}. Convert ${target ? `the body section "${target}"` : 'a body section that covers several items'} into exactly: ${describeBlocks(p!.blocks, p)}. Build the bullets from that section's existing points so the word count stays about the same. Keep its heading.`
        );
      } else {
        issues.push(
          `The sample has ${want} body table section${want > 1 ? 's' : ''} but this article has ${n}. Add one with its own short descriptive "## " heading (e.g. "${p!.example}") containing only ${describeBlocks(p!.blocks, p)}, built from points the article already makes.`
        );
      }
    }
  }
  if (intro) {
    const got = sectionBlocks(sections[0]).blocks;
    if (got.join() !== intro.join()) {
      issues.push(`Under the title, before the first "## " heading, write exactly ${describeBlocks(intro)} (found ${describeBlocks(got)}).`);
    }
  }

  // Closing sections: presence, order and exact contents.
  const found = sections.filter((s) => closingKey(s.heading));
  const foundKeys = found.map((s) => closingKey(s.heading));
  const expectedKeys = spec.closing.map((c) => c.heading);
  if (expectedKeys.join('|') !== foundKeys.join('|')) {
    issues.push(`The closing sections must be exactly, in this order: ${expectedKeys.join(' -> ')}. Found: ${foundKeys.join(' -> ') || 'none'}.`);
  }
  for (const exp of spec.closing) {
    const sec = found.find((s) => closingKey(s.heading) === exp.heading);
    if (!sec) continue;
    const got = collapse(sec.blocks.map((b) => b.kind));
    if (got.join(',') !== exp.kinds.join(',')) {
      issues.push(`The "${exp.heading}" section must contain only ${describe(exp.kinds)}, like the sample. It currently has ${describe(got)}.`);
    }
    if (exp.heading === 'Final Thoughts' && !/^Final Thoughts:\s*\S.*\?$/.test(sec.heading)) {
      issues.push(`Title the Final Thoughts section "Final Thoughts: <the reader's question>?", like the sample.`);
    }
    if (exp.heading === 'Frequently Asked Questions') {
      const n = sec.blocks.filter((b) => b.kind === 'faq').length;
      if (n !== spec.faqCount) {
        issues.push(`Write exactly ${spec.faqCount} FAQs, each as "**N. Question?**" on one line with the answer on the next line. Found ${n}.`);
      }
    }
  }

  const refsMatch = markdown.match(/^#{1,3}\s+References:?\s*$([\s\S]*)/im);
  const refs = refsMatch ? refsMatch[1].split('\n').filter((l) => /^\s*\d+[.)]\s/.test(l)) : [];
  if (refs.length < spec.minReferences) {
    issues.push(`Give at least ${spec.minReferences} numbered references (found ${refs.length}), each a real source from the research pack.`);
  }
  if (spec.noDoiLinks && refs.some((r) => /doi\.org\//i.test(r))) {
    issues.push('References must use direct article or source links, not doi.org links (short Harvard rule).');
  }
  const urls = refs.map((r) => r.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,]+$/, '')).filter(Boolean);
  if (new Set(urls).size < urls.length) issues.push('Remove duplicate references (the same URL appears more than once).');
  if (spec.approvedSources?.length) {
    const outside = refs.filter((r) => {
      const url = r.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,]+$/, '');
      return !url || !isApproved(url, spec.approvedSources!);
    });
    if (outside.length) {
      issues.push(
        `Every reference must be one of the approved references (client-approved sites only). Replace or remove: ${outside
          .map((r) => r.replace(/^\s*\d+[.)]\s*/, '').slice(0, 120))
          .join(' | ')}`
      );
    }
  }

  if (spec.internalLinkUrls.length) {
    const finalThoughts = markdown.match(/^##\s+Final Thoughts[^\n]*\n([\s\S]*?)(?=^##\s)/im)?.[1] || '';
    const missingLinks = spec.internalLinkUrls.filter((u) => !finalThoughts.includes(u));
    if (missingLinks.length) {
      issues.push(`Include the required internal link(s) inside a natural sentence in Final Thoughts: ${missingLinks.join(', ')}.`);
    }
  }

  return { wordCount, issues };
}

/** Instructions for one correction pass. */
export function correctionPrompt(
  markdown: string,
  issues: string[],
  spec: LayoutSpec,
  sources: { title: string; url: string }[] = []
): string {
  const sourceList = sources.length
    ? `\nIf a reference must be added, use ONLY these verified research sources, with their exact URLs:\n${sources.map((s) => `- ${s.title}. ${s.url}`).join('\n')}\n`
    : '\nDo not invent references; if none can be added from the article itself, leave the list as it is.\n';
  const noPadding =
    '\nNever list the same source (same URL) twice to reach a reference count. If there are not enough distinct sources, leave the list shorter.\n';
  return `You are the final editor. The article below must match the client's approved sample layout and word range, but it has these problems:

${issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}

Fix EVERY problem in the list: structure problems are as important as the word count, so do not skip any. Change only the sections the problems name (and trim wording elsewhere only if the word count must change). Copy every other section exactly as it is, especially the closing sections' tables, lists and FAQ format. Keep the facts, tone, headings and section order, and add no new claims.${sourceList}${noPadding}
${patternsText(spec.patterns)}

Target length: ${spec.minWords} to ${spec.maxWords} words, excluding the References section. Count carefully.
Output the COMPLETE corrected article in Markdown and nothing else: no notes, no explanation.

ARTICLE:
${markdown}`;
}

const normaliseUrl = (u: string) => u.replace(/[).,;]+$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();

/** Removes repeated sources from the numbered References list (same URL), renumbers it and uses the sample's heading text. */
export function dedupeReferences(markdown: string, heading?: string): string {
  const m = markdown.match(/^(#{1,3}\s+References:?\s*\n)([\s\S]*)$/im);
  if (!m || m.index === undefined) return markdown;
  const seen = new Set<string>();
  let n = 0;
  const lines = m[2].split('\n').flatMap((line) => {
    const item = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!item) return [line];
    const url = item[1].match(/https?:\/\/\S+/)?.[0];
    if (url) {
      const key = normaliseUrl(url);
      if (seen.has(key)) return [];
      seen.add(key);
    }
    return [`${++n}. ${item[1]}`];
  });
  const head = heading ? m[1].replace(/References:?/i, heading) : m[1];
  return markdown.slice(0, m.index) + head + lines.join('\n');
}

export interface FinalizeResult extends LayoutReport {
  article: string;
  passes: number;
  /** Problems found before any correction. */
  initialIssues: string[];
}

/**
 * Checks the article and runs up to `maxPasses` correction passes, keeping whichever version has
 * the fewest problems, so a bad pass can never make the result worse.
 */
export async function finalizeArticle(
  markdown: string,
  spec: LayoutSpec,
  fix: (prompt: string) => Promise<string>,
  opts: { maxPasses?: number; sources?: { title: string; url: string }[] } = {}
): Promise<FinalizeResult> {
  const score = (r: LayoutReport) =>
    r.issues.length * 1000 + Math.max(0, r.wordCount - spec.maxWords, spec.minWords - r.wordCount);
  const initialIssues = checkLayout(markdown, spec).issues;
  const start = dedupeReferences(markdown, spec.referencesHeading);
  let best = { article: start, ...checkLayout(start, spec) };
  let passes = 0;

  while (best.issues.length && passes < (opts.maxPasses ?? 3)) {
    passes++;
    const revised = dedupeReferences((await fix(correctionPrompt(best.article, best.issues, spec, opts.sources))).trim(), spec.referencesHeading);
    // A pass that drops most of the article is a failed pass, not a shorter article.
    if (!revised || countWords(revised) < spec.minWords * 0.6) continue;
    const report = checkLayout(revised, spec);
    if (score(report) < score(best)) best = { article: revised, ...report };
  }
  return { ...best, passes, initialIssues };
}
