import test from 'node:test';
import assert from 'node:assert/strict';
import { guidelinesContext, parseQaHeader, qaPrompt } from './guidelines';
import { createDefaultGuidelineProfile } from '../src/utils/guidelines';

const profile = createDefaultGuidelineProfile('LDC');

test('parseQaHeader reads verdict and both scores', () => {
  const text = 'VERDICT: Ready to Publish After Minor Changes\nSCORE: 88/100\nSCORE_AFTER: 95/100\n\n## Publication Verdict';
  assert.deepEqual(parseQaHeader(text, 100), {
    verdict: 'Ready to Publish After Minor Changes',
    score: 88,
    scoreAfter: 95,
  });
});

test('parseQaHeader does not mistake "Not Ready" or "Minor Changes" for "Ready to Publish"', () => {
  assert.equal(parseQaHeader('VERDICT: Not Ready to Publish Yet', 10).verdict, 'Not Ready to Publish Yet');
  assert.equal(parseQaHeader('VERDICT: **Ready to Publish**', 10).verdict, 'Ready to Publish');
});

test('parseQaHeader rejects scores outside the scale', () => {
  assert.equal(parseQaHeader('SCORE: 88/10', 10).score, undefined);
  assert.equal(parseQaHeader('SCORE: 8.5/10', 10).score, 8.5);
});

test('guidelinesContext uses the larger of profile minimum and project target word count', () => {
  assert.match(guidelinesContext(profile, 1500), /at least 2400 words/);
  assert.match(guidelinesContext({ ...profile, minWordCount: 0 }, 3000), /at least 3000 words/);
});

test('guidelinesContext includes client limits and short Harvard format', () => {
  const ctx = guidelinesContext({ ...profile, allowedDomains: ['nhs.uk', 'nice.org.uk'], referenceCount: 5 });
  assert.match(ctx, /only come from these domains: nhs\.uk, nice\.org\.uk/);
  assert.match(ctx, /No DOI links, no accessed dates/);
  assert.match(ctx, /Myth vs Fact, Key Takeaways, FAQs, Final Thoughts, References/);
});

test('qaPrompt asks for the right scale and the reference mix', () => {
  const prompt = qaPrompt('# Article', { ...profile, scoreScale: 10 }, []);
  assert.match(prompt, /SCORE: <number>\/10/);
  assert.match(prompt, /2 MDPI, 2 PMC, 2 PubMed, 2 ScienceDirect/);
});

test('parseQaHeader recognises "Requires Substantial Revision"', () => {
  assert.equal(parseQaHeader('VERDICT: Requires Substantial Revision', 100).verdict, 'Requires Substantial Revision');
});

test('default QA checklist enforces the strict whole-blog pass and end sequence', () => {
  const prompt = qaPrompt('# Article', profile, []);
  assert.match(prompt, /Never give 100\/100 just because earlier corrections were applied/);
  assert.match(prompt, /Myth vs Fact -> Key Takeaways -> FAQs -> Final Thoughts -> References/);
  assert.match(prompt, /NO "Key Takeaways" at the beginning/);
  assert.match(prompt, /Location \(section and paragraph\)/);
});
