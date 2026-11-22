import { apiFetch, supabase } from '../lib/supabase';
import { Project, ResearchPack } from '../types/pipeline';

export async function fetchResearch(
  project: Project,
  topic: string,
  approvedSources: string[] = [],
  model?: string | null,
  minSources = 0
): Promise<ResearchPack & { model: string; styleNotesError?: string }> {
  const response = await apiFetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      audience: project.targetAudience,
      tone: project.tone,
      referenceUrls: project.referenceUrls || [],
      approvedSources,
      model: model || undefined,
      minSources,
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
      approved_sources: pack.approvedSources ?? null,
      approved_references: pack.approvedReferences ?? null,
      rejected_references: pack.rejectedReferences ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** How long research for a topic is reused before it is run again. */
export const RESEARCH_REUSE_DAYS = 30;

const sameList = (a?: string[] | null, b?: string[] | null) =>
  [...(a || [])].map((x) => x.trim().toLowerCase()).sort().join('|') === [...(b || [])].map((x) => x.trim().toLowerCase()).sort().join('|');

/**
 * The workspace's most recent research for the same topic and approved sources, from the last
 * RESEARCH_REUSE_DAYS days. Reusing it avoids paying for the same web searches again.
 */
export async function findRecentResearch(params: {
  tenantId: string;
  topic: string;
  approvedSources: string[];
  minSources: number;
}): Promise<(ResearchPack & { reusedFrom: string }) | null> {
  const since = new Date(Date.now() - RESEARCH_REUSE_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from('research_runs')
    .select('id, topic, brief, style_notes, sources, search_queries, created_at, approved_sources, approved_references, rejected_references')
    .eq('tenant_id', params.tenantId)
    // ilike without wildcards: a case-insensitive exact match on the topic.
    .ilike('topic', params.topic.trim().replace(/[%_\\]/g, (c) => `\\${c}`))
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error || !data) return null;
  const run = data.find((r: any) =>
    params.approvedSources.length
      ? Array.isArray(r.approved_references) && r.approved_references.length > 0 && sameList(r.approved_sources, params.approvedSources)
      : !r.approved_sources?.length && (r.sources?.length || 0) >= params.minSources
  );
  if (!run) return null;
  return {
    id: run.id,
    topic: run.topic,
    brief: run.brief,
    styleNotes: run.style_notes ?? undefined,
    sources: run.sources || [],
    searchQueries: run.search_queries || [],
    createdAt: run.created_at,
    ...(params.approvedSources.length
      ? { approvedSources: run.approved_sources, approvedReferences: run.approved_references, rejectedReferences: run.rejected_references || [] }
      : {}),
    reusedFrom: run.created_at,
  };
}
