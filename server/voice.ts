// The sample's "you" voice: how often it speaks to the reader directly ("you may notice", "your
// surgeon"), measured when the sample is read and then matched in new articles.

const YOU = /\b(you|your|yours|yourself|you're|you've|you'll|you'd|you’re|you’ve|you’ll|you’d)\b/gi;
const hasYou = (t: string) => new RegExp(YOU.source, 'i').test(t);
const wordCount = (t: string) => (t.match(/[A-Za-z’'][A-Za-z’'-]*/g) || []).length;

export interface Voice {
  /** "you/your" per 100 words of body paragraphs. */
  per100: number;
  /** Share of body paragraphs (over 25 words) that speak to the reader, 0..1. */
  share: number;
}

/** Measures the voice of a set of body paragraphs. */
export function measureVoice(paragraphs: string[]): Voice | null {
  const paras = paragraphs.map((p) => p.trim()).filter((p) => wordCount(p) > 25);
  if (paras.length < 5) return null;
  const words = paras.reduce((n, p) => n + wordCount(p), 0);
  const you = paras.reduce((n, p) => n + (p.match(YOU) || []).length, 0);
  return { per100: Math.round((1000 * you) / words) / 10, share: Math.round((100 * paras.filter(hasYou).length) / paras.length) / 100 };
}

export const voiceLine = (v: Voice) => `[Voice: second person, ~${v.per100} "you/your" per 100 words, in ${Math.round(v.share * 100)}% of paragraphs]`;

export function voiceFromOutline(outline: string | null | undefined): Voice | null {
  const m = outline?.match(/\[Voice: second person, ~([\d.]+) "you\/your" per 100 words, in (\d+)% of paragraphs\]/);
  return m ? { per100: Number(m[1]), share: Number(m[2]) / 100 } : null;
}

/** Instruction for the writer. */
export const voiceRule = (v: Voice) =>
  `Speak to the reader directly in the second person, like the client's sample: about ${v.per100} "you"/"your" per 100 words, in about ${Math.round(
    v.share * 100
  )}% of paragraphs (e.g. "you may notice", "your surgeon may suggest", "if you have had..."). Avoid textbook sentences about "patients" or "people" where "you" fits.`;

/**
 * Body paragraphs (before Myth vs Fact) that don't speak to the reader, when the article as a whole
 * falls short of the sample's voice. Study descriptions after Evidence Note / Research Insight labels,
 * tables, lists and the introduction-free headings are left out.
 */
export function voiceIssue(markdown: string, target: Voice | null): string | null {
  if (!target) return null;
  const body = markdown.replace(/\r\n/g, '\n').split(/\n(?=##\s+(Myth vs Fact|Key Takeaways|Frequently Asked Questions|Final Thoughts|References))/i)[0];
  const paras: { heading: string; text: string }[] = [];
  for (const sec of body.split(/\n(?=##\s)/)) {
    const heading = sec.match(/^##\s+(.*)/)?.[1]?.trim() || 'Introduction';
    let inStudyCallout = false;
    for (const block of sec.split(/\n\s*\n/).map((b) => b.trim())) {
      const label = block.match(/^\*\*([^*\n]+)\*\*:?$/)?.[1];
      if (label) {
        inStudyCallout = /evidence|research/i.test(label);
        continue;
      }
      if (!block || /^(#|\||[-*+]\s|\d+[.)]\s)/.test(block)) continue;
      if (!inStudyCallout) paras.push({ heading, text: block });
    }
  }
  const got = measureVoice(paras.map((p) => p.text));
  if (!got) return null;
  if (got.share >= target.share - 0.1 && got.per100 >= target.per100 * 0.8) return null;
  const without = paras.filter((p) => wordCount(p.text) > 25 && !hasYou(p.text));
  const sections = [...new Set(without.map((p) => p.heading))];
  return `Speak to the reader as the sample does: it uses about ${target.per100} "you/your" per 100 words in ${Math.round(
    target.share * 100
  )}% of paragraphs; this article has ${got.per100} in ${Math.round(got.share * 100)}%. Rewrite the ${without.length} paragraph${
    without.length === 1 ? '' : 's'
  } that never address the reader so they speak to "you" naturally (e.g. "you may notice", "your surgeon may suggest"), keeping their facts. They are in: ${sections
    .slice(0, 10)
    .map((h) => `"${h}"`)
    .join('; ')}${sections.length > 10 ? ` and ${sections.length - 10} more` : ''}.`;
}
