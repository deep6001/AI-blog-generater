import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultGuidelineProfile, effectiveGuidelines } from './guidelines';
import type { GuidelineProfile, Project } from '../types/pipeline';

const profile: GuidelineProfile = {
  ...createDefaultGuidelineProfile('Client rules'),
  id: 'profile-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  sampleName: 'profile sample.docx',
  sampleOutline: '# Profile sample',
  sampleWordCount: 3000,
};
const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: '16 section',
  description: '',
  targetAudience: '',
  tone: '',
  targetWordCount: 2500,
  tags: [],
  steps: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  guidelineProfileId: 'profile-1',
  ...extra,
});

test("a project without its own sample uses the profile's sample", () => {
  assert.equal(effectiveGuidelines(project(), profile), profile);
});

test("a project's own sample replaces the profile's sample for that project only", () => {
  const g = effectiveGuidelines(project({ sampleName: '16 sections.docx', sampleOutline: '# Sixteen', sampleWordCount: 2600 }), profile)!;
  assert.equal(g.sampleName, '16 sections.docx');
  assert.equal(g.sampleOutline, '# Sixteen');
  assert.equal(g.writingRules, profile.writingRules, 'the rules still come from the profile');
  assert.equal(profile.sampleOutline, '# Profile sample', 'the shared profile is not changed');
});

test('a project with a sample but no profile gets the default rules plus its sample', () => {
  const g = effectiveGuidelines(project({ guidelineProfileId: null, sampleOutline: '# Own' }), null)!;
  assert.equal(g.sampleOutline, '# Own');
  assert.match(g.name, /16 section \(project sample\)/);
  assert.equal(effectiveGuidelines(project({ guidelineProfileId: null }), null), null);
});
