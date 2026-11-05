import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interpolatePrompt,
  extractVariables,
  validateStep,
  calculateBlogMetrics,
  createDefaultProjects,
  generateMedicalHtmlDocument,
  generateWordDocContent,
  generatePlainTextDocument,
  calculateGeminiCost,
  getProjectUsageHistory,
  recordProjectRunUsage,
} from './pipeline.ts';

test('interpolatePrompt correctly substitutes single and multiple placeholders', () => {
  const template = 'Write a blog on {{user_input}} for {{project_audience}} in {{project_tone}} tone.';
  const variables = {
    user_input: 'Why Does Prostatitis Keep Coming Back?',
    project_audience: 'Patients with recurrent symptoms',
    project_tone: 'Authoritative and compassionate',
  };

  const result = interpolatePrompt(template, variables);
  assert.equal(
    result,
    'Write a blog on Why Does Prostatitis Keep Coming Back? for Patients with recurrent symptoms in Authoritative and compassionate tone.'
  );
});

test('interpolatePrompt handles spaces inside curly braces', () => {
  const template = 'Hello {{  user_input  }} and {{ previous_step_output }}';
  const result = interpolatePrompt(template, {
    user_input: 'World',
    previous_step_output: 'Outline ready',
  });
  assert.equal(result, 'Hello World and Outline ready');
});

test('extractVariables finds all unique bracketed tokens', () => {
  const template = 'Check {{user_input}} then compare {{user_input}} with {{previous_step_output}} and {{tone}}';
  const vars = extractVariables(template);
  assert.deepEqual(vars.sort(), ['previous_step_output', 'tone', 'user_input'].sort());
});

test('validateStep catches missing title and empty prompt', () => {
  const invalid1 = validateStep({ title: '', promptTemplate: 'valid prompt' });
  assert.equal(invalid1.valid, false);
  assert.ok(invalid1.errors.some((e) => e.includes('title')));

  const invalid2 = validateStep({ title: 'Step 1', promptTemplate: '' });
  assert.equal(invalid2.valid, false);
  assert.ok(invalid2.errors.some((e) => e.includes('Prompt is required')));

  const valid = validateStep({ title: 'Step 1', promptTemplate: 'Analyze the topic' });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test('calculateBlogMetrics correctly calculates words, chars, reading time and headings', () => {
  const sampleMarkdown = `# Why Does Prostatitis Keep Coming Back?

If your prostatitis symptoms return after treatment, you may wonder whether the infection has returned.

## What Does Recurrent Prostatitis Actually Mean?
Chronic prostatitis can settle and then flare again without active bacterial infection.

### Diagnostic Workup
- Mid-stream urine culture
- Flow rate testing
`;

  const metrics = calculateBlogMetrics(sampleMarkdown);
  assert.ok(metrics.wordCount > 25);
  assert.ok(metrics.charCount > 100);
  assert.equal(metrics.headingCount, 3);
  assert.equal(metrics.readingTimeMinutes, 1);
});

test('createDefaultProjects provides Prostate Clinic London preset as premier template', () => {
  const projects = createDefaultProjects();
  assert.ok(projects.length >= 4);

  const pcl = projects.find((p) => p.id === 'proj-prostate-clinic-london');
  assert.ok(pcl, 'Prostate Clinic London preset must exist');
  assert.equal(pcl.steps.length, 5, 'Should have 5 calibrated clinical stages');
  assert.ok(pcl.steps[4].isFinalBlogStep, 'Stage 5 must be the final blog step');
  assert.ok(
    pcl.steps.every((s) => s.promptTemplate.includes('NO IMAGES')),
    'All steps must strictly enforce the no-images constraint'
  );
});

test('generateMedicalHtmlDocument produces styled clinical HTML with zero images', () => {
  const projects = createDefaultProjects();
  const sampleMd = `# Why Does Prostatitis Keep Coming Back?

| Possible explanation | What may suggest it | Usual next step |
| --- | --- | --- |
| Persistent chronic bacterial prostatitis | Recurrent infection | Culture-guided antibiotic assessment |

> **Research Insight**: A 2020 review in Current Urology Reports highlighted antimicrobial resistance.

![Accidental Image](https://example.com/test.png)
`;

  const html = generateMedicalHtmlDocument('Why Does Prostatitis Keep Coming Back?', sampleMd, projects[0]);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Prostate Clinic London'));
  assert.ok(html.includes('10 Harley Street'));
  assert.ok(html.includes('clinical-table'));
  assert.ok(html.includes('Research Insight'));
  assert.ok(!html.includes('https://example.com/test.png'), 'Strictly no images should exist in generated HTML');
});

test('generateWordDocContent produces Word XML/HTML format', () => {
  const projects = createDefaultProjects();
  const sampleMd = `# Clinical Guide\n\nClinical body paragraph.`;
  const doc = generateWordDocContent('Clinical Guide', sampleMd, projects[0]);
  assert.ok(doc.includes('xmlns:w="urn:schemas-microsoft-com:office:word"'));
  assert.ok(doc.includes('Prostate Clinic London'));
});

test('generatePlainTextDocument strips formatting and images', () => {
  const sampleMd = `# Clinical Guide\n\n**Bold text** and ![img](https://example.com/pic.jpg)`;
  const text = generatePlainTextDocument(sampleMd);
  assert.ok(!text.includes('#'));
  assert.ok(!text.includes('**'));
  assert.ok(!text.includes('pic.jpg'));
  assert.ok(text.includes('Clinical Guide'));
  assert.ok(text.includes('Bold text'));
});

test('calculateGeminiCost accurately computes cost based on Flash rates', () => {
  // 10,000 prompt tokens = $0.00075, 7,000 completion tokens = $0.0021
  const cost = calculateGeminiCost(10000, 7000);
  assert.equal(cost, 0.00285);
});

test('recordProjectRunUsage and getProjectUsageHistory return sorted usage records', () => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] || null,
      length: 0,
    };
  }

  const projects = createDefaultProjects();
  const history = getProjectUsageHistory(projects, {});
  assert.ok(Array.isArray(history));
  assert.ok(history.length > 0, 'Should return records including seeded history');

  const record = recordProjectRunUsage({
    projectId: 'proj-prostate-clinic-london',
    projectName: 'Clinical Healthcare Guide',
    date: '2026-10-25',
    timestamp: new Date().toISOString(),
    promptTokens: 10330,
    candidatesTokens: 6850,
    totalTokens: 17180,
    estimatedCostUsd: 0.0028,
    sessionTopic: 'Recurrent Prostatitis Clinical Guide',
    stepsCompleted: 5,
  });

  assert.ok(record.id.startsWith('usage-'));
  assert.equal(record.totalTokens, 17180);
});



test('interpolatePrompt fills [BLOG TOPIC] and still passes the previous step', () => {
  const out = interpolatePrompt('Create 10 FAQs about [BLOG TOPIC].', {
    input: 'HydraFacial for acne-prone skin',
    previous_step: 'DRAFT BODY',
  });
  assert.ok(out.startsWith('Create 10 FAQs about HydraFacial for acne-prone skin.'));
  assert.ok(out.includes('DRAFT BODY'));
  assert.ok(!out.includes('Blog topic:'));
});

test('interpolatePrompt adds both topic and previous output when a prompt references neither', () => {
  const out = interpolatePrompt('Polish this for publication.', { input: 'TOPIC X', previous_step: 'PREV Y' });
  assert.ok(out.includes('Blog topic:\nTOPIC X'));
  assert.ok(out.includes('Output of the previous step (build on it):\nPREV Y'));
});
