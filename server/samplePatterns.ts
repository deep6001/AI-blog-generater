// Reads the sample article's outline (from sampleDoc.ts) into the exact section patterns it uses,
// e.g. "2 paragraphs" or "2 paragraphs, then a callout label, then 2 paragraphs". Every body
// section of a new article must match one of them exactly.

export type PatternBlock = 'para' | 'callout' | 'table' | 'list';

export interface SectionPattern {
  blocks: PatternBlock[];
  /** Body sections in the sample with this pattern. */
  count: number;
  /** A heading from the sample that uses it, to show the writer. */
  example: string;
  tableCols?: number;
  listItems?: number;
  leadIn?: boolean;
  /** Items start with a plain "Term: explanation" lead-in (not bold). */
  plainLeadIn?: boolean;
  /** Callout labels the sample uses in sections of this pattern, e.g. ["Evidence Note"]. */
  labels: string[];
}

export interface SamplePatterns {
  /** Blocks under the title, before the first "## " heading. */
  intro: PatternBlock[] | null;
  body: SectionPattern[];
}

const CLOSING = /^(Myth vs Fact|Key Takeaways|Frequently Asked Questions|Final Thoughts|References)/i;

export const DEFAULT_OUTLINE = `# Title?
[2 paragraphs]
## Plain Question?
[2 paragraphs]
## Question With a Callout?
[2 paragraphs]
**Clinical Note** [bold label on its own line]
[2 paragraphs]
## How the Options Compare
[Table: 2 columns (A | B), 4 rows, bold header row]
## What Side Effects Can It Cause?
[1 paragraph]
[Bulleted list, 6 items, each starting with a bold lead-in.]
[1 paragraph]`;

export function patternsFromOutline(outline: string | null | undefined): SamplePatterns {
  let intro: PatternBlock[] | null = null;
  const sections: {
    heading: string;
    blocks: PatternBlock[];
    labels: string[];
    tableCols?: number;
    listItems?: number;
    leadIn?: boolean;
    plainLeadIn?: boolean;
  }[] = [];
  let current: (typeof sections)[number] | { blocks: PatternBlock[] } | null = null;

  for (const line of (outline || DEFAULT_OUTLINE).split('\n')) {
    const l = line.trim();
    if (/^#\s/.test(l)) {
      intro = [];
      current = { blocks: intro };
      continue;
    }
    const h = l.match(/^##\s+(.*)$/);
    if (h) {
      current = CLOSING.test(h[1]) ? null : { heading: h[1].trim(), blocks: [], labels: [] };
      if (current) sections.push(current as (typeof sections)[number]);
      continue;
    }
    if (!current) continue;
    const sec = current as (typeof sections)[number];
    const label = l.match(/^\*\*([^*]+)\*\*/)?.[1];
    if (label) {
      current.blocks.push('callout');
      sec.labels?.push(label.replace(/:$/, '').trim());
    }
    const paras = l.match(/^\[(\d+) paragraphs?/);
    if (paras) current.blocks.push(...Array<PatternBlock>(Number(paras[1])).fill('para'));
    const table = l.match(/^\[Table: (\d+) columns?/);
    if (table) {
      current.blocks.push('table');
      sec.tableCols = Number(table[1]);
    }
    const list = l.match(/^\[(?:Bulleted|Numbered) list, (\d+) items?/);
    if (list) {
      current.blocks.push('list');
      sec.listItems = Number(list[1]);
      sec.leadIn = /bold lead-in/.test(l);
      sec.plainLeadIn = !sec.leadIn && /e\.g\. "[^":]{2,60}:\s/.test(l);
    }
  }

  const body: SectionPattern[] = [];
  for (const s of sections) {
    if (!s.blocks.length) continue;
    const same = body.find(
      (p) => p.blocks.join() === s.blocks.join() && p.tableCols === s.tableCols && p.leadIn === s.leadIn
    );
    if (same) {
      same.count++;
      same.labels.push(...s.labels.filter((l) => !same.labels.includes(l)));
    }
    else
      body.push({
        blocks: s.blocks,
        count: 1,
        example: s.heading,
        tableCols: s.tableCols,
        listItems: s.listItems,
        leadIn: s.leadIn,
        plainLeadIn: s.plainLeadIn,
        labels: [...s.labels],
      });
  }
  return { intro: intro && (intro as PatternBlock[]).length ? intro : null, body };
}

/** "2 paragraphs, then a callout label, then 2 paragraphs" */
export function describeBlocks(
  blocks: PatternBlock[],
  extra: { tableCols?: number; listItems?: number; leadIn?: boolean; plainLeadIn?: boolean } = {}
): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; ) {
    let n = 1;
    while (blocks[i + n] === blocks[i]) n++;
    const b = blocks[i];
    parts.push(
      b === 'para'
        ? `${n} paragraph${n > 1 ? 's' : ''}`
        : b === 'callout'
          ? 'a bold callout label on its own line'
          : b === 'table'
            ? `a table${extra.tableCols ? ` with ${extra.tableCols} columns` : ''}`
            : `a bulleted list${extra.listItems ? ` of about ${extra.listItems} items` : ''}${
                extra.leadIn
                  ? ', each item starting with a bold lead-in ("- **Lead-in:** explanation.")'
                  : extra.plainLeadIn
                    ? ', each item written as "- Term: explanation." with the term in plain text, NOT bold'
                    : ''
              }`
    );
    i += n;
  }
  return parts.join(', then ') || 'nothing';
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** The patterns as instructions for the writer and the editor. */
export function patternsText(p: SamplePatterns): string {
  const lines = p.body.map((s, i) => {
    const special = s.blocks.includes('table') || s.blocks.includes('list');
    const uses = special
      ? `use in exactly ${s.count} section${s.count > 1 ? 's' : ''}`
      : s.blocks.includes('callout')
        ? 'one section per callout'
        : 'use for every other body section';
    const labels = s.labels.length ? `; the sample uses ${s.labels.map((l) => `**${l}**`).join(' or ')} here` : '';
    return `${letter(i)}) ${describeBlocks(s.blocks, s)}. (${uses}${labels}; e.g. "${s.example}")`;
  });
  return `Body section patterns. These apply ONLY to the body sections between the introduction and "Myth vs Fact". Every body "## " section must match ONE of them exactly, with the same number of paragraphs in the same places. They do NOT apply to the closing sections (Myth vs Fact, Key Takeaways, Frequently Asked Questions, Final Thoughts, References), which keep their own formats: a table, a bulleted list, numbered bold questions with answers, paragraphs, and a numbered list:
${p.intro ? `- Under the title, before the first heading: ${describeBlocks(p.intro)}.\n` : ''}${lines.map((l) => `- ${l}`).join('\n')}`;
}
