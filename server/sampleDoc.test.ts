import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToDocxBlob } from '../src/utils/docxExport.ts';
import { summariseSampleDocx, sampleContext } from './sampleDoc';

const md = `# Does a Colposcopy Hurt?

If you're due to have a colposcopy, it's natural to wonder how it will feel.

## What Happens During a Colposcopy?

You lie on a couch while a nurse uses a speculum.

**Clinical Note**
Tell your nurse if you feel uncomfortable.

| Stage | How it may feel |
| --- | --- |
| Speculum | Pressure |

- **Stinging:** the liquids can sting briefly.
- **Cramping:** a biopsy may feel like a period pain.

## Frequently Asked Questions

**1. Will it hurt?**
Most people feel mild discomfort.

**2. How long does it take?**
Usually about 15 minutes.

## References:

1. NHS (2024) Colposcopy. Available at: https://www.nhs.uk/tests-and-treatments/colposcopy/
`;

test('a docx built by the exporter reads back as the same layout and styling', async () => {
  const blob = await markdownToDocxBlob(md, 'Test', { font: 'Georgia', bodySize: 11, marginMm: 20 });
  const summary = summariseSampleDocx(new Uint8Array(await blob.arrayBuffer()));
  const o = summary.outline;
  assert.match(o, /^# Does a Colposcopy Hurt\?/m);
  assert.match(o, /^## What Happens During a Colposcopy\?/m);
  assert.match(o, /\*\*Clinical Note\*\* \[bold label on its own line\]/);
  assert.match(o, /\[Table: 2 columns \(Stage \| How it may feel\), 1 rows/);
  assert.match(o, /Bulleted list, 2 items, each starting with a bold lead-in/);
  assert.match(o, /\[2 FAQ items: bold numbered question, line break/);
  assert.match(o, /Numbered list, 1 items/);
  assert.equal(summary.style.font, 'Georgia');
  assert.equal(summary.style.bodySize, 11);
  assert.equal(summary.style.marginMm, 20);
});

test('non-docx input is rejected', () => {
  assert.throws(() => summariseSampleDocx(new Uint8Array([1, 2, 3])));
});

test('sampleContext tells the writer to copy structure, not wording', () => {
  assert.match(sampleContext('## Example', 3000), /never copy the sample's wording or facts/);
  assert.match(sampleContext('## Example', 3000), /about 3000 words/);
});
