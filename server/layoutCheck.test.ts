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
${words(15)}

${words(15)}

## Second Question?

${words(body)}

## Myth vs Fact

| Myth | Fact |
| --- | --- |
| a | b |

## Key Takeaways

- one
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

test('specFromOutline reads paragraph limit, callouts, closing sections and FAQ count from the template', () => {
  const spec = specFromOutline(outline, base);
  assert.equal(spec.parasPerSection, 2);
  assert.deepEqual(spec.callouts, ['Clinical Note']);
  assert.deepEqual(spec.closing.map((c) => [c.heading, c.kinds.join(',')]), [
    ['Myth vs Fact', 'table'],
    ['Key Takeaways', 'bullets'],
    ['Frequently Asked Questions', 'faq'],
    ['Final Thoughts', 'para,para'],
    ['References', 'numbered'],
  ]);
  assert.equal(spec.faqCount, 2);
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
  assert.match(issues, /at most 2 paragraphs[\s\S]*"Second Question\?" \(3 paragraphs\)/);
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

test("callouts need the sample's paragraph count, their own section and the References heading text", async () => {
  const { dedupeReferences } = await import('./layoutCheck');
  const spec = specFromOutline(outline, base);
  assert.equal(spec.calloutParas, 2);
  assert.equal(spec.referencesHeading, 'References:');
  const twoParaNote = `**Clinical Note**\n${words(15)}\n\n${words(15)}\n`;
  const crowded = good().replace(twoParaNote, `**Clinical Note**\n${words(15)}\n\n**Evidence Note**\n${words(15)}\n`);
  const issues = checkLayout(crowded, { ...spec, callouts: ['Clinical Note', 'Evidence Note'] }).issues.join('\n');
  assert.match(issues, /followed by 2 paragraphs[\s\S]*Clinical Note \(1\)/);
  assert.match(issues, /different body section[\s\S]*"First Question\?" \(Clinical Note, Evidence Note\)/);
  assert.match(dedupeReferences(good().replace('## References:', '## References'), 'References:'), /^## References:$/m);
});

test('a sample with a bold lead-in body list requires one in the article', () => {
  const withList = outline.replace(
    '## Second Question?\n',
    '## Second Question?\n[Bulleted list, 3 items, each starting with a bold lead-in. e.g. "x"]\n'
  );
  const spec = specFromOutline(withList, base);
  assert.equal(spec.bodyLeadInList, true);
  assert.match(checkLayout(good(), spec).issues.join('\n'), /bold lead-in/);
  const fixed = good().replace('## Second Question?\n\n', '## Second Question?\n\n- **Redness:** common.\n- **Stinging:** brief.\n\n');
  assert.doesNotMatch(checkLayout(fixed, spec).issues.join('\n'), /bold lead-in/);
});

test('body tables and lists must have exactly the sample section shapes', () => {
  const shapedOutline = outline.replace(
    '## Second Question?\n[2 paragraphs, ~40 words each]\n',
    '## Second Question?\n[2 paragraphs, ~40 words each]\n## How the Options Compare\n[Table: 2 columns (A | B), 3 rows, bold header row]\n## What Side Effects Can It Cause?\n[1 paragraph, ~30 words]\n[Bulleted list, 3 items, each starting with a bold lead-in. e.g. "x"]\n[1 paragraph, ~30 words]\n'
  );
  const spec = specFromOutline(shapedOutline, base);
  assert.deepEqual(spec.tableSection, ['table']);
  assert.deepEqual(spec.listSection, ['para', 'bullets', 'para']);

  const table = '| A | B |\n| --- | --- |\n| x | y |\n';
  const list = '- **Redness:** common.\n- **Stinging:** brief.\n';
  const right = good().replace(
    '## Myth vs Fact',
    `## How the Options Compare\n\n${table}\n## What Side Effects Can It Cause?\n\n${words(20)}\n\n${list}\n${words(15)}\n\n## Myth vs Fact`
  );
  assert.deepEqual(checkLayout(right, spec).issues.filter((i) => /shape/.test(i)), []);

  const wrong = good().replace(
    '## Myth vs Fact',
    `## Choosing a Practitioner?\n\n${words(20)}\n\n${words(20)}\n\n${table}\n## What Side Effects Can It Cause?\n\n${list}\n## Myth vs Fact`
  );
  const issues = checkLayout(wrong, spec).issues.join('\n');
  assert.match(issues, /own "## " heading[\s\S]*"Choosing a Practitioner\?" \(has paragraph\(s\) -> table\)/);
  assert.match(issues, /introductory paragraph[\s\S]*"What Side Effects Can It Cause\?" \(has bulleted list\)/);
});

test('a missing lead-in list names the section to convert', () => {
  const withList = outline.replace(
    '## Second Question?\n',
    '## Second Question?\n[Bulleted list, 3 items, each starting with a bold lead-in. e.g. "x"]\n'
  );
  const spec = specFromOutline(withList, base);
  const md = good().replace('## Second Question?', '## What Side Effects Can It Cause?');
  assert.match(checkLayout(md, spec).issues.join('\n'), /Convert the body section "What Side Effects Can It Cause\?"/);
});
