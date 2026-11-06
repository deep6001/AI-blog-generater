import { apiFetch, supabase } from '../lib/supabase';
import { GuidelineProfile, QaReview } from '../types/pipeline';

function rowToProfile(r: any): GuidelineProfile {
  return {
    id: r.id,
    name: r.name,
    writingRules: r.writing_rules,
    referenceRules: r.reference_rules,
    qaChecklist: r.qa_checklist,
    scoreScale: r.score_scale,
    referenceStyle: r.reference_style,
    referenceCount: r.reference_count,
    referenceMix: r.reference_mix,
    allowedDomains: r.allowed_domains || [],
    minWordCount: r.min_word_count,
    cta: r.cta,
    internalLinks: r.internal_links,
    sampleName: r.sample_name ?? null,
    sampleOutline: r.sample_outline ?? null,
    sampleWordCount: r.sample_word_count ?? null,
    sampleStyle: r.sample_style ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function profileToRow(p: Omit<GuidelineProfile, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    name: p.name.trim(),
    writing_rules: p.writingRules,
    reference_rules: p.referenceRules,
    qa_checklist: p.qaChecklist,
    score_scale: p.scoreScale,
    reference_style: p.referenceStyle,
    reference_count: p.referenceCount,
    reference_mix: p.referenceMix,
    allowed_domains: p.allowedDomains,
    min_word_count: p.minWordCount,
    cta: p.cta,
    internal_links: p.internalLinks,
    sample_name: p.sampleName ?? null,
    sample_outline: p.sampleOutline ?? null,
    sample_word_count: p.sampleWordCount ?? null,
    sample_style: p.sampleStyle ?? null,
  };
}

export async function loadGuidelineProfiles(tenantId: string): Promise<GuidelineProfile[]> {
  const { data, error } = await supabase
    .from('guideline_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  if (error) throw error;
  return (data || []).map(rowToProfile);
}

export async function createGuidelineProfile(
  tenantId: string,
  profile: Omit<GuidelineProfile, 'id' | 'createdAt' | 'updatedAt'>
): Promise<GuidelineProfile> {
  const { data, error } = await supabase
    .from('guideline_profiles')
    .insert({ ...profileToRow(profile), tenant_id: tenantId })
    .select('*')
    .single();
  if (error) throw error;
  return rowToProfile(data);
}

export async function updateGuidelineProfile(profile: GuidelineProfile): Promise<GuidelineProfile> {
  const { data, error } = await supabase
    .from('guideline_profiles')
    .update(profileToRow(profile))
    .eq('id', profile.id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToProfile(data);
}

export async function deleteGuidelineProfile(id: string): Promise<void> {
  const { error } = await supabase.from('guideline_profiles').delete().eq('id', id);
  if (error) throw error;
}

/** The fields the server needs; ids, timestamps and export styling stay client-side. */
export function guidelinePayload(p: GuidelineProfile) {
  const { id: _id, createdAt: _c, updatedAt: _u, sampleStyle: _s, sampleName: _n, ...rest } = p;
  return rest;
}

export interface SampleSummary {
  outline: string;
  wordCount: number;
  style: NonNullable<GuidelineProfile['sampleStyle']>;
}

/** Sends a sample .docx to the server, which describes its layout and styling. */
export async function analyseSampleDocx(file: File): Promise<SampleSummary> {
  const res = await apiFetch('/api/sample-docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not read the sample (HTTP ${res.status})`);
  return data;
}

export async function requestQaReview(
  article: string,
  profile: GuidelineProfile,
  sourceUrls: string[],
  model?: string | null
): Promise<QaReview & { model: string }> {
  const response = await apiFetch('/api/qa-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article, guidelines: guidelinePayload(profile), sourceUrls, model: model || undefined }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `QA review failed (HTTP ${response.status})`);
  return { ...data, profileName: profile.name };
}

export async function saveQaReview(params: {
  tenantId: string;
  userId: string;
  projectId: string;
  sessionId: string;
  profileId: string;
  article: string;
  result: QaReview & { model: string };
}): Promise<string> {
  const { result } = params;
  const { data, error } = await supabase
    .from('qa_reviews')
    .insert({
      tenant_id: params.tenantId,
      user_id: params.userId,
      project_id: params.projectId,
      session_id: params.sessionId,
      guideline_profile_id: params.profileId || null,
      article: params.article,
      review: result.review,
      verdict: result.verdict ?? null,
      score: result.score ?? null,
      score_after: result.scoreAfter ?? null,
      score_scale: result.scoreScale,
      model: result.model,
      total_tokens: result.tokenUsage?.totalTokens ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
