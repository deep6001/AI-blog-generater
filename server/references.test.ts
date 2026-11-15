import test from 'node:test';
import assert from 'node:assert/strict';
import { isApproved, pageCoversTopic, parseApproved, topicTerms } from './references';
import { researchContext } from './research';
import { checkLayout, specFromOutline } from './layoutCheck';

const approved = ['nhs.uk', 'https://pubmed.ncbi.nlm.nih.gov/', 'https://www.bad.org.uk/patient-information-leaflets/'];

test('parseApproved separates whole sites from specific sections', () => {
  assert.deepEqual(parseApproved(approved), {
    domains: ['nhs.uk', 'pubmed.ncbi.nlm.nih.gov'],
    prefixes: ['bad.org.uk/patient-information-leaflets'],
  });
});

test('isApproved accepts subdomains and pages inside an approved section only', () => {
  assert.ok(isApproved('https://www.nhs.uk/conditions/acne/', approved));
  assert.ok(isApproved('https://pubmed.ncbi.nlm.nih.gov/32488742/', approved));
  assert.ok(isApproved('https://www.bad.org.uk/patient-information-leaflets/acne?x=1', approved));
  assert.ok(!isApproved('https://www.bad.org.uk/news/acne', approved));
  assert.ok(!isApproved('https://notnhs.uk/acne', approved));
  assert.ok(!isApproved('https://www.healthline.com/acne', approved));
});

test('topic check needs at least half of the topic words on the page', () => {
  const terms = topicTerms('Is HydraFacial Good for Acne-Prone Skin?');
  assert.deepEqual(terms, ['hydrafacial', 'acne', 'prone', 'skin']);
  assert.equal(pageCoversTopic('Acne is a common skin condition. Spots-prone areas...', terms).covers, true);
  assert.equal(pageCoversTopic('Booking and opening hours for our clinic.', terms).covers, false);
});

test('with an approved list, the writer is told to list only approved references', () => {
  const ctx = researchContext({
    brief: 'Brief',
    sources: [{ id: 1, title: 'Blog', url: 'https://blog.example/x', domain: 'blog.example' }],
    createdAt: '2026-11-16T00:00:00Z',
    approvedReferences: [
      { id: 1, title: 'NHS Acne', url: 'https://www.nhs.uk/conditions/acne/', domain: 'nhs.uk', checkedBy: 'page', matchedTerms: ['acne'], note: 'Acne is common.' },
    ],
  });
  assert.match(ctx, /\[R1\] NHS Acne\. https:\/\/www\.nhs\.uk\/conditions\/acne\//);
  assert.match(ctx, /ONLY the approved references above/);
});

test('the final check flags references outside the approved sites', () => {
  const md = `# T\n\nText.\n\n## References:\n\n1. NHS (2024) Acne. Available at: https://www.nhs.uk/conditions/acne/\n2. Blog (2023) Acne tips. Available at: https://blog.example/acne\n`;
  const spec = { ...specFromOutline(null, { minWords: 0, maxWords: 99999, minReferences: 2, noDoiLinks: true, internalLinkUrls: [] }), approvedSources: approved };
  const issues = checkLayout(md, spec).issues.join('\n');
  assert.match(issues, /approved references[\s\S]*Blog \(2023\)/);
  assert.doesNotMatch(issues, /NHS \(2024\)/);
});
