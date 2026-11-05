import { supabase } from '../lib/supabase';
import { Project, RunSession, ProjectUsageRecord } from '../types/pipeline';
import { DEFAULT_STARTER_PROJECT_IDS, filterUserOnlyProjects } from './projectFilters';

export interface UserPreferences {
  activeProjectId?: string | null;
  activeTab?: string;
  theme?: string;
  updatedAt?: string;
}

export { DEFAULT_STARTER_PROJECT_IDS, filterUserOnlyProjects };

// Row mapping (snake_case columns <-> app types) -------------------------------

function projectToRow(userId: string, tenantId: string, p: Project) {
  return {
    id: p.id,
    tenant_id: tenantId,
    user_id: userId,
    name: p.name,
    description: p.description || '',
    target_audience: p.targetAudience || '',
    tone: p.tone || '',
    target_word_count: p.targetWordCount || 1500,
    tags: p.tags || [],
    reference_urls: p.referenceUrls || [],
    guideline_profile_id: p.guidelineProfileId ?? null,
    model: p.model ?? null,
    steps: p.steps || [],
    created_at: p.createdAt,
  };
}

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    targetAudience: r.target_audience,
    tone: r.tone,
    targetWordCount: r.target_word_count,
    tags: r.tags || [],
    referenceUrls: r.reference_urls || [],
    guidelineProfileId: r.guideline_profile_id ?? null,
    model: r.model ?? null,
    steps: r.steps || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function sessionToRow(userId: string, tenantId: string, s: RunSession) {
  return {
    id: s.id,
    project_id: s.projectId,
    tenant_id: tenantId,
    user_id: userId,
    user_input: s.userInput || '',
    status: s.status,
    current_step_index: s.currentStepIndex,
    step_outputs: s.stepOutputs || {},
    chat_messages: s.chatMessages || [],
    research: s.research ?? null,
    qa_review: s.qaReview ?? null,
    final_blog: s.finalBlog ?? null,
    total_tokens: s.totalTokens ?? null,
    created_at: s.createdAt,
  };
}

function rowToSession(r: any): RunSession {
  return {
    id: r.id,
    projectId: r.project_id,
    userInput: r.user_input,
    status: r.status,
    currentStepIndex: r.current_step_index,
    stepOutputs: r.step_outputs || {},
    chatMessages: r.chat_messages || [],
    research: r.research ?? undefined,
    qaReview: r.qa_review ?? undefined,
    finalBlog: r.final_blog ?? undefined,
    totalTokens: r.total_tokens ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToUsage(r: any): ProjectUsageRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    date: r.date,
    timestamp: r.timestamp,
    promptTokens: r.prompt_tokens,
    candidatesTokens: r.candidates_tokens,
    totalTokens: r.total_tokens,
    estimatedCostUsd: Number(r.estimated_cost_usd),
    sessionTopic: r.session_topic ?? undefined,
    stepsCompleted: r.steps_completed ?? undefined,
  };
}

// Projects -------------------------------------------------------------------

export async function saveUserProject(userId: string, tenantId: string, project: Project): Promise<void> {
  await saveAllUserProjects(userId, tenantId, [project]);
}

export async function saveAllUserProjects(userId: string, tenantId: string, projects: Project[]): Promise<void> {
  const rows = filterUserOnlyProjects(projects).map((p) => projectToRow(userId, tenantId, p));
  if (rows.length === 0) return;
  const { error } = await supabase.from('projects').upsert(rows);
  if (error) throw error;
}

/** Loads the workspace's projects, newest first. Starter templates are never stored. */
export async function loadUserProjects(_userId: string, tenantId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToProject);
}

export async function deleteUserProject(_userId: string, tenantId: string, projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', projectId).eq('tenant_id', tenantId);
  if (error) throw error;
}

// Sessions -------------------------------------------------------------------

export async function saveUserSession(userId: string, tenantId: string, session: RunSession): Promise<void> {
  const { error } = await supabase.from('sessions').upsert(sessionToRow(userId, tenantId, session));
  if (error) throw error;
}

/** Returns the most recent session per project, keyed by projectId. */
export async function loadUserSessions(_userId: string, tenantId: string): Promise<Record<string, RunSession>> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: true });
  if (error) throw error;

  const byProject: Record<string, RunSession> = {};
  for (const row of data || []) {
    const s = rowToSession(row);
    byProject[s.projectId] = s;
  }
  return byProject;
}

// Usage ----------------------------------------------------------------------

export async function saveUserUsageRecord(userId: string, tenantId: string, record: ProjectUsageRecord): Promise<void> {
  const { error } = await supabase.from('usage_records').upsert(
    {
      id: record.id,
      tenant_id: tenantId,
      user_id: userId,
      project_id: record.projectId,
      project_name: record.projectName,
      date: record.date,
      timestamp: record.timestamp,
      prompt_tokens: record.promptTokens,
      candidates_tokens: record.candidatesTokens,
      total_tokens: record.totalTokens,
      estimated_cost_usd: record.estimatedCostUsd,
      session_topic: record.sessionTopic ?? null,
      steps_completed: record.stepsCompleted ?? null,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function loadUserUsageRecords(_userId: string, tenantId: string): Promise<ProjectUsageRecord[]> {
  const { data, error } = await supabase
    .from('usage_records')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('timestamp', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map(rowToUsage);
}

// Preferences ----------------------------------------------------------------

export async function saveUserPreferences(userId: string, prefs: UserPreferences): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ preferences: { ...prefs, updatedAt: new Date().toISOString() } })
    .eq('id', userId);
  if (error) console.warn('Could not save user preferences:', error.message);
}

export async function loadUserPreferences(userId: string): Promise<UserPreferences | null> {
  const { data, error } = await supabase.from('profiles').select('preferences').eq('id', userId).single();
  if (error) {
    console.warn('Could not load user preferences:', error.message);
    return null;
  }
  return (data?.preferences as UserPreferences) || null;
}
