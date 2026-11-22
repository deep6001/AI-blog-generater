import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, blueprintFromOutline, buildFromBlueprint, template, validateFilled } from './skeleton';
import { checkLayout, specFromOutline } from './layoutCheck';

// Shaped like the client's "sample 2".
const outline = `# Apalutamide for Prostate Cancer: Who Is It For?
[2 paragraphs, ~45 words each]
## What Exactly Is Apalutamide?
[2 paragraphs, ~40 words each]
## Apalutamide Eligibility at a Glance
[Table: 3 columns (Clinical setting | Regimen | Selection point), 4 rows, bold header row]
## Can It Treat Metastatic Disease?
[2 paragraphs, ~40 words each]
**UK Guidance Note** [bold label on its own line]
[1 paragraph, ~60 words]
## What Did the SPARTAN Trial Show?
[2 paragraphs, ~40 words each]
**Research Insight** [bold label on its own line]
[2 paragraphs, ~35 words each]
## Can It Interact With Your Other Medicines?
[1 paragraph, ~25 words]
[Bulleted list, 6 items. e.g. "Warfarin or acenocoumarol: it can reduce their effect."]
[1 paragraph, ~25 words]
**Evidence Note** [bold label on its own line]
[1 paragraph, ~35 words]
## How Will Your Health Be Monitored?
[2 paragraphs, ~45 words each]
## Myth vs Fact
[Table: 2 columns (Myth | Fact), 6 rows, bold header row]
## Key Takeaways
[Bulleted list, 6 items. e.g. "x"]
## Frequently Asked Questions
[4 FAQ items: bold numbered question, line break, answer of ~26 words]
## Final Thoughts: Is Apalutamide Right for You?
[2 paragraphs, ~43 words each, contains an internal link]
## References:
[Numbered list, 3 items. e.g. "Smith, M.R. et al. (2018) ‘x’, NEJM. Available at: https://pubmed.ncbi.nlm.nih.gov/1/"]`;

let refN = 0;
/** Replaces every placeholder with plausible text of the requested length, like a model would. */
function fill(value: unknown): any {
  if (typeof value === 'string') {
    const n = Number(value.match(/about (\d+) words/)?.[1] || 0);
    if (n) return `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')} in 2018 with 120 people.`;
    if (/reader question|question for/.test(value)) return 'Is This a Good Question for You?';
    if (/descriptive title/.test(value)) return 'Options at a Glance';
    if (/Cite as/.test(value)) return `Smith, M.R. et al. (2018) ‘Trial’, Journal. Available at: https://pubmed.ncbi.nlm.nih.gov/${++refN}/`;
    return 'Short text';
  }
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') {
    if ('label' in (value as any)) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
  }
  return value;
}

test('blueprintFromOutline keeps every section, slot, callout and closing part in order', () => {
  const bp = blueprintFromOutline(outline)!;
  assert.equal(bp.body.length, 6);
  assert.deepEqual(
    bp.body.map((b) => b.slots.map((s) => (s.kind === 'callout' ? s.label : s.kind)).join(',')),
    [
      'para,para',
      'table',
      'para,para,UK Guidance Note,para',
      'para,para,Research Insight,para,para',
      'para,list,para,Evidence Note,para',
      'para,para',
    ]
  );
  const list = bp.body[4].slots[1];
  assert.equal(list.kind === 'list' && list.style, 'plain');
  assert.deepEqual(
    bp.closing.map((c) => c.kind),
    ['myth', 'takeaways', 'faq', 'final', 'references']
  );
});

test('an article assembled from a filled blueprint matches the sample layout with no structural issues', () => {
  const bp = blueprintFromOutline(outline)!;
  const filled = fill(template(bp));
  assert.deepEqual(validateFilled(bp, filled), []);
  const md = assemble(bp, filled);
  assert.match(md, /^\*\*UK Guidance Note\*\*$/m);
  assert.match(md, /^- Short text: Short text\.$/m, 'plain "Term: text" list items, not bold');
  assert.match(md, /^\*\*1\. Is This a Good Question for You\?\*\*\n/m);
  const spec = specFromOutline(outline, { minWords: 0, maxWords: 99999, minReferences: 1, noDoiLinks: true, internalLinkUrls: [] });
  const structural = checkLayout(md, spec).issues.filter((i) => !/Say each point once|too thin|sentences tell the reader/.test(i));
  assert.deepEqual(structural, []);
});

test('validateFilled reports a reply that changed the shape', () => {
  const bp = blueprintFromOutline(outline)!;
  const filled = fill(template(bp));
  filled.sections.pop();
  assert.match(validateFilled(bp, filled).join('\n'), /exactly 6 items/);
  const moved = fill(template(bp));
  moved.sections[2].slots[2] = { label: 'Safety Note' };
  assert.match(validateFilled(bp, moved).join('\n'), /must be \{"label": "UK Guidance Note"\}/);
});

test('buildFromBlueprint retries once with the problems, then gives up cleanly', async () => {
  const bp = blueprintFromOutline(outline)!;
  const good = JSON.stringify(fill(template(bp)));
  const prompts: string[] = [];
  const ok = await buildFromBlueprint(bp, 'PROMPT', async (p) => {
    prompts.push(p);
    return prompts.length === 1 ? '{"title": "x"}' : `\`\`\`json\n${good}\n\`\`\``;
  });
  assert.equal(ok.attempts, 2);
  assert.ok(ok.article);
  assert.match(prompts[1], /DID NOT FIT THE TEMPLATE/);
  const bad = await buildFromBlueprint(bp, 'PROMPT', async () => 'not json');
  assert.equal(bad.article, null);
});
