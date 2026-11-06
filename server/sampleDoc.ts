// Reads an approved sample article (.docx) and describes its layout, so new blogs can follow it
// without copying its wording. Produces a Markdown-like outline plus the document's styling.
import { unzipSync, strFromU8 } from 'fflate';

export interface SampleStyle {
  font: string;
  /** Point sizes. */
  bodySize: number;
  h1Size: number;
  h2Size: number;
  h3Size: number;
  headingColor: string;
  /** Millimetres. */
  marginMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

export interface SampleSummary {
  outline: string;
  style: SampleStyle;
  wordCount: number;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const attr = (xml: string, tag: string, name: string) =>
  xml.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="([^"]*)"`))?.[1];

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function textOf(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<w:tab\/>/g)) {
    out += m[1] !== undefined ? m[1] : m[0] === '<w:br/>' ? '\n' : ' ';
  }
  return decode(out);
}

/** True when every text run in the paragraph is bold. */
function allBold(p: string): boolean {
  const runs = p.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];
  const textRuns = runs.filter((r) => /<w:t[\s>]/.test(r) && textOf(r).trim());
  return textRuns.length > 0 && textRuns.every((r) => /<w:b\/>|<w:b w:val="(1|true)"\/>/.test(r));
}

/** First run bold and followed by more text: "Low potassium: ..." style lead-in. */
function boldLeadIn(p: string): boolean {
  const runs = (p.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []).filter((r) => textOf(r).trim());
  return runs.length > 1 && /<w:b\/>/.test(runs[0]) && !/<w:b\/>/.test(runs[runs.length - 1]);
}

function styleSizes(stylesXml: string, themeXml: string) {
  const style = (id: string) => stylesXml.match(new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] || '';
  const defaults = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] || '';
  const halfPts = (xml: string) => Number(attr(xml, 'sz', 'val')) / 2 || undefined;
  const minorTheme = themeXml.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/)?.[1];
  const fontOf = (xml: string) => attr(xml, 'rFonts', 'ascii') || (attr(xml, 'rFonts', 'asciiTheme')?.startsWith('minor') ? minorTheme : undefined);
  const normal = style('Normal');
  return {
    font: fontOf(normal) || fontOf(defaults) || minorTheme || 'Calibri',
    bodySize: halfPts(normal) || halfPts(defaults) || 11,
    h1Size: halfPts(style('Heading1')) || 20,
    h2Size: halfPts(style('Heading2')) || 16,
    h3Size: halfPts(style('Heading3')) || 14,
    headingColor: attr(style('Heading2'), 'color', 'val') || attr(style('Heading1'), 'color', 'val') || '000000',
  };
}

/** Maps numId -> "bullet" | "decimal" from numbering.xml. */
function listFormats(numberingXml: string): Map<string, string> {
  const abstractFmt = new Map<string, string>();
  for (const m of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)) {
    abstractFmt.set(m[1], attr(m[0], 'numFmt', 'val') || 'bullet');
  }
  const out = new Map<string, string>();
  for (const m of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) {
    out.set(m[1], abstractFmt.get(m[2]) || 'bullet');
  }
  return out;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; words: number; boldLabel?: string; faq?: boolean; link: boolean }
  | { kind: 'list'; format: string; count: number; leadIn: boolean; example: string }
  | { kind: 'table'; rows: number; header: string[] };

export function summariseSampleDocx(bytes: Uint8Array): SampleSummary {
  const files = unzipSync(bytes, { filter: (f) => /^word\/(document|styles|numbering)\.xml$|^word\/theme\/theme1\.xml$/.test(f.name) });
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('This file is not a Word .docx document.');
  const documentXml = strFromU8(doc);
  const stylesXml = files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : '';
  const themeXml = files['word/theme/theme1.xml'] ? strFromU8(files['word/theme/theme1.xml']) : '';
  const numbering = listFormats(files['word/numbering.xml'] ? strFromU8(files['word/numbering.xml']) : '');

  const body = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] || '';
  const blocks: Block[] = [];
  let wordCount = 0;

  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const el = m[0];
    if (el.startsWith('<w:tbl')) {
      const rows = el.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
      const header = (rows[0]?.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map((c) => textOf(c).trim());
      wordCount += words(textOf(el));
      blocks.push({ kind: 'table', rows: rows.length, header });
      continue;
    }
    const text = textOf(el).trim();
    if (!text) continue;
    wordCount += words(text);
    const styleId = attr(el, 'pStyle', 'val') || '';
    const level = styleId.match(/^Heading(\d)$/i)?.[1] ?? (styleId === 'Title' ? '1' : undefined);
    if (level) {
      blocks.push({ kind: 'heading', level: Number(level), text });
      continue;
    }
    const numId = attr(el, 'numId', 'val');
    if (numId) {
      const format = numbering.get(numId) === 'decimal' ? 'numbered' : 'bulleted';
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'list' && prev.format === format) prev.count++;
      else blocks.push({ kind: 'list', format, count: 1, leadIn: boldLeadIn(el), example: text.slice(0, 140) });
      continue;
    }
    const [firstLine, ...rest] = text.split('\n');
    if (allBold(el) && words(text) <= 6) {
      blocks.push({ kind: 'para', words: 0, boldLabel: text, link: false });
    } else if (rest.length && /^\d+[.)]\s/.test(firstLine)) {
      blocks.push({ kind: 'para', words: words(rest.join(' ')), faq: true, link: false });
    } else {
      blocks.push({ kind: 'para', words: words(text), link: /<w:hyperlink\b/.test(el) });
    }
  }

  // Collapse runs of plain paragraphs into "[N paragraphs, ~W words each]".
  const lines: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'heading') lines.push(`${'#'.repeat(b.level)} ${b.text}`);
    else if (b.kind === 'table') lines.push(`[Table: ${b.header.length} columns (${b.header.join(' | ')}), ${b.rows - 1} rows, bold header row]`);
    else if (b.kind === 'list') {
      lines.push(
        `[${b.format === 'numbered' ? 'Numbered' : 'Bulleted'} list, ${b.count} items${b.leadIn ? ', each starting with a bold lead-in' : ''}. e.g. "${b.example}"]`
      );
    } else if (b.boldLabel) lines.push(`**${b.boldLabel}** [bold label on its own line]`);
    else if (b.faq) {
      let n = 0;
      while (blocks[i + n]?.kind === 'para' && (blocks[i + n] as any).faq) n++;
      lines.push(`[${n} FAQ items: bold numbered question, line break, answer of ~${b.words} words]`);
      i += n - 1;
    } else {
      const run: number[] = [];
      let linked = false;
      while (blocks[i]?.kind === 'para' && !(blocks[i] as any).boldLabel && !(blocks[i] as any).faq) {
        const p = blocks[i] as Extract<Block, { kind: 'para' }>;
        run.push(p.words);
        linked ||= p.link;
        i++;
      }
      i--;
      const avg = Math.round(run.reduce((a, n) => a + n, 0) / run.length);
      const size = run.length > 1 ? `${run.length} paragraphs, ~${avg} words each` : `1 paragraph, ~${avg} words`;
      lines.push(`[${size}${linked ? ', contains an internal link' : ''}]`);
    }
  }

  const sect = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || '';
  const twipsToMm = (v?: string) => (v ? Math.round((Number(v) / 1440) * 25.4) : undefined);
  return {
    outline: lines.join('\n'),
    wordCount,
    style: {
      ...styleSizes(stylesXml, themeXml),
      marginMm: twipsToMm(attr(sect, 'pgMar', 'left')) || 25,
      pageWidthMm: twipsToMm(attr(sect, 'pgSz', 'w')) || 210,
      pageHeightMm: twipsToMm(attr(sect, 'pgSz', 'h')) || 297,
    },
  };
}

/** Added to step prompts and the QA review when a profile has a sample article. */
export function sampleContext(outline: string, wordCount?: number | null): string {
  return `

### Approved sample article layout (follow this structure)
The client approved the article outlined below as the model for every blog. Match its structure: the order and type of sections, Title Case question-style headings, paragraphs per section and their length, where tables, bold-label callouts and lists appear, and the exact closing sections and their formats.${wordCount ? ` The sample is about ${wordCount} words.` : ''}
Headings shown are examples of style only. Write about the new topic, and never copy the sample's wording or facts.

${outline}`;
}
