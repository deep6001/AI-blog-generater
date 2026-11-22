import test from 'node:test';
import assert from 'node:assert/strict';
import { measureVoice, voiceFromOutline, voiceIssue, voiceLine } from './voice';

const you = 'If you have had this treatment, you may notice changes in your vision, and your surgeon can explain what they mean for you over the coming weeks of your recovery.';
const textbook = 'Removal of the segment involves another operation, and outcomes depend on corneal thickness, segment position and the surgical technique used by the operating team during the procedure itself.';

test('measureVoice counts "you/your" per 100 words and the share of paragraphs using it', () => {
  const v = measureVoice([you, you, you, textbook, textbook])!;
  assert.equal(v.share, 0.6);
  assert.ok(v.per100 > 10 && v.per100 < 15);
  assert.equal(measureVoice([you]), null, 'too few paragraphs to judge');
});

test('the voice line round-trips through the outline', () => {
  const line = voiceLine({ per100: 6.7, share: 0.89 });
  assert.equal(line, '[Voice: second person, ~6.7 "you/your" per 100 words, in 89% of paragraphs]');
  assert.deepEqual(voiceFromOutline(`## References:\n[Numbered list, 5 items]\n${line}`), { per100: 6.7, share: 0.89 });
});

test('voiceIssue names the sections whose paragraphs never address the reader', () => {
  const target = { per100: 6.7, share: 0.89 };
  const md = `# T\n\n${you}\n\n${you}\n\n## What Is It?\n\n${textbook}\n\n${textbook}\n\n## Does It Hurt?\n\n${you}\n\n${textbook}\n\n**Evidence Note**\n\n${textbook}\n\n## Myth vs Fact\n\n| a | b |\n`;
  const issue = voiceIssue(md, target)!;
  assert.match(issue, /Rewrite the 3 paragraphs[\s\S]*"What Is It\?"; "Does It Hurt\?"/);
  assert.doesNotMatch(issue, /Evidence Note/, 'study descriptions in Evidence Notes are not counted');
  const warm = md.replace(new RegExp(textbook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), you);
  assert.equal(voiceIssue(warm, target), null);
  assert.equal(voiceIssue(md, null), null, 'no sample voice, no check');
});
