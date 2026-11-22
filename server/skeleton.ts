// Builds the article on the sample's exact blueprint. The sample outline (from sampleDoc.ts) becomes a
// fixed list of slots: every section in order, with its exact paragraphs, callout labels, table and
// list. The model only fills the slots for the new topic; the article is then assembled here, so its
// layout matches the sample by construction instead of by imitation.

export type Slot =
  | { kind: 'para'; words: number }
  | { kind: 'callout'; label: string }
  | { kind: 'table'; cols: number; rows: number; header: string[] }
  | { kind: 'list'; items: number; style: 'bold' | 'plain' | 'none' };

export interface Blueprint {
  title: string;
  intro: Slot[];
  body: { heading: string; slots: Slot[] }[];
  /** Closing sections in the sample's order. */
  closing: (
    | { kind: 'myth'; rows: number }
    | { kind: 'takeaways'; items: number }
    | { kind: 'faq'; count: number; words: number }
    | { kind: 'final'; heading: string; paras: number; words: number; link: boolean }
    | { kind: 'references'; heading: string; count: number }
  )[];
}

const CLOSING = /^(Myth vs Fact|Key Takeaways|Frequently Asked Questions|Final Thoughts|References)/i;

/** Reads the sample outline into a blueprint. Returns null when the outline has no body sections. */
export function blueprintFromOutline(outline: string | null | undefined): Blueprint | null {
  if (!outline) return null;
  const bp: Blueprint = { title: '', intro: [], body: [], closing: [] };
  let target: Slot[] | null = null;
  let closing: string | null = null;

  for (const raw of outline.split('\n')) {
    const l = raw.trim();
    const h1 = l.match(/^#\s+(.*)$/);
    if (h1) {
      bp.title = h1[1].trim();
      target = bp.intro;
      closing = null;
      continue;
    }
    const h2 = l.match(/^##\s+(.*)$/);
    if (h2) {
      const heading = h2[1].trim();
      closing = heading.match(CLOSING)?.[1].toLowerCase() || null;
      target = null;
      if (!closing) {
        const sec = { heading, slots: [] as Slot[] };
        bp.body.push(sec);
        target = sec.slots;
      } else if (closing === 'final thoughts') bp.closing.push({ kind: 'final', heading, paras: 2, words: 50, link: false });
      else if (closing === 'references') bp.closing.push({ kind: 'references', heading, count: 5 });
      continue;
    }

    const paras = l.match(/^\[(\d+) paragraphs?, ~(\d+) words/);
    const label = l.match(/^\*\*([^*]+)\*\*/)?.[1]?.replace(/:$/, '').trim();
    const table = l.match(/^\[Table: (\d+) columns? \(([^)]*)\), (\d+) rows/);
    const list = l.match(/^\[(Bulleted|Numbered) list, (\d+) items?/);
    const faq = l.match(/^\[(\d+) FAQ items.*?answer of ~(\d+) words/);

    if (closing) {
      if (closing === 'myth vs fact' && table) bp.closing.push({ kind: 'myth', rows: Number(table[3]) });
      else if (closing === 'key takeaways' && list) bp.closing.push({ kind: 'takeaways', items: Number(list[2]) });
      else if (closing === 'frequently asked questions' && faq) bp.closing.push({ kind: 'faq', count: Number(faq[1]), words: Number(faq[2]) });
      else if (closing === 'final thoughts' && paras) {
        const f = bp.closing[bp.closing.length - 1];
        if (f?.kind === 'final') Object.assign(f, { paras: Number(paras[1]), words: Number(paras[2]), link: /internal link/.test(l) });
      } else if (closing === 'references' && list) {
        const r = bp.closing[bp.closing.length - 1];
        if (r?.kind === 'references') r.count = Number(list[2]);
      }
      continue;
    }
    if (!target) continue;
    if (label) target.push({ kind: 'callout', label });
    else if (paras) for (let i = 0; i < Number(paras[1]); i++) target.push({ kind: 'para', words: Number(paras[2]) });
    else if (table) target.push({ kind: 'table', cols: Number(table[1]), rows: Number(table[3]), header: table[2].split('|').map((x) => x.trim()) });
    else if (list) {
      const style = /bold lead-in/.test(l) ? 'bold' : /e\.g\. "[^":]{2,60}:\s/.test(l) ? 'plain' : 'none';
      target.push({ kind: 'list', items: Number(list[2]), style });
    }
  }
  return bp.body.length ? bp : null;
}

/** Words the blueprint asks for, from its paragraph and FAQ targets (tables and lists estimated). */
export function blueprintWords(bp: Blueprint): number {
  const slotWords = (s: Slot) => (s.kind === 'para' ? s.words : s.kind === 'table' ? s.rows * s.cols * 8 : s.kind === 'list' ? s.items * 14 : 2);
  let n = bp.intro.reduce((t, s) => t + slotWords(s), 0) + bp.body.reduce((t, b) => t + 8 + b.slots.reduce((u, s) => u + slotWords(s), 0), 0);
  for (const c of bp.closing) {
    if (c.kind === 'myth') n += c.rows * 22;
    if (c.kind === 'takeaways') n += c.items * 16;
    if (c.kind === 'faq') n += c.count * (c.words + 9);
    if (c.kind === 'final') n += c.paras * c.words;
  }
  return n;
}

// The JSON template the model fills: same shape as the article, with a placeholder in every slot.
type Filled = {
  title: string;
  intro: string[];
  sections: { heading: string; slots: (string | { label: string } | { table: { header: string[]; rows: string[][] } } | { list: { term: string; text: string }[] })[] }[];
  myth_vs_fact?: { myth: string; fact: string }[];
  key_takeaways?: string[];
  faqs?: { question: string; answer: string }[];
  final_thoughts?: { question: string; paragraphs: string[] };
  references?: string[];
};

export function template(bp: Blueprint, scale = 1): Filled {
  const w = (n: number) => Math.max(15, Math.round((n * scale) / 5) * 5);
  const slot = (s: Slot): Filled['sections'][number]['slots'][number] =>
    s.kind === 'para'
      ? `<paragraph, about ${w(s.words)} words>`
      : s.kind === 'callout'
        ? { label: s.label }
        : s.kind === 'table'
          ? {
              table: {
                header: Array.from({ length: s.cols }, (_, i) => `<column ${i + 1} heading>`),
                rows: Array.from({ length: s.rows }, () => Array.from({ length: s.cols }, () => '<cell, a short phrase>')),
              },
            }
          : { list: Array.from({ length: s.items }, () => ({ term: '<short term, 1 to 4 words>', text: '<one sentence>' })) };
  const t: Filled = {
    title: '<the reader question this article answers, Title Case, ending with ?>',
    intro: bp.intro.filter((s) => s.kind === 'para').map(slot) as string[],
    sections: bp.body.map((b) => ({
      heading: b.slots.some((s) => s.kind === 'table')
        ? `<short descriptive title, not a question, in the style of: "${b.heading}">`
        : `<reader question in Title Case, in the style of: "${b.heading}">`,
      slots: b.slots.map(slot),
    })),
  };
  for (const c of bp.closing) {
    if (c.kind === 'myth') t.myth_vs_fact = Array.from({ length: c.rows }, () => ({ myth: '<common belief>', fact: '<evidence-based correction>' }));
    if (c.kind === 'takeaways') t.key_takeaways = Array.from({ length: c.items }, () => '<one-sentence takeaway>');
    if (c.kind === 'faq')
      t.faqs = Array.from({ length: c.count }, () => ({ question: '<reader question?>', answer: `<answer, about ${w(c.words)} words>` }));
    if (c.kind === 'final')
      t.final_thoughts = {
        question: '<the reader question for "Final Thoughts: ...?">',
        paragraphs: Array.from({ length: c.paras }, () => `<paragraph, about ${w(c.words)} words>`),
      };
    if (c.kind === 'references') t.references = Array.from({ length: c.count }, () => '<one reference, copied exactly from a "Cite as" line>');
  }
  return t;
}

export function fillPrompt(opts: {
  bp: Blueprint;
  draft: string;
  minWords: number;
  maxWords: number;
  sampleWords?: number | null;
  rules?: string;
  internalLinks?: string;
  sources?: { title: string; url: string; citation?: string }[];
}): string {
  const { bp } = opts;
  const target = Math.round(Math.min(opts.maxWords * 0.97, Math.max(opts.minWords * 1.03, opts.sampleWords || (opts.minWords + opts.maxWords) / 2)));
  const scale = target / Math.max(1, blueprintWords(bp));
  const listStyles = bp.body.flatMap((b) => b.slots).filter((s) => s.kind === 'list') as Extract<Slot, { kind: 'list' }>[];
  const cite = (opts.sources || []).filter((s) => s.citation || s.url);
  return `You are laying out a finished medical blog article onto the client's approved template.

Below is a JSON template. It has exactly the sections, paragraphs, callouts, table, list and closing parts of the client's sample article, in the sample's order. Replace every <placeholder> with real content about the article's topic, taken from the DRAFT ARTICLE further down. Keep the JSON shape exactly:
- Same number of sections, in the same order, with the same number of items in every array. Do not add, remove, merge or reorder anything.
- Keep every {"label": "..."} object unchanged: it is a callout label. The paragraphs after it are that callout's content and must fit its name (an Evidence Note or Research Insight describes a study with its year, size and figures; a UK Guidance Note gives UK guidance; a Clinical Note gives practical clinical advice).
- Choose the topic of each section so the questions read in a natural order (basic questions first) and each section's content suits its shape: put the comparison in the table section and the several-item content (risks, options, side effects) in the list section.
- Paragraph lengths are given in words; follow them closely. The whole article must be between ${opts.minWords} and ${opts.maxWords} words (aim for about ${target}), excluding references.
- Headings: Title Case like the sample, with short joining words (a, an, and, at, for, in, of, on, or, the, to) in lower case. Section headings are reader questions except the table section's, which is a short descriptive title.
${listStyles.some((s) => s.style === 'bold') ? '- List items: "term" is the bold lead-in, "text" the explanation.\n' : ''}${listStyles.some((s) => s.style !== 'bold') ? '- List items: "term" is a plain lead-in written before a colon, "text" the explanation.\n' : ''}- Say each point once across the whole article; do not repeat a study, caveat or warning in several places.
- Use only facts from the draft and its sources. Do not invent studies, figures or references.
${cite.length ? `- references: choose from these and copy the "Cite as" text exactly:\n${cite.map((s) => `  - ${s.citation || `${s.title}. Available at: ${s.url}`}`).join('\n')}\n` : '- references: copy them from the draft exactly.\n'}${
    opts.internalLinks?.trim()
      ? `- Put this internal link inside a natural sentence in the last Final Thoughts paragraph, as a Markdown link [anchor](url):\n${opts.internalLinks.trim()}\n`
      : ''
  }- Plain text inside strings: no Markdown headings or bullets. You may use **bold** sparingly and Markdown links.
${opts.rules ? `\nCLIENT WRITING RULES (for wording and tone; the template decides the layout):\n${opts.rules.trim()}\n` : ''}
Reply with ONLY the completed JSON, no code fences or comments.

TEMPLATE:
${JSON.stringify(template(bp, scale), null, 2)}

DRAFT ARTICLE:
${opts.draft}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isPlaceholder = (s: string) => /^<[^>]*>$/.test(s);

/** Checks the filled JSON against the blueprint. Returns problems, or an empty list when it fits. */
export function validateFilled(bp: Blueprint, f: any): string[] {
  const out: string[] = [];
  if (!f || typeof f !== 'object') return ['The reply was not a JSON object.'];
  if (!str(f.title) || isPlaceholder(str(f.title))) out.push('title is missing.');
  const introParas = bp.intro.filter((s) => s.kind === 'para').length;
  if (!Array.isArray(f.intro) || f.intro.length !== introParas) out.push(`intro must have ${introParas} paragraphs.`);
  if (!Array.isArray(f.sections) || f.sections.length !== bp.body.length) {
    out.push(`sections must have exactly ${bp.body.length} items (found ${Array.isArray(f.sections) ? f.sections.length : 0}).`);
    return out;
  }
  bp.body.forEach((b, i) => {
    const sec = f.sections[i];
    if (!str(sec?.heading) || isPlaceholder(str(sec?.heading))) out.push(`sections[${i}].heading is missing.`);
    if (!Array.isArray(sec?.slots) || sec.slots.length !== b.slots.length) {
      out.push(`sections[${i}].slots must have exactly ${b.slots.length} items.`);
      return;
    }
    b.slots.forEach((s, j) => {
      const v = sec.slots[j];
      const at = `sections[${i}].slots[${j}]`;
      if (s.kind === 'para' && (!str(v) || isPlaceholder(str(v)))) out.push(`${at} must be a paragraph string.`);
      if (s.kind === 'callout' && v?.label !== s.label) out.push(`${at} must be {"label": "${s.label}"}.`);
      if (s.kind === 'table' && (!Array.isArray(v?.table?.header) || v.table.header.length !== s.cols || !Array.isArray(v.table.rows) || !v.table.rows.length))
        out.push(`${at} must be a table with ${s.cols} columns.`);
      if (s.kind === 'list' && (!Array.isArray(v?.list) || v.list.length < Math.max(3, s.items - 2))) out.push(`${at} must be a list of about ${s.items} items.`);
    });
  });
  for (const c of bp.closing) {
    if (c.kind === 'myth' && (!Array.isArray(f.myth_vs_fact) || Math.abs(f.myth_vs_fact.length - c.rows) > 1)) out.push(`myth_vs_fact must have ${c.rows} rows.`);
    if (c.kind === 'takeaways' && (!Array.isArray(f.key_takeaways) || Math.abs(f.key_takeaways.length - c.items) > 1)) out.push(`key_takeaways must have ${c.items} items.`);
    if (c.kind === 'faq' && (!Array.isArray(f.faqs) || f.faqs.length !== c.count)) out.push(`faqs must have ${c.count} items.`);
    if (c.kind === 'final' && (!Array.isArray(f.final_thoughts?.paragraphs) || f.final_thoughts.paragraphs.length !== c.paras))
      out.push(`final_thoughts.paragraphs must have ${c.paras} items.`);
    if (c.kind === 'references' && (!Array.isArray(f.references) || !f.references.length)) out.push('references are missing.');
  }
  return out;
}

const cell = (s: unknown) => str(s).replace(/\|/g, '/').replace(/\n+/g, ' ');
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const question = (s: string) => {
  const t = str(s).replace(/^Final Thoughts:\s*/i, '');
  return /\?$/.test(t) ? t : `${t.replace(/[.!]$/, '')}?`;
};

/** Writes the filled template out as Markdown in the format the checker and the DOCX export expect. */
export function assemble(bp: Blueprint, f: Filled): string {
  const out: string[] = [`# ${str(f.title)}`, ...f.intro.map(str)];
  const listStyle = (s: Slot) => (s.kind === 'list' ? s.style : 'none');
  bp.body.forEach((b, i) => {
    const sec = f.sections[i];
    out.push(`## ${str(sec.heading)}`);
    b.slots.forEach((s, j) => {
      const v: any = sec.slots[j];
      if (s.kind === 'para') out.push(str(v));
      else if (s.kind === 'callout') out.push(`**${s.label}**`);
      else if (s.kind === 'table') {
        const rows: string[][] = v.table.rows.map((r: unknown[]) => Array.from({ length: s.cols }, (_, k) => cell(r?.[k])));
        out.push(
          [`| ${v.table.header.map(cell).join(' | ')} |`, `| ${Array(s.cols).fill('---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
        );
      } else {
        out.push(
          v.list
            .map((it: any) => {
              const term = str(it?.term).replace(/[:*]+$/g, '').replace(/\*\*/g, '');
              const text = sentence(str(it?.text));
              return listStyle(s) === 'bold' ? `- **${term}:** ${text}` : term ? `- ${term}: ${text}` : `- ${text}`;
            })
            .join('\n')
        );
      }
    });
  });
  for (const c of bp.closing) {
    if (c.kind === 'myth' && f.myth_vs_fact) {
      out.push('## Myth vs Fact', ['| Myth | Fact |', '| --- | --- |', ...f.myth_vs_fact.map((r) => `| ${cell(r.myth)} | ${cell(r.fact)} |`)].join('\n'));
    }
    if (c.kind === 'takeaways' && f.key_takeaways) out.push('## Key Takeaways', f.key_takeaways.map((t) => `- ${sentence(str(t))}`).join('\n'));
    if (c.kind === 'faq' && f.faqs) {
      out.push('## Frequently Asked Questions', ...f.faqs.map((q, i) => `**${i + 1}. ${question(q.question)}**\n${str(q.answer)}`));
    }
    if (c.kind === 'final' && f.final_thoughts) out.push(`## Final Thoughts: ${question(f.final_thoughts.question)}`, ...f.final_thoughts.paragraphs.map(str));
    if (c.kind === 'references' && f.references) {
      out.push(`## ${c.heading}`, f.references.map((r, i) => `${i + 1}. ${str(r).replace(/^\d+[.)]\s*/, '')}`).join('\n'));
    }
  }
  return `${out.join('\n\n')}\n`;
}

function parseJson(text: string): unknown {
  const body = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Fills the blueprint from the draft and assembles the article. Retries once with the problems found.
 * Returns null when the model can't produce a valid fill, so the caller can fall back to the draft.
 */
export async function buildFromBlueprint(
  bp: Blueprint,
  prompt: string,
  complete: (prompt: string) => Promise<string>
): Promise<{ article: string; attempts: number } | { article: null; attempts: number; problems: string[] }> {
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYOUR PREVIOUS REPLY DID NOT FIT THE TEMPLATE:\n${problems.map((x) => `- ${x}`).join('\n')}\nReply again with the complete JSON that fits exactly.`;
    const filled = parseJson(await complete(p));
    problems = validateFilled(bp, filled);
    if (!problems.length) return { article: assemble(bp, filled as Filled), attempts: attempt };
  }
  return { article: null, attempts: 2, problems };
}
