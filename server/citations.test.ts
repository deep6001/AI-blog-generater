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
  const meta = { authors: ['McKnight, B.', 'Tobin, R.', 'Kabir, Y.'], year: '2015', title: 'Improving Upper Arm Skin Laxity Using a Tripollar Radiofrequency Device.', journal: 'Journal of drugs in dermatology : JDD' };
  assert.equal(
    harvard(meta, 'x', url),
    "McKnight, B. et al. (2015) 'Improving Upper Arm Skin Laxity Using a Tripollar Radiofrequency Device', Journal of Drugs in Dermatology. Available at: https://pubmed.ncbi.nlm.nih.gov/26659940/"
  );
  assert.match(harvard({ ...meta, authors: ['A, B.', 'C, D.'] }, 'x', url), /^A, B\. and C, D\. \(2015\)/);
  assert.equal(
    harvard(undefined, 'Acne - NHS', 'https://www.nhs.uk/conditions/acne/'),
    "NHS (no date) 'Acne - NHS'. Available at: https://www.nhs.uk/conditions/acne/"
  );
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
