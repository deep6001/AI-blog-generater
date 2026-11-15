// Checks a finished article against the client's sample template and word range, and builds the
// instructions for a correction pass. The checks are deterministic so the model can't "agree"
// that it followed the format when it didn't.

export type BlockKind = 'para' | 'table' | 'bullets' | 'numbered' | 'faq' | 'callout';

export interface Section {
  heading: string;
  blocks: { kind: BlockKind; label?: string; leadIn?: boolean }[];
}

export interface LayoutSpec {
  minWords: number;
  maxWords: number;
  /** Most paragraphs allowed in a row inside a body section or callout. */
  parasPerSection: number;
  callouts: string[];
  /** Closing sections in order, with the only block kinds each may contain. */
  closing: { heading: string; kinds: BlockKind[] }[];
  faqCount: number;
  /** Paragraphs that follow each callout label in the sample. */
  calloutParas: number;
  /** The sample has a body bulleted list whose items start with a bold lead-in. */
  bodyLeadInList: boolean;
  /** Exact block sequence of the sample's body section that holds a table, e.g. [table]. */
  tableSection: BlockKind[] | null;
  /** Exact block sequence of the sample's body section that holds a list, e.g. [para, bullets, para]. */
  listSection: BlockKind[] | null;
  /** Exact References heading text used by the sample, e.g. "References:". */
  referencesHeading: string;
  minReferences: number;
  noDoiLinks: boolean;
  internalLinkUrls: string[];
}

type SpecBase = Omit<
  LayoutSpec,
  'parasPerSection' | 'callouts' | 'closing' | 'faqCount' | 'calloutParas' | 'bodyLeadInList' | 'tableSection' | 'listSection' | 'referencesHeading'
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
    if (first.startsWith('|')) return sec.blocks.push({ kind: 'table' });
    if (/^[-*+]\s/.test(first)) return sec.blocks.push({ kind: 'bullets', leadIn: /^[-*+]\s+\*\*[^*]+\*\*/.test(first) });
    if (/^\d+[.)]\s/.test(first)) return sec.blocks.push({ kind: 'numbered' });
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
    parasPerSection: 2,
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
    bodyLeadInList: true,
    tableSection: ['table'],
    listSection: ['para', 'bullets', 'para'],
    referencesHeading: 'References:',
  };
  if (!outline) return defaults;

  const lines = outline.split('\n');
  const callouts = [...new Set(lines.map((l) => l.match(/^\*\*(.+?)\*\*/)?.[1]).filter((x): x is string => Boolean(x)))];
  const runs: number[] = [];
  const calloutRuns: number[] = [];
  const closing: LayoutSpec['closing'] = [];
  let faqCount = defaults.faqCount;
  let bodyLeadInList = false;
  let referencesHeading = defaults.referencesHeading;
  let inClosing: LayoutSpec['closing'][number] | null = null;
  // Block sequence of each body section, leaving out callouts and their paragraphs.
  const bodySections: BlockKind[][] = [];
  let bodyKinds: BlockKind[] | null = null;

  for (const [i, l] of lines.entries()) {
    const h = l.match(/^##\s+(.*)$/);
    if (h) {
      const key = closingKey(h[1]);
      bodyKinds = key ? null : [];
      if (bodyKinds) bodySections.push(bodyKinds);
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
    if (!inClosing && /^\[Bulleted list.*bold lead-in/.test(l)) bodyLeadInList = true;
    const paras = Number(l.match(/^\[(\d+) paragraphs?/)?.[1] || 0);
    const kinds: BlockKind[] = l.startsWith('[Table')
      ? ['table']
      : /^\[Bulleted list/.test(l)
        ? ['bullets']
        : /^\[Numbered list/.test(l)
          ? ['numbered']
          : /FAQ items/.test(l)
            ? ['faq']
            : paras
              ? Array(paras).fill('para')
              : [];
    const faq = l.match(/^\[(\d+) FAQ items/);
    if (faq) faqCount = Number(faq[1]);
    if (inClosing) inClosing.kinds.push(...kinds);
    else if (paras && !lines[i - 1]?.startsWith('**')) runs.push(paras);
    if (bodyKinds && !lines[i - 1]?.startsWith('**')) bodyKinds.push(...(paras ? (['para'] as BlockKind[]) : kinds));
  }
  // Paragraph runs count as one "para" slot here; the paragraph limit is checked separately.
  const tableSection = bodySections.find((k) => k.includes('table')) ?? null;
  const listSection = bodySections.find((k) => k.includes('bullets')) ?? null;

  // Most common lengths, so one exception in the sample doesn't loosen the rule.
  return {
    ...base,
    parasPerSection: mostCommon(runs, 2),
    callouts: callouts.length ? callouts : defaults.callouts,
    closing: closing.length ? closing.map((c) => ({ ...c, kinds: collapse(c.kinds) })) : defaults.closing,
    faqCount,
    calloutParas: mostCommon(calloutRuns, defaults.calloutParas),
    bodyLeadInList,
    tableSection,
    listSection,
    referencesHeading,
  };
}

/** A body section's shape: consecutive paragraphs become one "para", callouts and their text are left out. */
function sectionShape(s: Section): BlockKind[] {
  const shape: BlockKind[] = [];
  let inCallout = false;
  for (const b of s.blocks) {
    if (b.kind === 'callout') {
      inCallout = true;
      continue;
    }
    if (b.kind === 'para' && inCallout) continue;
    inCallout = false;
    if (b.kind === 'para' && shape[shape.length - 1] === 'para') continue;
    shape.push(b.kind);
  }
  return shape;
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

  // Paragraph runs: in body sections and after callout labels.
  const long: string[] = [];
  for (const s of body) {
    let run = 0;
    for (const b of [...s.blocks, { kind: 'table' as BlockKind }]) {
      if (b.kind === 'para') run++;
      else {
        if (run > spec.parasPerSection) long.push(`"${s.heading}" (${run} paragraphs)`);
        run = 0;
      }
    }
  }
  if (long.length) {
    issues.push(
      `Use at most ${spec.parasPerSection} paragraphs per section and per callout, as in the sample. Shorten: ${long.slice(0, 12).join('; ')}${long.length > 12 ? ` and ${long.length - 12} more` : ''}.`
    );
  }

  const usedCallouts = new Set(sections.flatMap((s) => s.blocks.filter((b) => b.kind === 'callout').map((b) => b.label?.toLowerCase())));
  const missing = spec.callouts.filter((c) => !usedCallouts.has(c.toLowerCase()));
  if (missing.length) {
    issues.push(
      `Add the missing callout block${missing.length > 1 ? 's' : ''} ${missing.map((m) => `**${m}**`).join(', ')}: the bold label alone on its own line, then ${spec.calloutParas} paragraph${spec.calloutParas === 1 ? '' : 's'}, inside a body section that has no other callout.`
    );
  }

  // Each callout is followed by the sample's number of paragraphs, and sits in its own section.
  const shortCallouts: string[] = [];
  const crowded: string[] = [];
  for (const s of body) {
    const labels: string[] = [];
    s.blocks.forEach((b, i) => {
      if (b.kind !== 'callout' || !b.label) return;
      labels.push(b.label);
      let n = 0;
      while (s.blocks[i + 1 + n]?.kind === 'para') n++;
      if (n < spec.calloutParas) shortCallouts.push(`${b.label} (${n})`);
    });
    if (labels.length > 1) crowded.push(`"${s.heading}" (${labels.join(', ')})`);
  }
  if (shortCallouts.length) {
    issues.push(
      `Each callout must be followed by ${spec.calloutParas} paragraphs, as in the sample. Expand: ${shortCallouts.join('; ')}.`
    );
  }
  if (crowded.length) {
    issues.push(`Place each callout in a different body section, as in the sample. Separate: ${crowded.join('; ')}.`);
  }

  // Sections holding a table or a list must have exactly the sample's shape.
  const shapeName = (k: BlockKind[]) =>
    k.map((x) => (x === 'para' ? 'paragraph(s)' : KIND_NAMES[x])).join(' -> ');
  for (const [kind, expected, how] of [
    [
      'table',
      spec.tableSection,
      'Give each body table its own "## " heading (a short descriptive title, e.g. "How ADT, Abiraterone and Prednisolone Work Together") with nothing else in that section: no paragraphs before or after the table.',
    ],
    [
      'bullets',
      spec.listSection,
      'Write the list section as: one short introductory paragraph, then the bulleted list with bold lead-ins, then one short closing paragraph.',
    ],
  ] as const) {
    if (!expected) continue;
    const wrong = body.filter((s) => {
      const shape = sectionShape(s);
      return shape.includes(kind) && shape.join() !== expected.join();
    });
    if (wrong.length) {
      issues.push(
        `${how} The sample's shape is: ${shapeName(expected)}. Fix: ${wrong.map((s) => `"${s.heading}" (has ${shapeName(sectionShape(s))})`).join('; ')}.`
      );
    }
  }

  if (spec.bodyLeadInList) {
    const hasLeadIn = body.some((s) => s.blocks.some((b) => b.kind === 'bullets' && b.leadIn));
    if (!hasLeadIn) {
      issues.push(
        'Include one bulleted list in a body section where several items are compared or listed (for example side effects, options or warning signs), each item starting with a bold lead-in: "- **Term:** explanation.", as in the sample. Keep that section\'s paragraphs to at most ' +
          `${spec.parasPerSection} around the list.`
      );
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

Fix ONLY these problems. Keep the facts, tone, headings and section order otherwise unchanged, and add no new claims.${sourceList}${noPadding}
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

  while (best.issues.length && passes < (opts.maxPasses ?? 2)) {
    passes++;
    const revised = dedupeReferences((await fix(correctionPrompt(best.article, best.issues, spec, opts.sources))).trim(), spec.referencesHeading);
    // A pass that drops most of the article is a failed pass, not a shorter article.
    if (!revised || countWords(revised) < spec.minWords * 0.6) continue;
    const report = checkLayout(revised, spec);
    if (score(report) < score(best)) best = { article: revised, ...report };
  }
  return { ...best, passes, initialIssues };
}
