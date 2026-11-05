import type { PipelineStep, Project, ProjectUsageRecord, RunSession } from '../types/pipeline.ts';

/**
 * Replaces placeholder variables in a prompt template like {{user_input}} or {{input}}
 * with their mapped values. If placeholders are absent, intelligently appends context.
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string | undefined>
): string {
  let result = template;

  // Support both {{input}} and {{user_input}}
  if (variables.user_input && !variables.input) {
    variables.input = variables.user_input;
  }
  if (variables.input && !variables.user_input) {
    variables.user_input = variables.input;
  }

  // Support both {{previous_step}} and {{previous_step_output}}
  if (variables.previous_step_output && !variables.previous_step) {
    variables.previous_step = variables.previous_step_output;
  }
  if (variables.previous_step && !variables.previous_step_output) {
    variables.previous_step_output = variables.previous_step;
  }

  const placeholder = (name: string, flags?: string) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, flags);
  const usesTopic = ['input', 'user_input'].some((n) => placeholder(n).test(template)) || /\[(blog )?topic\]/i.test(template);
  const usesPrevious =
    ['previous_step', 'previous_step_output'].some((n) => placeholder(n).test(template)) ||
    placeholder('step_\\d+_output').test(template);

  for (const [key, val] of Object.entries(variables)) {
    result = result.replace(placeholder(key, 'g'), val ?? '');
  }
  // Plain-English placeholders people type into prompts, e.g. "Write about [BLOG TOPIC]".
  if (variables.input) result = result.replace(/\[(blog )?topic\]/gi, variables.input);

  // A prompt that doesn't reference the topic or the previous step still gets both,
  // otherwise later steps lose the subject of the blog.
  if (!usesTopic && variables.input) {
    result += `\n\nBlog topic:\n${variables.input}`;
  }
  if (!usesPrevious && variables.previous_step) {
    result += `\n\nOutput of the previous step (build on it):\n${variables.previous_step}`;
  }

  return result;
}

/**
 * Extracts variable names from template string formatted as {{var_name}}
 */
export function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g);
  if (!matches) return [];
  const uniqueVars = new Set<string>();
  for (const match of matches) {
    const cleaned = match.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
    if (cleaned) uniqueVars.add(cleaned);
  }
  return Array.from(uniqueVars);
}

/**
 * Validates step configuration before running or saving.
 */
export function validateStep(step: Partial<PipelineStep>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!step.title || step.title.trim().length === 0) {
    errors.push('Step title is required.');
  }
  if (!step.promptTemplate || step.promptTemplate.trim().length === 0) {
    errors.push('Prompt is required.');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculates blog statistics from markdown content.
 */
export function calculateBlogMetrics(markdown: string): {
  wordCount: number;
  charCount: number;
  readingTimeMinutes: number;
  headingCount: number;
} {
  if (!markdown || !markdown.trim()) {
    return { wordCount: 0, charCount: 0, readingTimeMinutes: 0, headingCount: 0 };
  }
  const cleanText = markdown
    .replace(/```[\s\S]*?```/g, ' ') // Strip code blocks for word count
    .replace(/[#*`_~>[\]()-]/g, ' ')
    .trim();

  const words = cleanText.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const charCount = markdown.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
  const headingMatches = markdown.match(/^#{1,6}\s+.+$/gm);
  const headingCount = headingMatches ? headingMatches.length : 0;

  return {
    wordCount,
    charCount,
    readingTimeMinutes,
    headingCount,
  };
}

/**
 * Strips markdown and image tags to generate clean plain text.
 * Strictly guarantees no images in compliance with user constraints.
 */
export function generatePlainTextDocument(markdown: string): string {
  return markdown
    .replace(/!\[.*?\]\(.*?\)/g, '') // Strip image markdown
    .replace(/<img[^>]*>/gi, '') // Strip HTML images
    .replace(/^#+\s+/gm, '') // Strip heading tags
    .replace(/\*\*(.*?)\*\*/g, '$1') // Strip bold
    .replace(/\*(.*?)\*/g, '$1') // Strip italics
    .replace(/`([^`]+)`/g, '$1') // Strip inline code
    .replace(/```[\s\S]*?```/g, '') // Strip code fences
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)') // Links to readable text
    .trim();
}

/**
 * Converts markdown text into structured semantic HTML.
 * Includes full support for tables, callouts, lists, and headings,
 * while STRICTLY stripping all images per instructions.
 */
export function markdownToClinicalHtml(markdown: string): string {
  // 1. Strip images
  let content = markdown
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/<img[^>]*>/gi, '');

  const lines = content.split('\n');
  const output: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let inTable = false;
  let tableHeaderParsed = false;
  let inBlockquote = false;
  let blockquoteBuffer: string[] = [];

  const flushBlockquote = () => {
    if (inBlockquote && blockquoteBuffer.length > 0) {
      const fullText = blockquoteBuffer.join(' ');
      let calloutClass = 'clinical-callout generic';
      let icon = '📌';
      let label = 'Clinical Note';

      if (/Research Insight/i.test(fullText)) {
        calloutClass = 'clinical-callout research';
        icon = '🔬';
        label = 'Research Insight';
      } else if (/Evidence Note/i.test(fullText)) {
        calloutClass = 'clinical-callout evidence';
        icon = '🧪';
        label = 'Evidence Note';
      } else if (/UK Guidance Note|NICE/i.test(fullText)) {
        calloutClass = 'clinical-callout guidance';
        icon = '🏛️';
        label = 'UK Guidance Note';
      } else if (/Red Flag|Urgent|Warning/i.test(fullText)) {
        calloutClass = 'clinical-callout redflag';
        icon = '🚨';
        label = 'Urgent Clinical Alert';
      }

      const formatted = formatInlineText(
        fullText
          .replace(/^\s*\*\*.*?\*\*:\s*/, '')
          .replace(/^\s*\*\*.*?\*\*\s*/, '')
      );

      output.push(`
<div class="${calloutClass}">
  <div class="callout-header"><span class="callout-icon">${icon}</span> <strong>${label}</strong></div>
  <div class="callout-body">${formatted}</div>
</div>`);
      blockquoteBuffer = [];
      inBlockquote = false;
    }
  };

  const flushList = () => {
    if (inList) {
      output.push(inList === 'ul' ? '</ul>' : '</ol>');
      inList = null;
    }
  };

  const flushTable = () => {
    if (inTable) {
      output.push('</tbody></table></div>');
      inTable = false;
      tableHeaderParsed = false;
    }
  };

  const formatInlineText = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Table Row Detection
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      flushBlockquote();

      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

      // Check if it's separator line like |---|---|
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));

      if (isSeparator) {
        tableHeaderParsed = true;
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeaderParsed = false;
        output.push('<div class="table-container"><table class="clinical-table">');
        output.push('<thead><tr>');
        cells.forEach((cell) => {
          output.push(`<th>${formatInlineText(cell.replace(/\*\*/g, ''))}</th>`);
        });
        output.push('</tr></thead><tbody>');
        continue;
      }

      output.push('<tr>');
      cells.forEach((cell) => {
        output.push(`<td>${formatInlineText(cell)}</td>`);
      });
      output.push('</tr>');
      continue;
    } else {
      flushTable();
    }

    // Blockquote
    if (line.startsWith('>')) {
      flushList();
      inBlockquote = true;
      blockquoteBuffer.push(line.replace(/^>\s*/, ''));
      continue;
    } else {
      flushBlockquote();
    }

    // Unordered List
    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inList !== 'ul') {
        flushList();
        output.push('<ul class="clinical-list">');
        inList = 'ul';
      }
      output.push(`<li>${formatInlineText(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered List
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (inList !== 'ol') {
        flushList();
        output.push('<ol class="clinical-list-ordered">');
        inList = 'ol';
      }
      output.push(`<li>${formatInlineText(olMatch[2])}</li>`);
      continue;
    }

    flushList();

    if (!line) {
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      output.push(`<h1 class="clinical-h1">${formatInlineText(line.replace('# ', ''))}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      output.push(`<h2 class="clinical-h2">${formatInlineText(line.replace('## ', ''))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      output.push(`<h3 class="clinical-h3">${formatInlineText(line.replace('### ', ''))}</h3>`);
      continue;
    }
    if (line.startsWith('#### ')) {
      output.push(`<h4 class="clinical-h4">${formatInlineText(line.replace('#### ', ''))}</h4>`);
      continue;
    }

    if (line === '---' || line === '***') {
      output.push('<hr class="clinical-divider" />');
      continue;
    }

    // FAQ styling check
    if (/^\*\*\d+\.\s+.*\*\*$/.test(line)) {
      output.push(`<div class="faq-question"><strong>${formatInlineText(line.replace(/\*\*/g, ''))}</strong></div>`);
      continue;
    }

    output.push(`<p class="clinical-p">${formatInlineText(line)}</p>`);
  }

  flushList();
  flushBlockquote();
  flushTable();

  return output.join('\n');
}

/**
 * Generates a complete standalone, responsive Medical HTML document
 * matching Prostate Clinic London style (Harley Street urology standard),
 * including clinic header, reviewer attribution, print stylesheet, and zero images.
 */
export function generateMedicalHtmlDocument(title: string, markdown: string, project: Project): string {
  const metrics = calculateBlogMetrics(markdown);
  const bodyHtml = markdownToClinicalHtml(markdown);
  const nowStr = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Prostate Clinic London</title>
  <style>
    :root {
      --navy-900: #0a1e38;
      --navy-800: #0f284e;
      --navy-700: #1a3a6b;
      --teal-600: #0d9488;
      --teal-700: #0f766e;
      --slate-50: #f8fafc;
      --slate-100: #f1f5f9;
      --slate-200: #e2e8f0;
      --slate-600: #475569;
      --slate-700: #334155;
      --slate-900: #0f172a;
      --rose-50: #fff1f2;
      --rose-200: #fecdd3;
      --rose-700: #be123c;
      --indigo-50: #eef2ff;
      --indigo-100: #e0e7ff;
      --indigo-700: #4338ca;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.7;
      color: var(--slate-700);
      background-color: var(--slate-50);
      padding: 2rem 1rem;
    }
    .article-wrapper {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid var(--slate-200);
      border-radius: 16px;
      padding: 3rem 2.5rem;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
    }
    .clinic-badge-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--slate-200);
    }
    .clinic-brand {
      font-weight: 800;
      font-size: 1.15rem;
      color: var(--navy-800);
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .clinic-sub {
      font-size: 0.78rem;
      color: var(--slate-600);
      font-weight: 500;
    }
    .author-review-card {
      background: #f8fafc;
      border: 1px solid var(--slate-200);
      border-left: 4px solid var(--teal-600);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 2rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 0.85rem;
    }
    .reviewer-title {
      font-weight: 700;
      color: var(--navy-800);
    }
    .meta-pills {
      display: flex;
      gap: 1rem;
      color: var(--slate-600);
      font-size: 0.8rem;
    }
    .clinical-h1 {
      font-size: 2.15rem;
      font-weight: 800;
      color: var(--navy-900);
      line-height: 1.25;
      letter-spacing: -0.03em;
      margin-bottom: 1.5rem;
    }
    .clinical-h2 {
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--navy-800);
      margin-top: 2.5rem;
      margin-bottom: 0.85rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--slate-200);
      letter-spacing: -0.02em;
    }
    .clinical-h3 {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--navy-700);
      margin-top: 1.75rem;
      margin-bottom: 0.6rem;
    }
    .clinical-h4 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--slate-900);
      margin-top: 1.25rem;
      margin-bottom: 0.4rem;
    }
    .clinical-p {
      margin-bottom: 1.25rem;
      font-size: 1rem;
      color: var(--slate-700);
      line-height: 1.75;
    }
    .table-container {
      overflow-x: auto;
      margin: 2rem 0;
      border: 1px solid var(--slate-200);
      border-radius: 8px;
    }
    .clinical-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.92rem;
    }
    .clinical-table th {
      background-color: var(--slate-100);
      color: var(--navy-800);
      font-weight: 700;
      padding: 0.85rem 1.1rem;
      border-bottom: 2px solid var(--slate-200);
    }
    .clinical-table td {
      padding: 0.85rem 1.1rem;
      border-bottom: 1px solid var(--slate-200);
      vertical-align: top;
      color: var(--slate-700);
    }
    .clinical-table tr:nth-child(even) {
      background-color: #fafbfc;
    }
    .clinical-callout {
      border-radius: 10px;
      padding: 1.25rem 1.5rem;
      margin: 1.75rem 0;
      border-left: 5px solid;
    }
    .clinical-callout.research {
      background-color: #f0f7ff;
      border-left-color: #2563eb;
    }
    .clinical-callout.evidence {
      background-color: #f0fdf4;
      border-left-color: var(--teal-600);
    }
    .clinical-callout.guidance {
      background-color: var(--indigo-50);
      border-left-color: var(--indigo-700);
    }
    .clinical-callout.redflag {
      background-color: var(--rose-50);
      border-left-color: var(--rose-700);
    }
    .clinical-callout.generic {
      background-color: var(--slate-100);
      border-left-color: var(--slate-600);
    }
    .callout-header {
      font-weight: 700;
      font-size: 0.95rem;
      margin-bottom: 0.4rem;
      color: var(--navy-800);
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .callout-body {
      font-size: 0.95rem;
      color: var(--slate-700);
      line-height: 1.65;
    }
    .clinical-list, .clinical-list-ordered {
      margin: 1rem 0 1.5rem 1.5rem;
      line-height: 1.75;
      font-size: 0.98rem;
    }
    .clinical-list li, .clinical-list-ordered li {
      margin-bottom: 0.4rem;
    }
    .faq-question {
      background: var(--slate-50);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border-left: 3px solid var(--teal-600);
      font-weight: 700;
      color: var(--navy-800);
      margin-top: 1.25rem;
      margin-bottom: 0.5rem;
    }
    .clinical-divider {
      border: 0;
      border-top: 1px solid var(--slate-200);
      margin: 2.5rem 0;
    }
    .consultation-cta-card {
      background: linear-gradient(135deg, var(--navy-800) 0%, var(--navy-900) 100%);
      color: #ffffff;
      border-radius: 12px;
      padding: 2rem;
      margin: 3rem 0;
      text-align: center;
    }
    .consultation-cta-card h3 {
      font-size: 1.35rem;
      margin-bottom: 0.5rem;
      font-weight: 800;
    }
    .consultation-cta-card p {
      font-size: 0.95rem;
      color: #cbd5e1;
      max-width: 600px;
      margin: 0 auto 1.25rem auto;
    }
    .consultation-cta-card .contact-details {
      display: inline-flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      justify-content: center;
      font-size: 0.9rem;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.1);
      padding: 0.75rem 1.5rem;
      border-radius: 50px;
    }
    .medical-disclaimer {
      font-size: 0.8rem;
      color: var(--slate-600);
      background-color: var(--slate-100);
      padding: 1.25rem;
      border-radius: 8px;
      margin-top: 2rem;
      line-height: 1.5;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .article-wrapper { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .consultation-cta-card { background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; }
      .consultation-cta-card p { color: #334155; }
      .consultation-cta-card .contact-details { background: #e2e8f0; color: #0f172a; }
    }
  </style>
</head>
<body>
  <div class="article-wrapper">
    <div class="clinic-badge-header">
      <div>
        <div class="clinic-brand">Prostate Clinic London</div>
        <div class="clinic-sub">10 Harley Street, London W1G 9PF &bull; Specialist Urology Care</div>
      </div>
      <div class="meta-pills">
        <span>📅 ${nowStr}</span>
        <span>⏱️ ${metrics.readingTimeMinutes} min read</span>
        <span>📖 ${metrics.wordCount} words</span>
      </div>
    </div>

    <div class="author-review-card">
      <div>
        <span class="reviewer-title">✓ Clinically Reviewed</span> &bull; <span>Consultant Urological Surgeon</span>
      </div>
      <div style="color: var(--slate-600);">
        Evidence-Based Medical Reference | Strictly Text & Clinical Tables
      </div>
    </div>

    <main>
      ${bodyHtml}
    </main>

    <div class="consultation-cta-card">
      <h3>Specialist Consultation & Second Opinions</h3>
      <p>If you are experiencing persistent or recurring prostate, pelvic, or urinary symptoms, specialist clinical investigation can identify the underlying cause and targeted treatment.</p>
      <div class="contact-details">
        <span>📍 10 Harley Street, London W1G 9PF</span>
        <span>📞 020 3928 7447</span>
        <span>🌐 prostatecliniclondon.co.uk</span>
      </div>
    </div>

    <div class="medical-disclaimer">
      <strong>Medical Disclaimer:</strong> This publication is produced for informational and educational purposes in accordance with British clinical guidelines (NICE, MHRA, and AUA standards). It does not replace individualized diagnostic assessment or specialist medical consultation. If you develop acute urinary retention, high fever with pelvic pain, or signs of systemic infection, seek immediate emergency medical care.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates an HTML-based Microsoft Word (.doc) document that opens
 * seamlessly in Word and Google Docs with all formatting, tables, and styles intact.
 */
export function generateWordDocContent(title: string, markdown: string, project: Project): string {
  const bodyHtml = markdownToClinicalHtml(markdown);

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body { font-family: "Calibri", "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a202c; }
    h1 { font-size: 20pt; font-weight: bold; color: #0f284e; margin-bottom: 8pt; }
    h2 { font-size: 14pt; font-weight: bold; color: #1a3a6b; margin-top: 14pt; margin-bottom: 4pt; border-bottom: 1pt solid #e2e8f0; }
    h3 { font-size: 12pt; font-weight: bold; color: #2d3748; margin-top: 10pt; margin-bottom: 3pt; }
    p { margin-bottom: 8pt; }
    table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 10pt; }
    th { background-color: #f1f5f9; color: #0f284e; font-weight: bold; border: 1pt solid #cbd5e1; padding: 6pt 8pt; }
    td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; vertical-align: top; }
    .clinical-callout { background-color: #f8fafc; border-left: 4pt solid #0d9488; padding: 8pt 12pt; margin: 10pt 0; }
    .callout-header { font-weight: bold; color: #0f284e; margin-bottom: 3pt; }
    .clinical-divider { border-top: 1pt solid #e2e8f0; margin: 16pt 0; }
    .meta-card { background-color: #f8fafc; border: 1pt solid #e2e8f0; padding: 8pt; margin-bottom: 12pt; font-size: 9pt; }
    .disclaimer { font-size: 9pt; color: #64748b; background-color: #f1f5f9; padding: 8pt; margin-top: 16pt; }
  </style>
</head>
<body>
  <div class="meta-card">
    <strong>Prostate Clinic London</strong> &bull; 10 Harley Street, London W1G 9PF<br/>
    <strong>Clinical Review:</strong> Consultant Urological Surgeon &bull; Formatted Clinical Guide
  </div>
  ${bodyHtml}
  <div class="disclaimer">
    <strong>Medical Disclaimer:</strong> This clinical article is prepared for educational purposes according to current clinical guidelines. It does not constitute individual medical diagnosis or care.
  </div>
</body>
</html>`;
}

/**
 * Returns pre-built starter projects showcasing different multi-step pipelines.
 * Features Prostate Clinic London Medical Guide as the premier preset.
 */
export function createDefaultProjects(): Project[] {
  const now = new Date().toISOString();

  return [
    {
      id: 'proj-prostate-clinic-london',
      name: 'Clinical Healthcare & Specialist Medical Guide (Prostate Clinic London Format)',
      description:
        'A 5-stage medical publishing pipeline modeled directly on Prostate Clinic London (prostatecliniclondon.co.uk/blog). Generates patient-centered, evidence-grounded articles with differential diagnosis tables, Research Insights, NICE guidelines, Myth vs Fact, and clinical FAQs. Strictly NO image placeholders.',
      targetAudience:
        'Patients, individuals with recurrent symptoms, men seeking prostate advice, and family caregivers',
      tone: 'Authoritative, calm, compassionate, evidence-based British clinical medical standard (Consultant Urologist perspective)',
      targetWordCount: 1800,
      tags: ['Medical Clinic', 'Prostate Clinic London', 'Clinical Authority', 'Patient Guide', 'No Images'],
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 'step-1-clinical-angle',
          title: 'Stage 1: Patient Dilemma & Differential Diagnosis Angle',
          description:
            'Dissects patient anxiety, differentiates chronic pain vs infection, and articulates high-trust clinical hypotheses.',
          systemRole: 'Consultant Urological Surgeon & Senior Clinical Communicator',
          promptTemplate: `You are a Consultant Urological Surgeon communicating clearly to patients in the exact medical style of Prostate Clinic London.
Topic / Patient Dilemma: {{user_input}}
Target Audience: {{project_audience}}
Clinical Tone: {{project_tone}}

Analyze this medical topic from a consultant specialist perspective:
1. Primary Patient Dilemma & Anxiety (e.g. Why do symptoms keep coming back? Is it recurrent bacterial infection, antimicrobial resistance, or CP/CPPS? Could it be prostate cancer? Why did previous antibiotics stop working?).
2. Clinical Differential Diagnoses (e.g. chronic bacterial prostatitis relapse vs reinfection with a new organism vs CP/CPPS non-bacterial pelvic pain vs pelvic-floor tension myalgia vs urethral stricture / urinary retention).
3. Recommended Working Title: Formulate 3 empathetic, direct patient-inquiry titles (e.g., 'Why Does Prostatitis Keep Coming Back?', 'Antibiotics for Prostatitis: When Do They Not Help?'). Select the single strongest title.
4. Key Clinical Guidelines & Evidence to Anchor: Note relevant British & international guidance (e.g. NICE NG110 acute prostatitis prescribing, UK MHRA fluoroquinolone safety restrictions, AUA male chronic pelvic pain guidelines).
CRITICAL RULE: STRICTLY NO IMAGES, NO IMAGE PROMPTS, NO IMAGE PLACEHOLDERS.`,
          temperature: 0.6,
          isEnabled: true,
        },
        {
          id: 'step-2-clinical-blueprint',
          title: 'Stage 2: Clinical Outline & Diagnostic Comparison Table',
          description:
            'Constructs the clinical H2/H3 blueprint, diagnostic testing pathways, and explanation tables.',
          systemRole: 'Clinical Guidelines Architect & Medical Director',
          promptTemplate: `Based on the clinical analysis:
{{previous_step_output}}

Design an exhaustive, reassuring patient-facing article blueprint following Prostate Clinic London's exact architecture.
Outline Requirements:
- Empathetic Introduction: Validate frustration with returning symptoms; clarify why symptoms do not always equal active infection.
- Section 1: What Does the Condition Actually Mean? (Definitions, relapse vs reinfection vs non-bacterial flare).
- Section 2: Why Might Symptoms Keep Returning? (Structured Clinical Comparison Table blueprint with 3 columns: Possible explanation | What may suggest it | Usual next step).
- Section 3: Deep Clinical Explanations:
  * Persistent bacterial colonization and prostate tissue penetration
  * Antibiotic resistance and why repeat empiric courses fail
  * Underlying urinary problems (poor flow, high residual urine, urethral stricture)
  * Pelvic-floor dysfunction (tension myalgia, muscle spasm)
  * Stress, nervous system sensitization, and CP/CPPS flares
- Section 4: What Tests Are Useful When Symptoms Persist? (Urine culture, previous culture review, STI testing, flow rate, ultrasound post-void residual, pelvic exam).
- Section 5: Evidence-Based Treatment Pathways (Culture-directed antibiotics, MHRA fluoroquinolone warning, CP/CPPS multimodal care, pelvic physiotherapy).
- Section 6: When to See a Specialist & Red Flag Symptoms (Urgent same-day assessment, acute retention, fever/chills, hospital referral criteria).
- Section 7: Myth vs. Fact Clinical Table (Debunking common myths).
- Section 8: Key Takeaways (6-8 clear clinical bullet points).
- Section 9: Frequently Asked Questions (8-10 numbered clinical questions with direct answers).
- Section 10: Final Thoughts, Specialist Consultation CTA (Prostate Clinic London), Academic References (NICE, PubMed citations), and Clinical Disclaimer.
CRITICAL RULE: STRICTLY NO IMAGES, NO IMAGE TAGS, NO IMAGE PLACEHOLDERS.`,
          temperature: 0.5,
          isEnabled: true,
        },
        {
          id: 'step-3-clinical-draft',
          title: 'Stage 3: Deep Patient-Centric Clinical Draft',
          description:
            'Drafts the extensive body prose with explanation tables, research insights, and compassionate medical clarity.',
          systemRole: 'Harley Street Consultant Urological Surgeon',
          promptTemplate: `Write the complete, highly detailed clinical draft in Markdown following the blueprint:
{{previous_step_output}}

Original User Topic: {{user_input}}
Clinical Tone: {{project_tone}}
Audience: {{project_audience}}

Writing Guidelines:
- Write in the calm, compassionate, authoritative voice of a senior UK Consultant Urological Surgeon.
- Explain pathophysiology clearly without dumbing down the science.
- Include complete Markdown tables for clinical explanations (e.g. Possible explanation | What may suggest it | Usual next step).
- Include dedicated callout blocks using Markdown blockquotes:
  > **Research Insight**: [Summarize relevant clinical reviews or published papers]
  > **Evidence Note**: [Microbiological isolates, resistance patterns, or clinical trial findings]
  > **UK Guidance Note**: [NICE guideline NG110 or MHRA drug safety alert]
- Detail practical advice: why leftover antibiotics distort cultures, why routine urine dipsticks can miss chronic bacteria, when pelvic-floor relaxation is needed over Kegel strengthening.
CRITICAL RULE: STRICTLY NO IMAGES, NO IMAGE TAGS, NO IMAGE PLACEHOLDERS.`,
          temperature: 0.65,
          isEnabled: true,
        },
        {
          id: 'step-4-callouts-faqs',
          title: 'Stage 4: Red Flags, Myth vs Fact & Clinical FAQ Suite',
          description:
            'Enriches the article with safety warnings, Myth vs Fact comparison table, and 10 detailed clinical FAQs.',
          systemRole: 'Clinical Safety & Medical Review Specialist',
          promptTemplate: `Review and enhance the clinical draft below:
{{previous_step_output}}

Ensure the following vital clinical assets are completely formulated and integrated:
1. **Urgent Medical Red Flags**:
   - Acute urinary retention (inability to pass urine)
   - High fever, rigors, or confusion (sepsis warning)
   - 48-hour antibiotic non-response threshold for acute prostatitis (NICE hospital referral criteria)
   - NHS 111, urgent GP, or A&E / 999 instructions.
2. **Myth vs Fact Comparison Table**:
   | Myth | Fact |
   Include at least 6 common misconceptions (e.g. 'Every flare means infection', 'More antibiotics are always the answer', 'Negative cultures mean the pain is in your head', 'Stress causes bacterial infection').
3. **Key Takeaways Box**: 6-8 clear, scannable clinical bullet points.
4. **Frequently Asked Questions (Clinical FAQ)**: 8-10 numbered clinical questions with direct, authoritative answers.
Maintain the complete, unbroken draft below with all clinical callouts intact.
CRITICAL RULE: STRICTLY NO IMAGES, NO IMAGE TAGS, NO IMAGE PLACEHOLDERS.`,
          temperature: 0.5,
          isEnabled: true,
        },
        {
          id: 'step-5-clinical-delivery',
          title: 'Stage 5: Final Medical Publication Delivery (Prostate Clinic London)',
          description:
            'Delivers the publication-ready clinical article with consultant review attribution, references, and disclaimer.',
          systemRole: 'Medical Editor-in-Chief & Clinical Publishing Director',
          promptTemplate: `You are the Medical Publishing Director delivering the final, publication-ready clinical article in exact Prostate Clinic London format based on:
{{previous_step_output}}

Requirements for Final Output:
1. **Clinical Header Metadata**:
   - # [Primary Patient-Centered Headline]
   - **Published**: Current Date | **Reading Time**: ~8 mins | **Clinical Review**: Reviewed by Consultant Urological Surgeon, Prostate Clinic London
   - **Category Tags**: Urology, Men's Health, Diagnostic Pathways
2. **Empathetic Opening & Pathophysiological Breakdown**
3. **Structured Explanation Table**: | Possible explanation | What may suggest it | Usual next step |
4. **Specialist Callout Boxes**:
   - > **Research Insight**: ...
   - > **Evidence Note**: ...
   - > **UK Guidance Note**: ...
5. **Clear Diagnostic Testing Guidance** (cultures, flow rates, ultrasound residual)
6. **Treatment Protocols** (culture-guided antibiotics, MHRA fluoroquinolone warning, CP/CPPS multidisciplinary care)
7. **Red Flag Warning & When to See a Specialist**
8. **Myth vs Fact Table**: | Myth | Fact |
9. **Key Takeaways** (bullet points)
10. **Frequently Asked Questions** (1-10 numbered clinical questions and comprehensive answers)
11. **Final Thoughts & Specialist Consultation Callout**: Contact Prostate Clinic London (10 Harley Street, London W1G 9PF / 020 3928 7447)
12. **Academic & Guideline References**: Numbered list citing NICE NG110, PubMed publications, AUA guidelines, and MHRA updates.
13. **Formal Medical Disclaimer**: Professional statement clarifying that information is educational and does not substitute for clinical consultation.

Output ONLY the complete, publication-ready article in Markdown.
CRITICAL RULE: NO IMAGES, NO IMAGE TAGS, NO IMAGE PLACEHOLDERS.`,
          temperature: 0.55,
          isEnabled: true,
          isFinalBlogStep: true,
        },
      ],
    },
    {
      id: 'proj-seo-guide',
      name: 'SEO Long-Form Guide & Pillar Post',
      description:
        'A 5-stage pipeline designed for search ranking, in-depth research, clear section structuring, and polished blog prose.',
      targetAudience: 'Industry professionals, curious learners, and decision makers',
      tone: 'Authoritative, clear, actionable, and engaging',
      targetWordCount: 1500,
      tags: ['SEO', 'Long-Form', 'Organic Search'],
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 'step-1-angles',
          title: 'Angle & Search Intent Analysis',
          description:
            'Dissects the user topic to identify high-interest hooks, target audience pain points, and distinct angles.',
          systemRole: 'Senior Content Strategist & Search Analyst',
          promptTemplate: `You are an expert SEO strategist. The user wants to write a blog about:
Topic / Input: {{user_input}}
Target Audience: {{project_audience}}
Desired Tone: {{project_tone}}

Please analyze:
1. Primary Search Intent (What is the reader trying to solve?)
2. Three Compelling Angles/Hooks for the article.
3. Recommended Working Title & Selected Angle with rationale.
4. 4-6 High-intent Keywords and Semantic Terms to naturally integrate.`,
          temperature: 0.7,
          isEnabled: true,
        },
        {
          id: 'step-2-outline',
          title: 'Comprehensive Outline & Architecture',
          description: 'Constructs a structured H2/H3 blueprint based on the selected angle.',
          systemRole: 'Master Content Architect',
          promptTemplate: `Based on the angle analysis:
{{previous_step_output}}

Now build an exhaustive, well-structured outline for a ~{{project_word_count}} word blog post.
Requirements:
- Strong Introduction Hook structure
- 4 to 6 main H2 sections with 2-3 H3 subsections each
- Actionable takeaways and real-world examples for each section
- FAQs section addressing common reader questions
- Memorable Conclusion & Call to Action
Provide this as a detailed, structured outline with bullet points for each section.`,
          temperature: 0.6,
          isEnabled: true,
        },
        {
          id: 'step-3-draft',
          title: 'Deep Section-by-Section Draft',
          description: 'Writes the comprehensive draft following the outline with depth and examples.',
          systemRole: 'Lead Technical Journalist & Copywriter',
          promptTemplate: `You are writing the full body draft for this article based on the outline:
{{previous_step_output}}

Original User Topic: {{user_input}}
Tone: {{project_tone}}
Audience: {{project_audience}}

Write the complete, highly detailed blog post draft in Markdown format.
Guidelines:
- Write engaging prose with strong transitions between sections.
- Avoid generic fluff. Use concrete examples, data-driven reasoning, or analogies.
- Include informative subheadings (H2, H3).
- Use bullet points, bold key terms, and blockquotes where appropriate.`,
          temperature: 0.75,
          isEnabled: true,
        },
        {
          id: 'step-4-seo-polish',
          title: 'SEO Enhancement & Meta Data',
          description:
            'Optimises headings, writes the meta description and adds Key Takeaways at the end.',
          systemRole: 'SEO Optimization Editor',
          promptTemplate: `Review and enhance the blog draft below:
{{previous_step_output}}

Add the following SEO assets at the very top:
1. **Title Options**: 3 engaging, reader-focused titles (under 60 characters).
2. **Meta Description**: 155-character summary for Google search.
Then keep the full enhanced draft intact below the metadata, and:
3. Rewrite any impersonal opening so it speaks directly to the reader's concern using "you".
4. Make subheadings engaging and easy to follow, ideally the question the reader is asking.
5. Add a **Key Takeaways** box near the END of the article (before the FAQs), never at the start.`,
          temperature: 0.5,
          isEnabled: true,
        },
        {
          id: 'step-5-final-blog',
          title: 'Final Editorial Delivery & Formatting',
          description:
            'Delivers the pristine, ready-to-publish Markdown blog post with flawless typography.',
          systemRole: 'Editor-in-Chief',
          promptTemplate: `You are the Editor-in-Chief. You are delivering the final, publication-ready blog post based on:
{{previous_step_output}}

Tone: {{project_tone}}
Audience: {{project_audience}}

Requirements:
- Polish all sentences for rhythm, clarity, and impact.
- Ensure perfect Markdown formatting (H1 title, H2/H3 subheadings, quotes, lists, bold highlights).
- Include the Key Takeaways banner and FAQ section at the end.
- Output ONLY the finished, polished blog post ready for immediate publishing!`,
          temperature: 0.6,
          isEnabled: true,
          isFinalBlogStep: true,
        },
      ],
    },
    {
      id: 'proj-thought-leadership',
      name: 'Thought Leadership & Opinion Essay',
      description:
        'A 4-step pipeline crafted for counter-intuitive insights, bold perspectives, and engaging essay prose.',
      targetAudience: 'Founders, executives, and innovators',
      tone: 'Provocative, insightful, eloquent, and authentic',
      targetWordCount: 1200,
      tags: ['Thought Leadership', 'Essay', 'LinkedIn/Medium'],
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 'tl-step-1',
          title: 'Thesis & Counter-Intuitive Angle',
          description: 'Finds the non-obvious truth that challenges conventional wisdom on the topic.',
          systemRole: 'Provocative Essayist & Cultural Critic',
          promptTemplate: `Topic / Idea: {{user_input}}
Target Audience: {{project_audience}}
Tone: {{project_tone}}

Identify:
1. What is the consensus/conventional view on this topic?
2. What is the contrarian or deeper truth that people overlook?
3. Craft a strong, non-apologetic thesis statement for the essay.`,
          temperature: 0.85,
          isEnabled: true,
        },
        {
          id: 'tl-step-2',
          title: 'Narrative Arc & Anecdotes',
          description: 'Structures the essay with storytelling beats and real-world parallels.',
          systemRole: 'Narrative Architect',
          promptTemplate: `Using the thesis:
{{previous_step_output}}

Develop a 4-part narrative arc:
1. The Tension / The Hook: An opening scene or dilemma.
2. The False Promise: Why the easy answers fail.
3. The Turning Point: The insight that changes everything.
4. The Future Horizon: What this means for the reader moving forward.`,
          temperature: 0.7,
          isEnabled: true,
        },
        {
          id: 'tl-step-3',
          title: 'Essay Draft Generation',
          description: 'Drafts the full piece with vivid metaphors and memorable aphorisms.',
          systemRole: 'Literary Non-Fiction Writer',
          promptTemplate: `Write the full essay following the narrative arc:
{{previous_step_output}}

Tone: {{project_tone}}
Length: Around {{project_word_count}} words.
Make every paragraph count. Avoid corporate jargon. Focus on sharp observations and resonant phrasing.`,
          temperature: 0.8,
          isEnabled: true,
        },
        {
          id: 'tl-step-4',
          title: 'Final Polished Essay Delivery',
          description: 'Delivers the complete publish-ready essay in formatted Markdown.',
          systemRole: 'Senior Magazine Editor',
          promptTemplate: `Finalize this essay for publication:
{{previous_step_output}}

Provide a captivating title, a 1-sentence subtitle, and the complete polished text formatted in Markdown.`,
          temperature: 0.5,
          isEnabled: true,
          isFinalBlogStep: true,
        },
      ],
    },
    {
      id: 'proj-technical-breakdown',
      name: 'Technical Tutorial & Architecture Breakdown',
      description:
        'A 4-step pipeline designed for software engineering tutorials, code snippets, and deep technical clarity.',
      targetAudience: 'Software engineers, architects, and technical leads',
      tone: 'Precise, developer-friendly, pragmatic, and well-explained',
      targetWordCount: 1400,
      tags: ['Tech', 'Engineering', 'Tutorial'],
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 'tech-step-1',
          title: 'Problem Framing & Architecture Overview',
          description: 'Frames the technical challenge, prerequisites, and conceptual architecture.',
          systemRole: 'Principal Staff Engineer',
          promptTemplate: `Technical Topic: {{user_input}}
Audience: {{project_audience}}

Outline:
1. What exact problem does this solve in production?
2. Architectural trade-offs and when to use this approach vs alternatives.
3. Prerequisites and stack components.`,
          temperature: 0.5,
          isEnabled: true,
        },
        {
          id: 'tech-step-2',
          title: 'Step-by-Step Implementation Outline',
          description: 'Plans the code walk-through stages, folder structure, and key snippets.',
          systemRole: 'Senior Developer Advocate',
          promptTemplate: `Based on the architecture:
{{previous_step_output}}

Design the step-by-step technical tutorial roadmap with:
- Step 1: Environment Setup & dependencies
- Step 2: Core implementation logic
- Step 3: Handling edge cases, performance, or errors
- Step 4: Verification / Testing and production considerations`,
          temperature: 0.5,
          isEnabled: true,
        },
        {
          id: 'tech-step-3',
          title: 'Complete Code & Explanation Draft',
          description: 'Generates the in-depth tutorial with realistic code blocks and explanations.',
          systemRole: 'Technical Writer & Systems Engineer',
          promptTemplate: `Write the full technical tutorial following the roadmap:
{{previous_step_output}}

Include clean, well-commented code blocks (in Markdown with language tags), diagrams in ASCII or bullet lists, and deep explanations of key choices.`,
          temperature: 0.6,
          isEnabled: true,
        },
        {
          id: 'tech-step-4',
          title: 'Final Technical Blog Delivery',
          description: 'Delivers the complete tutorial with summary, gotchas, and further reading.',
          systemRole: 'Technical Publications Editor',
          promptTemplate: `Review and deliver the final Markdown technical blog post based on:
{{previous_step_output}}

Add a "Quick Summary" callout, verify all code formatting, add a "Common Gotchas & Pitfalls" section, and ensure clean Markdown delivery.`,
          temperature: 0.4,
          isEnabled: true,
          isFinalBlogStep: true,
        },
      ],
    },
  ];
}

/**
 * Calculates estimated API cost in USD based on Gemini Flash pricing:
 * $0.075 / 1M prompt tokens, $0.30 / 1M completion tokens
 */
export function calculateGeminiCost(promptTokens: number, candidatesTokens: number): number {
  const promptCost = (promptTokens / 1_000_000) * 0.075;
  const candidatesCost = (candidatesTokens / 1_000_000) * 0.30;
  return Number((promptCost + candidatesCost).toFixed(6));
}

export interface DailyTokenLog {
  date: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  runsCount: number;
}

const DAILY_TOKEN_STORAGE_KEY = 'blogcraft_daily_token_usage_v1';

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDailyTokenUsage(): DailyTokenLog {
  const today = getTodayDateString();
  try {
    const raw = localStorage.getItem(DAILY_TOKEN_STORAGE_KEY);
    if (raw) {
      const parsed: DailyTokenLog = JSON.parse(raw);
      if (parsed.date === today) {
        return parsed;
      }
    }
  } catch {
    // ignore parse error
  }
  return {
    date: today,
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    runsCount: 0,
  };
}

export function recordTokenUsage(tokens: { promptTokens: number; candidatesTokens: number; totalTokens: number }): DailyTokenLog {
  const current = getDailyTokenUsage();
  const promptTokens = current.promptTokens + (tokens.promptTokens || 0);
  const candidatesTokens = current.candidatesTokens + (tokens.candidatesTokens || 0);
  const totalTokens = current.totalTokens + (tokens.totalTokens || (tokens.promptTokens + tokens.candidatesTokens));
  const totalCostUsd = calculateGeminiCost(promptTokens, candidatesTokens);
  const runsCount = current.runsCount + 1;

  const updated: DailyTokenLog = {
    date: getTodayDateString(),
    promptTokens,
    candidatesTokens,
    totalTokens,
    totalCostUsd,
    runsCount,
  };

  try {
    localStorage.setItem(DAILY_TOKEN_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore quota error
  }

  return updated;
}

export const USAGE_HISTORY_STORAGE_KEY = 'blogcraft_usage_history_v2';

export function recordProjectRunUsage(record: Omit<ProjectUsageRecord, 'id'>): ProjectUsageRecord {
  const newRecord: ProjectUsageRecord = {
    ...record,
    id: `usage-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  };

  try {
    const raw = localStorage.getItem(USAGE_HISTORY_STORAGE_KEY);
    const list: ProjectUsageRecord[] = raw ? JSON.parse(raw) : [];
    // Avoid exact duplicate timestamp entries
    const filtered = list.filter((item) => item.timestamp !== record.timestamp);
    const updated = [newRecord, ...filtered].slice(0, 500); // keep up to 500 records
    localStorage.setItem(USAGE_HISTORY_STORAGE_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('blogcraft-usage-record', { detail: newRecord }));
    }
  } catch (err) {
    console.error('Failed to save project usage record:', err);
  }

  return newRecord;
}

/**
 * Retrieves all usage records from localStorage, merging active sessions
 * and seeding historical baseline days if sparse so the line chart has rich multi-project visual data.
 */
export function getProjectUsageHistory(
  projects: Project[],
  sessions: Record<string, RunSession>
): ProjectUsageRecord[] {
  let records: ProjectUsageRecord[] = [];
  try {
    const raw = localStorage.getItem(USAGE_HISTORY_STORAGE_KEY);
    if (raw) {
      records = JSON.parse(raw);
    }
  } catch {
    records = [];
  }

  // Extract from current sessions in memory/storage
  const today = getTodayDateString();
  const sessionRecords: ProjectUsageRecord[] = [];

  Object.entries(sessions).forEach(([projId, session]) => {
    if (!session || !session.stepOutputs) return;
    const completedSteps = Object.values(session.stepOutputs).filter((s) => s.status === 'completed');
    if (completedSteps.length === 0) return;

    let pTokens = 0;
    let cTokens = 0;
    completedSteps.forEach((s) => {
      if (s.tokenUsage) {
        pTokens += s.tokenUsage.promptTokens;
        cTokens += s.tokenUsage.candidatesTokens;
      } else if (s.output) {
        pTokens += Math.round((s.promptSent?.length || 600) / 4);
        cTokens += Math.round(s.output.length / 4);
      }
    });

    const total = pTokens + cTokens;
    if (total > 0) {
      const proj = projects.find((p) => p.id === projId);
      const sessionDate = (session.updatedAt || session.createdAt || today).slice(0, 10);
      sessionRecords.push({
        id: `sess-usage-${projId}-${session.id}`,
        projectId: projId,
        projectName: proj?.name || 'Medical Clinic Guide',
        date: sessionDate,
        timestamp: session.updatedAt || new Date().toISOString(),
        promptTokens: pTokens,
        candidatesTokens: cTokens,
        totalTokens: total,
        estimatedCostUsd: calculateGeminiCost(pTokens, cTokens),
        sessionTopic: session.userInput || 'Prostatitis Clinical Guide',
        stepsCompleted: completedSteps.length,
      });
    }
  });

  // Combine and deduplicate
  const combinedMap = new Map<string, ProjectUsageRecord>();
  records.forEach((r) => combinedMap.set(r.id, r));
  sessionRecords.forEach((r) => combinedMap.set(r.id, r));

  let finalRecords = Array.from(combinedMap.values());

  // If fewer than 10 records exist, seed historical trends over the last 14 days
  // so the user can immediately explore line charts across projects
  if (finalRecords.length < 10 && projects.length > 0) {
    const seedRecords: ProjectUsageRecord[] = [];
    const baseDate = new Date();

    const sampleTopicsMap: Record<string, string[]> = {
      'proj-prostate-clinic-london': [
        'Why Does Prostatitis Keep Coming Back?',
        'Prostatitis in Younger Men: Clinical Overview',
        'Bacterial vs Non-Bacterial Prostatitis Differentiation',
        'Antibiotics for Prostatitis & NICE Guidelines',
        'Pelvic Floor Relaxation in CP/CPPS',
      ],
      'proj-seo-guide': [
        'Complete B2B SaaS Customer Acquisition Roadmap',
        'Modern Content Marketing Framework for 2026',
        'The Ultimate Guide to Technical SEO Audits',
      ],
      'proj-thought-leadership': [
        'Why Speed Wins: Autonomous Coding Agent Realities',
        'The Myth of Full-Stack Generative AI',
        'Rethinking Software Engineering in the Agent Era',
      ],
      'proj-technical-breakdown': [
        'Architecting Distributed Event-Driven Microservices',
        'Building WebAssembly Modules with Rust for Cloudflare Workers',
        'Database Sharding & Raft Consensus from Scratch',
      ],
    };

    // Generate dates for the past 14 days
    for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - dayOffset);
      const dateStr = d.toISOString().slice(0, 10);

      projects.forEach((proj, pIdx) => {
        // Pseudo-deterministic variance based on project index and day
        const seedValue = (dayOffset * 7 + pIdx * 13) % 10;
        const runsToday = dayOffset === 0 ? 1 : seedValue > 2 ? (seedValue % 2) + 1 : 0;

        if (runsToday > 0) {
          const isMedical = proj.id === 'proj-prostate-clinic-london';
          const multiplier = isMedical ? 1.4 : pIdx === 1 ? 1.0 : 0.8;
          const promptBase = Math.round((7000 + (seedValue * 550)) * multiplier);
          const candBase = Math.round((5000 + (seedValue * 420)) * multiplier);
          const total = promptBase + candBase;
          const topics = sampleTopicsMap[proj.id] || ['Interactive Deep Dive Article'];
          const topic = topics[dayOffset % topics.length];

          seedRecords.push({
            id: `seed-${proj.id}-${dateStr}`,
            projectId: proj.id,
            projectName: proj.name,
            date: dateStr,
            timestamp: new Date(d.getTime() + 1000 * 60 * 60 * 14).toISOString(),
            promptTokens: promptBase,
            candidatesTokens: candBase,
            totalTokens: total,
            estimatedCostUsd: calculateGeminiCost(promptBase, candBase),
            sessionTopic: topic,
            stepsCompleted: isMedical ? 5 : 4,
          });
        }
      });
    }

    // Merge seeds with live records (live records take priority)
    seedRecords.forEach((s) => {
      if (!combinedMap.has(s.id)) {
        combinedMap.set(s.id, s);
      }
    });

    finalRecords = Array.from(combinedMap.values());
    try {
      localStorage.setItem(USAGE_HISTORY_STORAGE_KEY, JSON.stringify(finalRecords));
    } catch {
      // ignore
    }
  }

  // Sort descending by timestamp
  return finalRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}


