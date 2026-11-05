import { GuidelineProfile } from '../types/pipeline';

// Defaults for a new profile, condensed from the agency's UK medical blog guidelines,
// reference-checking instructions, proofreading rules, QA checklist and client feedback.
// Every field is editable per client in the Guidelines screen.

export const DEFAULT_WRITING_RULES = `ORIGINALITY
- 100% original. Never copy or closely paraphrase any online source, including the reference articles.
- Must not read as templated, repetitive or AI-generated. Do not repeat the same point in several sections.

VOICE AND TONE (client feedback: this is the most important rule)
- Write as if talking to one reader. Use "you" and "your" throughout, and "we" for the clinic where natural.
- Be genuinely personal and conversational, not just pronoun-swapped textbook text. Acknowledge how the reader may feel, use everyday comparisons, and make the article enjoyable to read.
- Professional, empathetic, reassuring and trustworthy. No fear-based, sensational, exaggerated or promotional wording.
- Explain every medical term simply the first time it appears. Do not diagnose the reader.

OPENING
- Open with the reader's real concern or question, warmly. Example of the expected style:
  "If you're due to have a colposcopy, it's completely understandable to wonder whether it will hurt. A colposcopy is generally well tolerated, and most women experience little more than mild discomfort."
- Never open with a dry definition, a generic statement or a bullet-point summary.

STRUCTURE
- One H1, then H2 and H3. Do not number headings.
- Subheadings must be engaging, easy to follow and reader-focused, ideally the question the reader is asking (e.g. "Will a colposcopy hurt?"), never impersonal labels.
- Short paragraphs: about 2 to 3 moderate sentences.
- Key Takeaways, if used, go near the END, NEVER at the start. End the article in this exact order: Myth vs Fact, Key Takeaways, FAQs, Final Thoughts, References.
- Include at least one table or data element that adds real depth (comparison, recovery timeline, risk factors, history timeline for history topics). Place tables in the middle of the article next to the section they support, never near the end, and never two tables back to back. Tables must not make stronger claims than the body text.
- Include useful elevated features where they add value: Evidence Note, Research Insight, Clinical Tip, UK Guidance Note, Myth vs Fact. Never add them as decoration.
- Include FAQs that answer genuine patient questions without repeating the article.
- End with Final Thoughts: summarise the main message, reassure, no new topics, include the CTA naturally.

LANGUAGE
- UK English only, British spelling and grammar (tumour, prioritised, signalling, programmes, anaesthetist, da Vinci).
- Use pre-operative, peri-operative, post-operative consistently.
- Avoid repetitive stock phrases such as "If this applies to you", "Your healthcare team", "It is important for you", "can help support", "natural-looking results", "safe and effective".

MEDICAL CLAIM SAFETY
- Balanced, evidence-based, realistic wording: "may improve", "may reduce", "in suitable patients", "may be associated with".
- Never use: cure, guaranteed, permanent, instant, risk-free, harmless, no side effects, best, leading.
- Be especially careful with success rates, recovery time, hospital stay, catheter duration, pain, continence, erectile function, cosmetic results and long-term outcomes.
- Explain when routine advice is fine, when urgent assessment is needed and when to seek emergency help. Tell readers not to change medication themselves.
- For new or emerging treatments, clearly separate established care, specialist-only options, research-stage treatments, UK regulatory status and actual UK availability. US approval or trial success does not mean UK availability.
- Do not assume clinic-specific or surgeon-specific techniques unless they are confirmed in the brief.

EVIDENCE IN THE BODY
- Explain at least one strong study or recognised guideline in the body in patient-friendly language, including what it means for the reader, without overstating it.
- Statistics must come from credible sources and be presented as population-level findings, never as guaranteed individual outcomes.
- If the body names an organisation or guideline ("NICE recommends..."), that source must be in the reference list. Otherwise rephrase.`;

// Layout of the client's approved sample article. The .docx export renders these Markdown conventions.
export const DEFAULT_DOCUMENT_FORMAT = `DOCUMENT FORMAT (match the client's approved sample article exactly)
- Start with one "# " title in Title Case, ideally the reader's question. Then 2 short introduction paragraphs with no heading.
- No meta description, byline, reading time, horizontal rules, emojis or disclaimer unless the brief asks for them.
- Main sections use "## " headings in Title Case, phrased as the reader's question, e.g. "## Why Do You Still Need ADT If Abiraterone Lowers Androgens?". Usually 2 paragraphs per section. Do not number headings.
- Special blocks: put the label alone in bold on its own line, exactly one of **Clinical Note**, **UK Guidance Note**, **Evidence Note** or **Research Insight**, followed by 1 to 2 normal paragraphs. Place each block inside the section it supports. Never use blockquotes (>) for them.
- Tables: plain Markdown tables, usually 2 to 3 columns, under a "## " heading or a lead-in sentence.
- Bullet lists use a bold lead-in: "- **Low potassium:** explanation."
- Close with these sections, in this order, with these exact headings:
  ## Myth vs Fact
  A table with columns | Myth | Fact | and 6 to 8 rows.
  ## Key Takeaways
  5 to 8 short bullets.
  ## Frequently Asked Questions
  No introduction text. Exactly 10 items, each a bold numbered question on its own line with the answer on the very next line:
  **1. What is ...?**
  Answer in 2 to 4 sentences.
  ## Final Thoughts: <the reader's question, in Title Case>
  2 paragraphs; the second contains the call to action with the internal link inside a natural sentence.
  ## References:
  A numbered list: 1. Author, A. et al. (Year) 'Article title', Journal. Available at: https://direct-link`;

export const DEFAULT_REFERENCE_RULES = `- Every reference must exist, be accessible and directly support the claim it is attached to. Never invent references or guess missing details.
- Five real, relevant references are enough. Do not pad the list.
- Prioritise UK sources: NICE, NHS, GOV.UK, UKHSA, MHRA, GMC, CQC, RCOG, BAUS, Royal Colleges, UK specialist societies, Cancer Research UK, Prostate Cancer UK, BMJ.
- Peer-reviewed evidence may come from PubMed, PMC, MDPI, ScienceDirect and academic.oup.com, but each article is judged on its own quality, date and relevance, never on the platform.
- Prefer current guidelines, systematic reviews, meta-analyses, major trials and strong cohort studies. Avoid case reports, commercial clinic pages, blogs, news, Wikipedia, forums, preprints and manufacturer pages for important clinical claims.
- Do not use an overseas guideline where UK guidance exists, an old study where newer evidence exists, a patient leaflet for a complex specialist claim, an observational study to imply causation, or lab/animal research for firm patient-outcome claims.
- No duplicate references. Prefer fresh topic-specific sources.
- NICE: "National Institute for Health and Care Excellence (year) Full title. NICE guideline NGxx." Technology appraisals: "Technology appraisal guidance TAxxxx". Only give numbers that are verified.
- NHS: "NHS (review year) Exact page title." Use the last-reviewed date when shown.
- Use "no date" only when the source shows no date. Never "n.d.".
- URLs: direct page (not a homepage or search results), complete, on one line, https://, no tracking parameters, no stray punctuation.`;

export const DEFAULT_QA_CHECKLIST = `Do a strict start-to-finish pass of the WHOLE blog before giving any score or verdict. Never give 100/100 just because earlier corrections were applied.

CONTENT AND ACCURACY
- Full content QA in the article's original order, so corrections are easy to apply.
- Medical and factual accuracy. Check numerical guidance carefully: doses, fluid amounts, timings, risk figures.
- Current UK guidance where relevant. Search current sources when guidance, references or dates may have changed.
- Statements that are misleading, unsupported, overstated or potentially unsafe. General information must not read as personalised medical advice.
- Contradictions between the article and its references, and inconsistency between the introduction, tables, body, Myth vs Fact, Key Takeaways, FAQs and Final Thoughts.

EVIDENCE AND REFERENCES
- Each reference exists, is accessible, is credible and current, is relevant, and truly supports the claim it is attached to. Never say a reference supports something unless its content was checked; say plainly what could not be verified.
- Claims that need an additional reference. Named organisations or guidelines in the body must be in the reference list.
- Client-specific reference limits and allowed domains.

VOICE AND READABILITY (client feedback: top priority)
- Reader-friendly "you/your" language that is genuinely personal and conversational, not just pronoun counting.
- An engaging opening that speaks to the reader's concern. No impersonal, generic or definition-first opening.
- Engaging, easy-to-follow subheadings. No impersonal or hard-to-understand headings.
- No generic textbook or AI tone, no "copy-paste from ChatGPT" feel. Originality and non-generic content; no duplication with other sites.
- Is the article genuinely enjoyable and easy to read for a UK patient? Flag awkward, unclear or overly technical wording.
- No unnecessary duplication or repetitive wording.
- UK English, British spelling, grammar and UK healthcare terminology.

STRUCTURE
- NO "Key Takeaways" at the beginning.
- Correct end sequence: Myth vs Fact -> Key Takeaways -> FAQs -> Final Thoughts -> References.
- Useful depth such as tables, timelines (e.g. for history topics), data, practical comparisons or clinical insight where appropriate. Tables mid-article, not back to back.
- Appropriate use of fixed client sections (Evidence Note, Clinical Tip, Research Insight, UK Guidance Note): useful, never decorative.
- Internal-link and anchor-text requirements; CTA relevant to the topic and not over-promotional.
- Word-count limits.

OUTPUT
- Mark every correction as Essential (factual, safety, reference, client rule) or Optional (editorial).
- Give exact copy-paste replacement wording with the precise location of each change. Be explicit about every point; never just a general summary.`;

export const DEFAULT_REFERENCE_MIX = '2 MDPI, 2 PMC, 2 PubMed, 2 ScienceDirect';

export function createDefaultGuidelineProfile(name: string): Omit<GuidelineProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name,
    writingRules: `${DEFAULT_WRITING_RULES}\n\n${DEFAULT_DOCUMENT_FORMAT}`,
    referenceRules: DEFAULT_REFERENCE_RULES,
    qaChecklist: DEFAULT_QA_CHECKLIST,
    scoreScale: 100,
    referenceStyle: 'harvard_short',
    referenceCount: 5,
    referenceMix: DEFAULT_REFERENCE_MIX,
    allowedDomains: [],
    minWordCount: 2400,
    cta: '',
    internalLinks: '',
  };
}
