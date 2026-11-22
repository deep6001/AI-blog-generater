import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLayout, countWords, finalizeArticle, parseSections, specFromOutline, type LayoutSpec } from './layoutCheck';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const outline = `# Sample Title?
[2 paragraphs, ~45 words each]
## First Question?
[2 paragraphs, ~40 words each]
**Clinical Note** [bold label on its own line]
[2 paragraphs, ~38 words each]
## Second Question?
[2 paragraphs, ~40 words each]
## Myth vs Fact
[Table: 2 columns (Myth | Fact), 6 rows, bold header row]
## Key Takeaways
[Bulleted list, 5 items. e.g. "x"]
## Frequently Asked Questions
[2 FAQ items: bold numbered question, line break, answer of ~30 words]
## Final Thoughts: Is It Right for You?
[2 paragraphs, ~60 words each, contains an internal link]
## References:
[Numbered list, 2 items. e.g. "x"]`;

const base = { minWords: 100, maxWords: 400, minReferences: 2, noDoiLinks: true, internalLinkUrls: ['https://clinic.example/acne'] };

const good = (body = 30) => `# Title?

${words(20)}

${words(20)}

## First Question?

${words(body)}

${words(body)}

**Clinical Note**
${words(28)}

${words(28)}

## Second Question?

${words(body)}

${words(body)}

## Myth vs Fact

| Myth | Fact |
| --- | --- |
| a | b |
| c | d |
| e | f |
| g | h |
| i | j |
| k | l |

## Key Takeaways

- one
- three
- four
- five
- two

## Frequently Asked Questions

**1. Does it hurt?**
${words(10)}

**2. How long?**
${words(10)}

## Final Thoughts: Is It Right for You?

${words(20)}

Book a consultation about [acne treatment in London](https://clinic.example/acne) today.

## References:

1. NHS (2024) Acne. Available at: https://www.nhs.uk/conditions/acne/
2. NICE (2023) Acne vulgaris. Available at: https://www.nice.org.uk/guidance/ng198
`;

test('specFromOutline reads callouts, closing sections, FAQ count and the exact section patterns', () => {
  const spec = specFromOutline(outline, base);
  assert.deepEqual(spec.callouts, ['Clinical Note']);
  assert.deepEqual(spec.closing.map((c) => [c.heading, c.kinds.join(',')]), [
    ['Myth vs Fact', 'table'],
    ['Key Takeaways', 'bullets'],
    ['Frequently Asked Questions', 'faq'],
    ['Final Thoughts', 'para,para'],
    ['References', 'numbered'],
  ]);
  assert.equal(spec.faqCount, 2);
  assert.deepEqual(spec.patterns.intro, ['para', 'para']);
  assert.deepEqual(
    spec.patterns.body.map((p) => p.blocks.join(',')),
    ['para,para,callout,para,para', 'para,para']
  );
});

test('an article that follows the template passes with no issues', () => {
  const r = checkLayout(good(), specFromOutline(outline, base));
  assert.deepEqual(r.issues, []);
});

test('word count excludes the References section', () => {
  const md = `# T\n\n${words(50)}\n\n## References:\n\n1. ${words(40)}`;
  assert.equal(countWords(md), 51);
});

test('extra paragraphs, text after closing tables and lists, missing callouts and links are all flagged', () => {
  const bad = good()
    .replace('**Clinical Note**\n', '')
    .replace('## Second Question?\n\n', `## Second Question?\n\n${words(20)}\n\n${words(20)}\n\n`)
    .replace('| a | b |\n', '| a | b |\n\nA summary paragraph after the table.\n')
    .replace('- two\n', '- two\n\nAnother summary paragraph.\n')
    .replace('[acne treatment in London](https://clinic.example/acne)', 'acne treatment');
  const issues = checkLayout(bad, specFromOutline(outline, base)).issues.join('\n');
  assert.match(issues, /"Second Question\?" has 4 paragraphs; make it 2 paragraphs/);
  assert.match(issues, /\*\*Clinical Note\*\*/);
  assert.match(issues, /"Myth vs Fact" section must contain only a table[\s\S]*a table, then a paragraph/);
  assert.match(issues, /"Key Takeaways" section must contain only a bulleted list/);
  assert.match(issues, /internal link[\s\S]*clinic\.example\/acne/);
});

test('word range, FAQ count, reference count and doi links are flagged', () => {
  const md = good(200)
    .replace(/\*\*2\. How long\?\*\*\n.*\n/, '')
    .replace(/2\. NICE.*\n/, '1. X (2020) Y. Available at: https://doi.org/10.1000/xyz\n');
  const issues = checkLayout(md, specFromOutline(outline, base)).issues.join('\n');
  assert.match(issues, /Word count is \d+ .* must be between 100 and 400/);
  assert.match(issues, /exactly 2 FAQs/);
  assert.match(issues, /doi\.org/);
});

test('parseSections treats "### 1. Question?" FAQ headings as FAQ items', () => {
  const s = parseSections('## Frequently Asked Questions\n\n### 1. Is it safe?\n\nYes.\n\n### 2. Cost?\n\nVaries.\n');
  assert.deepEqual(s[1].blocks.map((b) => b.kind), ['faq', 'faq']);
});

test('finalizeArticle keeps the corrected version when it fixes the issues', async () => {
  const spec: LayoutSpec = specFromOutline(outline, base);
  const broken = good().replace('**Clinical Note**\n', '');
  const result = await finalizeArticle(broken, spec, async () => good());
  assert.equal(result.passes, 1);
  assert.deepEqual(result.issues, []);
  assert.ok(result.initialIssues.length > 0);
  assert.ok(result.article.includes('**Clinical Note**'));
});

test('finalizeArticle never returns a worse or truncated article', async () => {
  const spec: LayoutSpec = specFromOutline(outline, base);
  const broken = good().replace('**Clinical Note**\n', '');
  const result = await finalizeArticle(broken, spec, async () => 'Sorry, here is a summary.');
  assert.equal(result.article, broken);
  assert.equal(result.passes, 3);
});

test('dedupeReferences drops repeated sources and renumbers the list', async () => {
  const { dedupeReferences } = await import('./layoutCheck');
  const md = `## Final Thoughts: X?\n\nText.\n\n## References:\n\n1. Study (2022). Available at: https://a.example/study.pdf\n2. Guide (2024). Available at: https://b.example/g/\n3. Study (2022), limitations. Available at: https://www.a.example/study.pdf\n4. Page. Available at: https://c.example/p\n`;
  const out = dedupeReferences(md);
  assert.match(out, /1\. Study \(2022\)\. .*\n2\. Guide .*\n3\. Page\./);
  assert.ok(!out.includes('limitations'));
});

test('two callouts in one section, or a short callout, break the callout pattern', async () => {
  const { dedupeReferences } = await import('./layoutCheck');
  const spec = specFromOutline(outline, base);
  assert.equal(spec.referencesHeading, 'References:');
  const twoParaNote = `**Clinical Note**\n${words(28)}\n\n${words(28)}\n`;
  const crowded = good().replace(twoParaNote, `**Clinical Note**\n${words(28)}\n\n**Evidence Note**\n${words(28)}\n`);
  const issues = checkLayout(crowded, { ...spec, callouts: ['Clinical Note', 'Evidence Note'] }).issues.join('\n');
  assert.match(
    issues,
    /"First Question\?" has 2 paragraphs, then a bold callout label on its own line, then 1 paragraph, then a bold callout label/
  );
  assert.match(dedupeReferences(good().replace('## References:', '## References'), 'References:'), /^## References:$/m);
});

// A sample shaped like the real one: plain, callout, table-only and paragraph-list-paragraph sections.
const shapedOutline = outline.replace(
  '## Second Question?\n[2 paragraphs, ~40 words each]\n',
  '## Second Question?\n[2 paragraphs, ~40 words each]\n## How the Options Compare\n[Table: 2 columns (A | B), 3 rows, bold header row]\n## What Side Effects Can It Cause?\n[1 paragraph, ~30 words]\n[Bulleted list, 4 items, each starting with a bold lead-in. e.g. "x"]\n[1 paragraph, ~30 words]\n'
);
const table2 = '| A | B |\n| --- | --- |\n| x | y |\n';
const list4 = '- **Redness:** common.\n- **Stinging:** brief.\n- **Dryness:** mild.\n- **Peeling:** rare.\n';
const listSection = (intro: string, list = list4) => `## What Side Effects Can It Cause?\n\n${intro}${list}\n${words(30)}\n\n`;
const shaped = (tableSec = `## How the Options Compare\n\n${table2}\n`, listSec = listSection(`${words(30)}\n\n`)) =>
  good().replace('## Myth vs Fact', `${tableSec}${listSec}## Myth vs Fact`);

test('an article with every sample pattern in place passes', () => {
  const spec = specFromOutline(shapedOutline, base);
  assert.equal(spec.patterns.body.length, 4);
  assert.deepEqual(checkLayout(shaped(), spec).issues, []);
});

test('a callout straight after a heading, or extra paragraphs before a list, break the patterns', () => {
  const spec = specFromOutline(shapedOutline, base);
  const md = shaped(undefined, listSection(`${words(20)}\n\n${words(20)}\n\n`)).replace(
    `## First Question?\n\n${words(30)}\n\n${words(30)}\n\n**Clinical Note**`,
    '## First Question?\n\n**Clinical Note**'
  );
  const issues = checkLayout(md, spec).issues.join('\n');
  assert.match(
    issues,
    /"First Question\?" has a bold callout label on its own line, then 2 paragraphs; make it 2 paragraphs, then a bold callout label/
  );
  assert.match(
    issues,
    /"What Side Effects Can It Cause\?" has 2 paragraphs, then a bulleted list, then 1 paragraph; make it 1 paragraph, then a bulleted list/
  );
});

test('table columns, lead-ins and list length must match the sample', () => {
  const spec = specFromOutline(shapedOutline, base);
  const md = shaped(
    '## How the Options Compare\n\n| A | B | C |\n| --- | --- | --- |\n| x | y | z |\n\n',
    listSection(`${words(20)}\n\n`, '- Redness.\n- **Stinging:** brief.\n')
  );
  const issues = checkLayout(md, spec).issues.join('\n');
  assert.match(issues, /has 3 columns; the sample's has 2/);
  assert.match(issues, /must start with a bold lead-in/);
  assert.match(issues, /has 2 items; the sample's has 4/);
});

test('a missing list or table section is named, and an extra one is flagged', () => {
  const spec = specFromOutline(shapedOutline, base);
  const noList = shaped(undefined, '').replace('## Second Question?', '## What Side Effects Can It Cause?');
  assert.match(
    checkLayout(noList, spec).issues.join('\n'),
    /Convert the body section "What Side Effects Can It Cause\?" into exactly: 1 paragraph, then a bulleted list/
  );
  const twoTables = shaped(`## How the Options Compare\n\n${table2}\n## Another Comparison\n\n${table2}\n`);
  assert.match(checkLayout(twoTables, spec).issues.join('\n'), /exactly 1 body table section; this article has 2/);
});

test('sections whose paragraphs are much shorter than the sample are flagged as thin', async () => {
  const { typicalParaWords } = await import('./layoutCheck');
  assert.equal(typicalParaWords(outline), 40);
  const thin = good().replace(`## Second Question?\n\n${words(30)}\n\n${words(30)}`, `## Second Question?\n\n${words(12)}\n\n${words(12)}`);
  assert.match(
    checkLayout(thin, specFromOutline(outline, base)).issues.join('\n'),
    /too thin[\s\S]*"Second Question\?" \(~12 words per paragraph\)/
  );
});

// Shaped like "sample 2": a plain "Term: explanation" list followed by a callout, 1 paragraph after
// some callouts, a 3-column table, 10 Myth vs Fact rows and 10 Key Takeaways.
const sample2 = `# Sample Title?
[2 paragraphs, ~45 words each]
## First Question?
[2 paragraphs, ~40 words each]
**UK Guidance Note** [bold label on its own line]
[1 paragraph, ~40 words]
## At a Glance
[Table: 3 columns (A | B | C), 4 rows, bold header row]
## Can It Interact With Other Medicines?
[1 paragraph, ~40 words]
[Bulleted list, 4 items. e.g. "Warfarin or acenocoumarol: it can reduce their effect."]
[1 paragraph, ~40 words]
**Evidence Note** [bold label on its own line]
[1 paragraph, ~40 words]
## Second Question?
[2 paragraphs, ~40 words each]
## Myth vs Fact
[Table: 2 columns (Myth | Fact), 10 rows, bold header row]
## Key Takeaways
[Bulleted list, 10 items. e.g. "x"]
## Frequently Asked Questions
[2 FAQ items: bold numbered question, line break, answer of ~30 words]
## Final Thoughts: Is It Right for You?
[2 paragraphs, ~60 words each, contains an internal link]
## References:
[Numbered list, 2 items. e.g. "x"]`;

test('a sample with plain lead-ins, 1-paragraph callouts and closing counts is read exactly', async () => {
  const { patternsText } = await import('./samplePatterns');
  const spec = specFromOutline(sample2, base);
  const list = spec.patterns.body.find((p) => p.blocks.includes('list'))!;
  assert.deepEqual(list.blocks, ['para', 'list', 'para', 'callout', 'para']);
  assert.equal(list.leadIn, false);
  assert.equal(list.plainLeadIn, true);
  assert.match(patternsText(spec.patterns), /term in plain text, NOT bold/);
  assert.deepEqual(
    spec.closing.filter((c) => c.count).map((c) => [c.heading, c.count]),
    [['Myth vs Fact', 10], ['Key Takeaways', 10]]
  );
});

test('bold lead-ins, wrong table columns and short closing lists are flagged against a plain-list sample', () => {
  const spec = specFromOutline(sample2, base);
  const p = (n = 30) => words(n);
  const md = `# Title?\n\n${p()}\n\n${p()}\n\n## First Question?\n\n${p()}\n\n${p()}\n\n**UK Guidance Note**\n${p()}\n\n## At a Glance\n\n| A | B |\n| --- | --- |\n| x | y |\n\n## Can It Interact With Other Medicines?\n\n${p()}\n\n- **Warfarin:** reduced effect.\n- **Dabigatran:** reduced effect.\n- **Statins:** lower levels.\n- **Omeprazole:** lower levels.\n\n${p()}\n\n**Evidence Note**\nIn a 2018 trial of 1,207 men, ${p(25)}\n\n## Second Question?\n\n${p()}\n\n${p()}\n\n## Myth vs Fact\n\n| Myth | Fact |\n| --- | --- |\n| a | b |\n| c | d |\n\n## Key Takeaways\n\n- one\n- two\n\n## Frequently Asked Questions\n\n**1. Q?**\n${p(10)}\n\n**2. Q2?**\n${p(10)}\n\n## Final Thoughts: Is It Right for You?\n\n${p()}\n\n${p()} [link](https://clinic.example/acne)\n\n## References:\n\n1. A (2020) B. Available at: https://a.example/1\n2. C (2021) D. Available at: https://b.example/2\n`;
  const issues = checkLayout(md, spec).issues.join('\n');
  assert.match(issues, /must not start with bold text[\s\S]*"- Term: explanation\." in plain text/);
  assert.match(issues, /has 2 columns; the sample's has 3/);
  assert.match(issues, /Give "Myth vs Fact" 10 myth and fact rows, as in the sample \(found 2\)/);
  assert.match(issues, /Give "Key Takeaways" 10 bullet points, as in the sample \(found 2\)/);
});

test('patterns name the callout the sample uses, and invented callout labels are flagged', async () => {
  const { patternsText } = await import('./samplePatterns');
  const spec = specFromOutline(sample2, base);
  assert.match(patternsText(spec.patterns), /then 1 paragraph\. \(use in exactly 1 section; the sample uses \*\*Evidence Note\*\* here/);
  const md = good().replace('**Clinical Note**', '**Safety Note**');
  assert.match(checkLayout(md, specFromOutline(outline, base)).issues.join('\n'), /Use only the client's callout labels \(\*\*Clinical Note\*\*\)[\s\S]*\*\*Safety Note\*\*/);
});

// sample 2 plus a Research Insight section with 2 paragraphs after its label.
const sample2b = sample2.replace(
  '## Second Question?\n',
  '## What Did the Trial Show?\n[2 paragraphs, ~40 words each]\n**Research Insight** [bold label on its own line]\n[2 paragraphs, ~40 words each]\n## Second Question?\n'
);

test('the sample order of special sections and each callout shape are read from the sample', () => {
  const spec = specFromOutline(sample2b, base);
  assert.deepEqual(spec.patterns.order, ['UK Guidance Note', 'table', 'list', 'Evidence Note', 'Research Insight']);
  assert.equal(spec.patterns.bodyCount, 5);
});

test('a callout in the wrong shape, special sections out of order and bad Title Case are flagged', () => {
  const spec = specFromOutline(sample2b, { ...base, minWords: 0, maxWords: 99999 });
  const p = (n = 30) => words(n);
  const sec = {
    uk: `## First Question?\n\n${p()}\n\n${p()}\n\n**UK Guidance Note**\n${p()}\n\n`,
    table: `## Options At A Glance\n\n| A | B | C |\n| --- | --- | --- |\n| x | y | z |\n\n`,
    list: `## Can It Interact With Other Medicines?\n\n${p()}\n\n- Warfarin: reduced effect.\n- Dabigatran: reduced effect.\n- Statins: lower levels.\n- Omeprazole: lower levels.\n\n${p()}\n\n**Evidence Note**\nIn a 2018 trial of 1,207 men, ${p(25)}\n\n`,
    research: `## What Did the Trial Show?\n\n${p()}\n\n${p()}\n\n**Research Insight**\nIn 2018, 1,207 men took part; ${p(25)}\n\n`,
  };
  const md = `# Title?\n\n${p()}\n\n${p()}\n\n${sec.table}${sec.uk}${sec.list}${sec.research}## Second Question?\n\n${p()}\n\n${p()}\n\n## Final Thoughts: A Better Choice?\n\n${p()}\n\n${p()}\n`;
  const issues = checkLayout(md, spec).issues.join('\n');
  assert.match(issues, /"What Did the Trial Show\?" holds the \*\*Research Insight\*\*; in the sample that section is 2 paragraphs, then a bold callout label on its own line, then 2 paragraphs/);
  assert.match(issues, /same order as the sample: the \*\*UK Guidance Note\*\*, then the table section[\s\S]*This article has the table section, then the \*\*UK Guidance Note\*\*/);
  assert.match(issues, /Title Case[\s\S]*"Options At A Glance"/);
  assert.doesNotMatch(issues, /"Final Thoughts: A Better Choice\?"/);
});

