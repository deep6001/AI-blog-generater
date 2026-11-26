// Topic coverage: research lists the questions a patient needs answered ("Questions this article must
// answer"); the writer gives each one a section, and the final check flags any the article leaves out.

const STOP = new Set(
  `a an and are as at be been being but by can could did do does doing for from had has have how i if in into is it its
  may me might more most my no not of on or our out over should so some such than that the their them then there these
  they this those to too under up us very was we were what when where which while who why will with would you your yours
  after before during about also any each other only own same just both again further once here all few many much well
  get got getting make makes made need needs needed happen happens happened usually likely possible typically really
  mother mothers mum mums woman women patient patients people person someone way ways thing things step steps work works`.split(/\s+/)
);

// A five-letter prefix is a crude but forgiving stem: differ/difference, tear/tearing, recover/recovery.
const stem = (w: string) => w.replace(/(ies|s)$/, '').slice(0, 5);

export function keyWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z]+/g) ?? ([] as string[])).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
}

/** The questions the research says the article must answer (falls back to "What readers are really asking"). */
export function checklistFromBrief(brief?: string | null): string[] {
  if (!brief) return [];
  const section = (title: string) =>
    brief.match(new RegExp(`^##\\s+${title}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'))?.[1] || '';
  const body = section('Questions this article must answer') || section('What readers are really asking');
  const lines = body
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:[-*+]|\d+[.)]|Q\d+[.:)]?)\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/\s*\[\d+\](\[\d+\])*/g, '')
        .trim()
    )
    .filter((l) => l.length > 8 && /[a-z]/i.test(l));
  // Keep only the questions when the list is mostly questions (drops an intro line such as "These are...").
  const questions = lines.filter((l) => /\?$/.test(l));
  return (questions.length >= lines.length / 2 ? questions : lines).slice(0, 20);
}

/**
 * Checklist questions the article does not answer. A question counts as answered when one heading,
 * paragraph, list item or table row contains most of its distinctive words (words of the topic itself,
 * like "forceps" or "birth", are left out because every section contains them).
 */
export function uncoveredQuestions(markdown: string, checklist: string[], topic = ''): string[] {
  if (!checklist.length) return [];
  const title = markdown.match(/^#\s+(.*)$/m)?.[1] || '';
  const topicWords = new Set(keyWords(`${topic} ${title}`));
  const body = markdown.replace(/\r\n/g, '\n').split(/\n(?=#{1,3}\s+References:?\s*$)/im)[0];
  // A question can be answered across a whole section, so sections count as well as single paragraphs.
  const pieces = [...body.split(/\n(?=##\s)/), ...body.split(/\n\s*\n|\n(?=[-*+]\s|\|)/)];
  const units = pieces.map((u) => new Set(keyWords(u))).filter((u) => u.size > 0);
  return checklist.filter((q) => {
    const key = keyWords(q).filter((w) => !topicWords.has(w));
    if (!key.length) return false;
    const need = key.length <= 2 ? key.length : Math.ceil(key.length * 0.6);
    return !units.some((u) => key.filter((w) => u.has(w)).length >= need);
  });
}

export function coverageIssue(markdown: string, checklist: string[], topic = ''): string | null {
  const missing = uncoveredQuestions(markdown, checklist, topic);
  if (!missing.length) return null;
  return `The research lists questions readers need answered that this article does not cover: ${missing
    .map((q) => `"${q}"`)
    .join('; ')}. Answer each one, ideally with its own section in place of a weaker section or one that repeats another (keep the sample's layout), otherwise in the closest section.`;
}

/** The checklist as instructions for the writer. */
export function checklistRule(checklist: string[]): string {
  if (!checklist.length) return '';
  return `Questions this article must answer (from the research). Give each body section one of these, answer every one, and do not spend two sections on the same question:\n${checklist
    .map((q, i) => `  Q${i + 1}. ${q}`)
    .join('\n')}`;
}
