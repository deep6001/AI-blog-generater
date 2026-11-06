import { apiFetch, supabase } from '../lib/supabase';
import { Project, ResearchPack } from '../types/pipeline';

export async function fetchResearch(
  project: Project,
  topic: string,
  allowedDomains: string[] = [],
  model?: string | null
): Promise<ResearchPack & { model: string; styleNotesError?: string }> {
  const response = await apiFetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      audience: project.targetAudience,
      tone: project.tone,
      referenceUrls: project.referenceUrls || [],
      allowedDomains,
      model: model || undefined,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Web research failed (HTTP ${response.status})`);
  }
  return data;
}

/** Stores the research run so every published claim can be traced back to its sources. */
export async function saveResearchRun(params: {
  userId: string;
  tenantId: string;
  projectId: string;
  sessionId: string;
  referenceUrls: string[];
  pack: ResearchPack & { model: string };
}): Promise<string> {
  const { pack } = params;
  const { data, error } = await supabase
    .from('research_runs')
    .insert({
      tenant_id: params.tenantId,
      user_id: params.userId,
      project_id: params.projectId,
      session_id: params.sessionId,
      topic: pack.topic,
      search_queries: pack.searchQueries,
      reference_urls: params.referenceUrls,
      brief: pack.brief,
      style_notes: pack.styleNotes ?? null,
      sources: pack.sources,
      model: pack.model,
      total_tokens: pack.tokenUsage?.totalTokens ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
