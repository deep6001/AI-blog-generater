import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistFromBrief, uncoveredQuestions } from './coverage';
import { evidenceFromOutline, evidenceIssues, evidenceLine, measureEvidence, referenceNames, sourceKind } from './evidence';

const brief = `## What readers are really asking
- Is forceps worse than ventouse?

## Questions this article must answer
1. What is an assisted vaginal birth?
2. Will you need antibiotics after an assisted birth?
3. How can you protect your pelvic floor during recovery?
4. Could you need forceps again in a future pregnancy? [3]

## Key facts and figures
- something`;

test('checklistFromBrief reads the "must answer" list and drops citation markers', () => {
  assert.deepEqual(checklistFromBrief(brief), [
    'What is an assisted vaginal birth?',
    'Will you need antibiotics after an assisted birth?',
    'How can you protect your pelvic floor during recovery?',
    'Could you need forceps again in a future pregnancy?',
  ]);
  assert.deepEqual(checklistFromBrief('## What readers are really asking\n- How long is recovery after forceps?\n'), ['How long is recovery after forceps?']);
});

test('uncoveredQuestions finds the questions the article leaves out, ignoring the topic words', () => {
  const md = `# Forceps or Ventouse Birth\n\nAn assisted vaginal birth uses forceps or ventouse to help your baby out.\n\n## Recovery\n\nYour stitches heal over a few weeks. Pelvic floor exercises help you protect your pelvic floor.\n\n## References:\n\n1. x`;
  assert.deepEqual(uncoveredQuestions(md, checklistFromBrief(brief), 'Forceps or Ventouse Birth'), [
    'Will you need antibiotics after an assisted birth?',
    'Could you need forceps again in a future pregnancy?',
  ]);
});

test('measureEvidence counts statistics and named guidance per 1,000 words, and round-trips the outline line', () => {
  const text = `${'word '.repeat(470)}About 1 in 8 women (12%) have an assisted birth. The ANODE trial of 3,420 women found fewer infections. RCOG guidance and NICE recommend one dose of antibiotics.`;
  const e = measureEvidence(text)!;
  assert.ok(e.statsPer1000 > 5 && e.namedPer1000 > 5);
  assert.deepEqual(evidenceFromOutline(`x\n${evidenceLine(e)}`), e);
});

test('evidenceIssues flags few figures, no named guidance, a vague UK Guidance Note and unused references', () => {
  const para = 'You may notice some soreness, and your midwife will check how you are healing before you go home. '.repeat(3);
  const md = `# T\n\n${para}\n\n## Q?\n\n${para}\n\n**UK Guidance Note**\n\nGuidance says you should be offered support.\n\n## References:\n\n1. Knight, M. et al. (2019) ‘Prophylactic antibiotics after operative vaginal delivery (ANODE)’, The Lancet. Available at: https://x\n2. Royal College of Obstetricians and Gynaecologists (2020) Assisted vaginal birth. Available at: https://y\n`;
  const issues = evidenceIssues(md, { statsPer1000: 8, namedPer1000: 4 }).join('\n');
  assert.match(issues, /has 0 statistics/);
  assert.match(issues, /names guidance bodies, guidelines or trials 0 times/);
  assert.match(issues, /UK Guidance Note must cite real UK guidance/);
  assert.match(issues, /Not mentioned in the text: Knight[\s\S]*Royal College/);

  const fixed = md.replace('Guidance says you should be offered support.', 'RCOG guidance advises one dose of antibiotics; the ANODE trial of 3,420 women found 11% fewer infections.');
  const after = evidenceIssues(fixed, { statsPer1000: 1, namedPer1000: 1 }).join('\n');
  assert.doesNotMatch(after, /UK Guidance Note/);
  assert.doesNotMatch(after, /Not mentioned in the text/, 'ANODE names the Knight trial and RCOG names the royal college');
  assert.deepEqual(evidenceIssues(md, null), [], 'no bar, no check');
});

test('referenceNames and sourceKind recognise guidance, reviews and studies', () => {
  assert.ok(referenceNames('National Institute for Health and Care Excellence (NICE) (2021) Postnatal care.').includes('NICE'));
  assert.ok(referenceNames('Muraca, G.M. et al. (2022) ‘Maternal trauma’, CMAJ.').includes('Muraca'));
  assert.equal(sourceKind('https://www.rcog.org.uk/guidance/x', 'Assisted vaginal birth'), 'guidance');
  assert.equal(sourceKind('https://www.cochranelibrary.com/cdsr/x', 'Instruments for assisted vaginal birth'), 'systematic review');
  assert.equal(sourceKind('https://pubmed.ncbi.nlm.nih.gov/1/', 'A randomised controlled trial of antibiotics'), 'trial');
  assert.equal(sourceKind('https://pubmed.ncbi.nlm.nih.gov/2/', 'Maternal trauma after delivery'), 'study');
});
