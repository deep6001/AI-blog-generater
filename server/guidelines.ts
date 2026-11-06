import { webSearch, type ModelInfo, type Usage } from './llm';
import { sampleContext } from './sampleDoc';
import type { GuidelineProfile, PublicationVerdict } from '../src/types/pipeline';

export type GuidelineInput = Pick<
  GuidelineProfile,
  | 'name'
  | 'writingRules'
  | 'referenceRules'
  | 'qaChecklist'
  | 'scoreScale'
  | 'referenceStyle'
  | 'referenceCount'
  | 'referenceMix'
  | 'allowedDomains'
  | 'minWordCount'
  | 'cta'
  | 'internalLinks'
  | 'sampleOutline'
  | 'sampleWordCount'
>;

export const VERDICTS: PublicationVerdict[] = [
  'Ready to Publish After Minor Changes',
  'Requires Substantial Revision',
  'Not Ready to Publish Yet',
  'Ready to Publish',
];

function referenceFormat(style: GuidelineInput['referenceStyle']): string {
  return style === 'harvard_full'
    ? `Full Harvard style, UK English, one consistent format. Journal articles: Author, A., Author, B. and Author, C. (Year) 'Full article title', *Journal Name*, volume(issue), pages or article number. doi: 10.xxxx. Italicise journal names. Include NHS review dates where shown.`
    : `Short Harvard style: Author, A. et al. (Year) 'Article title', Journal. Available at: direct source link. No DOI links, no accessed dates, no notes or descriptions under references.`;
}

function clientSpecifics(p: GuidelineInput): string {
  const lines = [
    `- Reference list: about ${p.referenceCount} real references, formatted as: ${referenceFormat(p.referenceStyle)}`,
    p.allowedDomains.length ? `- References may only come from these domains: ${p.allowedDomains.join(', ')}` : '',
    p.cta.trim() ? `- Call to action to include naturally in Final Thoughts:\n${p.cta.trim()}` : '',
    p.internalLinks.trim()
      ? `- Required internal links (use the exact anchor text inside a natural sentence, keep the URL exactly):\n${p.internalLinks.trim()}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Appended to every pipeline step so drafts follow the client's rules from the start. */
export function guidelinesContext(p: GuidelineInput, targetWordCount?: number): string {
  const words = Math.max(p.minWordCount || 0, targetWordCount || 0);
  return `

---
## Client guidelines: ${p.name}
These rules override any conflicting instruction above.
${words ? `- Full articles must be at least ${words} words.\n` : ''}${clientSpecifics(p)}

### Writing rules
${p.writingRules.trim()}

### Reference rules
${p.referenceRules.trim()}${p.sampleOutline ? sampleContext(p.sampleOutline, p.sampleWordCount) : ''}`;
}

export function qaPrompt(article: string, p: GuidelineInput, sourceUrls: string[]): string {
  const scale = p.scoreScale;
  return `You are the senior QA editor and medical reference checker for a UK private medical practice blog (client profile: ${p.name}).
Review the article below. Use web search to verify references, guidance and any fact that may have changed. Be explicit about anything you could not verify. Never invent references, details or completed checks.

## Client checklist
${p.qaChecklist.trim()}

## Client writing rules (what the article should follow)
${p.writingRules.trim()}

## Client reference rules
${p.referenceRules.trim()}
${clientSpecifics(p)}${p.sampleOutline ? `${sampleContext(p.sampleOutline, p.sampleWordCount)}
Check that the article follows this approved layout; list any structural differences as Essential corrections.` : ''}
${sourceUrls.length ? `\nThe writer's research found these sources (already checked to exist):\n${sourceUrls.map((u) => `- ${u}`).join('\n')}` : ''}

## Output format (Markdown, UK English, follow exactly)
Start with these three lines exactly, nothing before them:
VERDICT: <one of: Ready to Publish | Ready to Publish After Minor Changes | Requires Substantial Revision | Not Ready to Publish Yet>
SCORE: <number>/${scale}
SCORE_AFTER: <expected score after the corrections below>/${scale}

Then these sections:

## Publication Verdict
The verdict and the main reasons, considering medical accuracy, patient safety, credibility, tone, readability, British spelling and grammar, evidence and reference quality, repetition, misleading statements, regulatory accuracy and publication risk.

## Check Table
| Check | Status | Notes |
Cover at least: UK English, personal "you" tone, opening, subheadings, Key Takeaways placement, tables and data depth, repetition and AI-sounding text, medical accuracy, claim safety, UK guidance, evidence in body, references, CTA, internal links, FAQs, Final Thoughts, word count.

## Reference Review
| # | Reference | Classification | Verified? | Supports which claim | Issue |
Classification is one of: Strong, Relevant, Partly relevant, Weak, Unrelated, Invalid, Fake placeholder.
Then list formatting fixes needed for ${p.referenceStyle === 'harvard_full' ? 'full' : 'short'} Harvard style, "no date" use, NICE/NHS entries and URLs.

## Unsupported or Overstated Claims
Quote each claim, explain why the reference does not adequately support it, and say whether a stronger source or softer wording is needed.

## Missing UK Guidance
Essential, directly relevant UK guidance that is missing, or "None."

## Exact Corrections
Work through the article in its original order.
| Location (section and paragraph) | Current Text | Corrected Text | Type |
Type is "Essential" (factual, safety, reference, client rule) or "Optional" (editorial). Include rewrites of any impersonal opening and impersonal subheadings in the client's warm "you" style. Quote current text exactly.

## Replacement Reference Options
Only if references are fake, invalid, missing or genuinely weak: give exactly 8 verified options following this mix: ${p.referenceMix || 'the strongest relevant UK and peer-reviewed sources'}. Format them in the client's reference style, with no notes underneath. Otherwise write "Not needed."

## Final Recommendation
The highest-priority changes before publication, in order.

---
ARTICLE TO REVIEW:
"""
${article}
"""`;
}

export interface QaResult {
  review: string;
  verdict?: PublicationVerdict;
  score?: number;
  scoreAfter?: number;
  scoreScale: number;
  createdAt: string;
  tokenUsage: Usage;
}

export function parseQaHeader(text: string, scale: number): Pick<QaResult, 'verdict' | 'score' | 'scoreAfter'> {
  const verdictLine = text.match(/^\s*VERDICT:\s*(.+)$/im)?.[1] ?? '';
  // Longest names first so "Ready to Publish" does not swallow "... After Minor Changes".
  const verdict = VERDICTS.find((v) => verdictLine.toLowerCase().includes(v.toLowerCase()));
  const num = (label: string) => {
    const m = text.match(new RegExp(`^\\s*${label}:\\s*([\\d.]+)\\s*/\\s*\\d+`, 'im'));
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= scale ? n : undefined;
  };
  return { verdict, score: num('SCORE'), scoreAfter: num('SCORE_AFTER') };
}

export async function runQaReview(
  info: ModelInfo,
  article: string,
  profile: GuidelineInput,
  sourceUrls: string[],
  timeoutMs: number
): Promise<QaResult> {
  const { text, usage } = await webSearch(info, qaPrompt(article, profile, sourceUrls), {
    signal: AbortSignal.timeout(timeoutMs),
    insertMarkers: false,
  });
  const review = text.trim();
  if (!review) throw new Error('The QA review came back empty. Please retry.');

  return {
    review,
    ...parseQaHeader(review, profile.scoreScale),
    scoreScale: profile.scoreScale,
    createdAt: new Date().toISOString(),
    tokenUsage: usage,
  };
}
