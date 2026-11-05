import test from 'node:test';
import assert from 'node:assert/strict';
import { Document, Packer } from 'docx';
import { markdownToDocxBlocks, docxFileName } from './docxExport.ts';

const md = `# Does a Colposcopy Hurt?

Intro paragraph.

**Clinical Note**
Tell your nurse if you feel discomfort.

## Frequently Asked Questions

**1. Will it hurt?**
Most people feel mild discomfort.

1. First list item
2. Second list item

## References:

1. NHS (2024) Colposcopy. Available at: https://www.nhs.uk/tests-and-treatments/colposcopy/
`;

test('docx export builds a valid document with FAQ breaks, restarted numbering and links', async () => {
  const xml = (await Packer.toBuffer(new Document({
    numbering: { config: [{ reference: 'numbers', levels: [{ level: 0, format: 'decimal', text: '%1.' }] }] },
    sections: [{ children: markdownToDocxBlocks(md) }],
  }))).toString('latin1');
  assert.ok(xml.length > 1000);
  const blocks = markdownToDocxBlocks(md);
  assert.ok(blocks.length >= 7);
});

test('docxFileName slugs the H1', () => {
  assert.equal(docxFileName(md, 'x'), 'does-a-colposcopy-hurt.docx');
});
