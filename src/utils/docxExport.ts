// Converts the delivered Markdown blog into a real .docx file laid out like the client's
// approved sample: plain bordered tables, bold-label callouts, bold numbered FAQ questions and a
// numbered reference list, using the sample template's fonts, sizes and margins when one is set.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };

/** Page and type settings; a client's sample template supplies its own. Sizes in points, lengths in mm. */
export interface ExportStyle {
  font: string;
  bodySize: number;
  h1Size: number;
  h2Size: number;
  h3Size: number;
  headingColor: string;
  marginMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

// Matches the client's approved sample article.
export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  font: 'Calibri',
  bodySize: 12,
  h1Size: 20,
  h2Size: 16,
  h3Size: 14,
  headingColor: '000000',
  marginMm: 25,
  pageWidthMm: 210,
  pageHeightMm: 297,
};

const mmToTwips = (mm: number) => Math.round((mm / 25.4) * 1440);
const BODY_SPACING = { after: 160, line: 276 };

type Inline = { bold?: boolean; italics?: boolean };

/** **bold**, *italic*, _italic_, `code` and [text](url) inside one line of text. */
export function inlineRuns(text: string, base: Inline = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    if (m[2] || m[3]) out.push(...inlineRuns(m[2] || m[3], { ...base, bold: true }));
    else if (m[4] || m[5]) out.push(...inlineRuns(m[4] || m[5], { ...base, italics: true }));
    else if (m[6]) out.push(new TextRun({ text: m[6], font: 'Courier New', ...base }));
    else if (m[7]) {
      out.push(new ExternalHyperlink({ link: m[8], children: [new TextRun({ text: m[7], style: 'Hyperlink', ...base })] }));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

/** Like inlineRuns, but bare https:// links (common in reference lists) become hyperlinks too. */
function withBareLinks(text: string, base: Inline = {}): ParagraphChild[] {
  if (/\]\(https?:/.test(text)) return inlineRuns(text, base);
  const parts = text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:'"])/g);
  return parts.flatMap((part, i) =>
    i % 2 === 1
      ? [new ExternalHyperlink({ link: part, children: [new TextRun({ text: part, style: 'Hyperlink', ...base })] })]
      : part
        ? inlineRuns(part, base)
        : []
  );
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function table(lines: string[], contentWidth: number): Table {
  const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(splitRow);
  const cols = Math.max(...rows.map((r) => r.length));
  const colWidth = Math.floor(contentWidth / cols);
  return new Table({
    width: { size: colWidth * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colWidth),
    rows: rows.map(
      (cells, r) =>
        new TableRow({
          tableHeader: r === 0,
          children: Array.from({ length: cols }, (_, c) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
              margins: { top: 60, bottom: 60, left: 110, right: 110 },
              children: [new Paragraph({ children: withBareLinks(cells[c] || '', r === 0 ? { bold: true } : {}) })],
            })
          ),
        })
    ),
  });
}

const BOLD_LINE = /^\*\*([^*]+)\*\*:?$/;

/** Markdown blog -> docx body blocks. */
export function markdownToDocxBlocks(markdown: string, contentWidth = mmToTwips(210 - 2 * 25)): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  // Each numbered list restarts at 1 (references must not continue an earlier list's numbers).
  let listInstance = 0;
  let inNumberedList = false;

  const flush = () => {
    if (!para.length) return;
    const [first, ...rest] = para;
    const q = first.match(BOLD_LINE);
    if (q && rest.length && /^\d+[.)]\s|\?$/.test(q[1].trim())) {
      // FAQ style from the sample: bold question, line break, answer in the same paragraph.
      blocks.push(
        new Paragraph({
          spacing: BODY_SPACING,
          children: [new TextRun({ text: q[1], bold: true }), new TextRun({ break: 1 }), ...withBareLinks(rest.join(' '))],
        })
      );
    } else if (q && rest.length) {
      // Callout label ("Clinical Note") on its own paragraph, then the text, as in the sample.
      blocks.push(new Paragraph({ spacing: BODY_SPACING, children: [new TextRun({ text: q[1], bold: true })] }));
      blocks.push(new Paragraph({ spacing: BODY_SPACING, children: withBareLinks(rest.join(' ')) }));
    } else {
      blocks.push(new Paragraph({ spacing: BODY_SPACING, children: withBareLinks(para.join(' ')) }));
    }
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (!numbered && t) inNumberedList = false;

    if (!t || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      continue;
    }
    const heading = t.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][
        heading[1].length - 1
      ];
      blocks.push(new Paragraph({ heading: level, children: inlineRuns(heading[2].replace(/\*\*/g, '')) }));
      continue;
    }
    if (t.startsWith('|')) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      i--;
      blocks.push(table(rows, contentWidth), new Paragraph({ spacing: { after: 0 }, children: [] }));
      continue;
    }
    if (t.startsWith('>')) {
      // Callouts in the sample are a bold label line followed by ordinary paragraphs, not boxes.
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().replace(/^>\s?/, ''));
      i--;
      for (const q of quote.filter(Boolean)) {
        const label = q.match(/^\*\*([^*]+?):?\*\*:?\s*(.*)$/);
        if (label) {
          blocks.push(new Paragraph({ spacing: BODY_SPACING, children: [new TextRun({ text: label[1].replace(/:$/, ''), bold: true })] }));
          if (label[2]) blocks.push(new Paragraph({ spacing: BODY_SPACING, children: withBareLinks(label[2]) }));
        } else {
          const b = q.match(/^[-*]\s+(.*)$/);
          blocks.push(
            new Paragraph({ spacing: BODY_SPACING, ...(b ? { bullet: { level: 0 } } : {}), children: withBareLinks(b ? b[1] : q) })
          );
        }
      }
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push(
        new Paragraph({
          bullet: { level: Math.min(Math.floor(bullet[1].length / 2), 2) },
          spacing: { after: 80 },
          children: withBareLinks(bullet[2]),
        })
      );
      continue;
    }
    if (numbered) {
      flush();
      if (!inNumberedList) listInstance++;
      inNumberedList = true;
      blocks.push(
        new Paragraph({
          numbering: { reference: 'numbers', level: 0, instance: listInstance },
          spacing: { after: 80 },
          children: withBareLinks(numbered[2]),
        })
      );
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

const heading = (id: string, name: string, size: number, before: number, outlineLevel: number, st: ExportStyle) => ({
  id,
  name,
  basedOn: 'Normal',
  next: 'Normal',
  quickFormat: true,
  run: { size, bold: true, color: st.headingColor || '000000', font: st.font },
  paragraph: { spacing: { before, after: 80 }, keepNext: true, outlineLevel },
});

export async function markdownToDocxBlob(markdown: string, title: string, style?: Partial<ExportStyle> | null): Promise<Blob> {
  const st: ExportStyle = { ...DEFAULT_EXPORT_STYLE, ...(style || {}) };
  const margin = mmToTwips(st.marginMm);
  const pageWidth = mmToTwips(st.pageWidthMm);
  const half = (pt: number) => Math.round(pt * 2);
  const doc = new Document({
    title,
    creator: 'BlogCraft',
    styles: {
      default: { document: { run: { font: st.font, size: half(st.bodySize) } } },
      paragraphStyles: [
        heading('Heading1', 'Heading 1', half(st.h1Size), 360, 0, st),
        heading('Heading2', 'Heading 2', half(st.h2Size), 240, 1, st),
        heading('Heading3', 'Heading 3', half(st.h3Size), 160, 2, st),
        heading('Heading4', 'Heading 4', half(st.bodySize), 160, 3, st),
      ],
    },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: pageWidth, height: mmToTwips(st.pageHeightMm) },
            margin: { top: margin, right: margin, bottom: margin, left: margin },
          },
        },
        children: markdownToDocxBlocks(markdown, pageWidth - 2 * margin),
      },
    ],
  });
  return Packer.toBlob(doc);
}

/** File name from the article's H1, falling back to the given name. */
export function docxFileName(markdown: string, fallback: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1] || fallback || 'blog';
  const slug = h1
    .replace(/[*_`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || 'blog'}.docx`;
}
