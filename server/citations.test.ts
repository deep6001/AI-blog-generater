import test from 'node:test';
import assert from 'node:assert/strict';
import { harvard, metaFromHtml, ncbiId } from './citations';
import { contentIssues } from './layoutCheck';

test('ncbiId reads PubMed ids and PMC numbers from URLs', () => {
  assert.deepEqual(ncbiId('https://pubmed.ncbi.nlm.nih.gov/26659940/'), { db: 'pubmed', id: '26659940' });
  assert.deepEqual(ncbiId('https://pmc.ncbi.nlm.nih.gov/articles/PMC4898871/'), { db: 'pmc', id: '4898871' });
  assert.equal(ncbiId('https://www.nhs.uk/conditions/acne/'), null);
});

test('harvard formats one, two and many authors, and organisations without authors', () => {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/26659940/';
  const meta = {
    authors: ['McKnight, B.', 'Tobin, R.', 'Kabir, Y.'],
    year: '2015',
    title: 'Improving Upper Arm Skin Laxity Using a Tripollar Radiofrequency Device.',
    journal: 'Journal of drugs in dermatology : JDD',
    volume: '14',
    issue: '12',
    pages: '1463-6',
  };
  // Same shape as the clients' samples: curly quotes, volume(issue), pp. full page range with an en dash.
  assert.equal(
    harvard(meta, 'x', url),
    'McKnight, B. et al. (2015) ‘Improving Upper Arm Skin Laxity Using a Tripollar Radiofrequency Device’, Journal of Drugs in Dermatology, 14(12), pp. 1463–1466. Available at: https://pubmed.ncbi.nlm.nih.gov/26659940/'
  );
  assert.match(harvard({ ...meta, authors: ['A, B.', 'C, D.'] }, 'x', url), /^A, B\. and C, D\. \(2015\)/);
  assert.match(harvard({ ...meta, journal: 'The Lancet. Oncology', volume: undefined, pages: undefined }, 'x', url), /’, The Lancet Oncology\. Available/);
  // Web pages without a journal: no quotes, as in "NHS England (2026) Title. Available at: ..."
  assert.equal(
    harvard(undefined, 'Acne', 'https://www.nhs.uk/conditions/acne/'),
    'NHS (no date) Acne. Available at: https://www.nhs.uk/conditions/acne/'
  );
});

test('pageRange writes abbreviated ranges in full with an en dash', async () => {
  const { pageRange } = await import('./citations');
  assert.equal(pageRange('1463-6'), '1463–1466');
  assert.equal(pageRange('152-160'), '152–160');
  assert.equal(pageRange('e123'), 'e123');
});

test('metaFromHtml reads citation meta tags', () => {
  const html = `<meta name="citation_title" content="Arm contouring after weight loss">
<meta name="citation_author" content="Bishara, Jad">
<meta name="citation_author" content="Mary K. Chalhoub">
<meta name="citation_publication_date" content="2025/03/01">
<meta name="citation_journal_title" content="Plastic and Reconstructive Surgery - Global Open">`;
  assert.deepEqual(metaFromHtml(html), {
    authors: ['Bishara, J.', 'Chalhoub, M.K.'],
    title: 'Arm contouring after weight loss',
    year: '2025',
    journal: 'Plastic and Reconstructive Surgery - Global Open',
    volume: undefined,
    issue: undefined,
    pages: undefined,
  });
});

test('contentIssues flags repeated points, too many "Ask" sentences and callouts without figures', () => {
  const md = `# Title

## How Does It Work?

Circumference measurements alone do not prove that loose upper arm skin has tightened after treatment. Ask about it. Ask about cost. Ask about pain. Ask about sessions.

## What Do Studies Show?

Ask about evidence. Ask about results. Ask about risks.

**Evidence Note**
A small study looked at arm fat deposits and reported some change in contour.

Arm circumference measurements alone cannot prove loose upper arm skin has tightened.

## Myth vs Fact

| Myth | Fact |
| --- | --- |
`;
  const issues = contentIssues(md).join('\n');
  assert.match(issues, /Say each point once[\s\S]*"How Does It Work\?"[\s\S]*"What Do Studies Show\?"/);
  assert.match(issues, /7 sentences tell the reader to ask/);
  assert.match(issues, /Evidence Note callout must describe the study with figures/);

  const fine = md.replace('A small study looked', 'A 2017 study of 34 people, 7 treated on the arms, looked');
  assert.doesNotMatch(contentIssues(fine).join('\n'), /Evidence Note/);
});

test("journal names keep apostrophes lower case", () => {
  assert.match(
    harvard({ authors: ['Sadick, N.'], year: '2019', title: 'Treatment for cellulite', journal: "International journal of women's dermatology" }, 'x', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6374708/'),
    /International Journal of Women's Dermatology\./
  );
});

test('cut-off PDF titles are detected and replaced from the file name', async () => {
  const { brokenTitle, titleFromFileName } = await import('./citations');
  assert.equal(brokenTitle('Treatment options:'), true);
  assert.equal(brokenTitle('Having an intrastromal corneal ring to'), true);
  assert.equal(brokenTitle('Keratoconus - information for patients'), false);
  assert.equal(titleFromFileName('https://www.qvh.nhs.uk/wp-content/uploads/2024/09/Intracorneal-Rings-0354.pdf'), 'Intracorneal Rings');
  assert.equal(
    titleFromFileName('https://www.qvh.nhs.uk/x/Virtuak-Keratoconus-Monitoring-Clinic-WEB-VERSION-0736.pdf'),
    'Virtuak Keratoconus Monitoring Clinic'
  );
});

test('contentIssues flags an article that keeps saying what is not known', () => {
  const hedge = 'Evidence does not establish how often this happens in practice for most people.';
  const fact = 'A 2023 study of 52 eyes reported clear improvements in vision after the procedure.';
  const section = (h: string, lines: string[]) => `## ${h}\n\n${lines.join(' ')}\n\n`;
  const md = `# T\n\n${fact}\n\n${section('One?', [hedge, fact, hedge])}${section('Two?', [hedge, hedge, fact])}${section('Three?', [hedge, hedge, fact])}${section('Four?', [hedge, fact])}## Myth vs Fact\n`;
  assert.match(contentIssues(md).join('\n'), /says what is not known 7 times \("does not establish" x7\)/);
  const balanced = md.replace(/Evidence does not establish how often this happens in practice for most people\./g, fact.replace('52', '40'));
  assert.doesNotMatch(contentIssues(balanced).join('\n'), /what is not known/);
});
