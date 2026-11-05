import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnverifiedUrls, researchContext } from './research';

const sources = [
  { id: 1, title: 'NICE NG110', url: 'https://www.nice.org.uk/guidance/ng110', domain: 'nice.org.uk' },
  { id: 2, title: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/32488742/', domain: 'pubmed.ncbi.nlm.nih.gov' },
];

test('findUnverifiedUrls ignores research sources despite trailing slashes, www and punctuation', () => {
  const text = `See NICE (https://nice.org.uk/guidance/ng110/). Also https://pubmed.ncbi.nlm.nih.gov/32488742.`;
  assert.deepEqual(findUnverifiedUrls(text, sources), []);
});

test('findUnverifiedUrls flags links the model made up, once each', () => {
  const text = `1. Smith (2024) https://journal.example.com/fake-study\n2. Again https://journal.example.com/fake-study`;
  assert.deepEqual(findUnverifiedUrls(text, sources), ['https://journal.example.com/fake-study']);
});

test('researchContext lists every source with its number and exact URL', () => {
  const ctx = researchContext({ brief: 'Fact [1]', sources, createdAt: '2026-10-31T00:00:00Z' });
  assert.match(ctx, /\[1\] NICE NG110\. https:\/\/www\.nice\.org\.uk\/guidance\/ng110/);
  assert.match(ctx, /\[2\] PubMed\./);
  assert.match(ctx, /2026-10-31/);
});

test('stripTracking removes utm parameters but keeps real ones', async () => {
  const { stripTracking } = await import('./llm');
  assert.equal(stripTracking('https://www.nhs.uk/tests/colposcopy/?utm_source=openai'), 'https://www.nhs.uk/tests/colposcopy/');
  assert.equal(stripTracking('https://pubmed.ncbi.nlm.nih.gov/?term=x&utm_medium=a'), 'https://pubmed.ncbi.nlm.nih.gov/?term=x');
});
