export interface PipelineStep {
  id: string;
  title: string;
  promptTemplate: string;
  description?: string;
  systemRole?: string;
  temperature?: number;
  isEnabled?: boolean;
  isFinalBlogStep?: boolean;
  /** "provider:model" override for this step; empty uses the project model. */
  model?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  targetAudience: string;
  tone: string;
  targetWordCount: number;
  tags: string[];
  /** Example articles whose structure and voice the research step should study. */
  referenceUrls?: string[];
  /** Client guideline profile applied to every step and to the QA review. */
  guidelineProfileId?: string | null;
  /** "provider:model" for every step unless a step overrides it; empty uses the server default. */
  model?: string | null;
  createdAt: string;
  updatedAt: string;
  steps: PipelineStep[];
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface StepOutputRecord {
  stepId: string;
  stepTitle: string;
  promptSent: string;
  output: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  startedAt?: string;
  completedAt?: string;
  tokenUsage?: TokenUsage;
  /** Links in the output that were not among the research sources (possible invented references). */
  unverifiedUrls?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  stepId?: string;
}

export interface ResearchSource {
  /** 1-based number used for [n] citation markers in the brief. */
  id: number;
  title: string;
  url: string;
  domain: string;
}

export interface ResearchPack {
  id?: string;
  topic: string;
  brief: string;
  styleNotes?: string;
  sources: ResearchSource[];
  searchQueries: string[];
  createdAt: string;
  tokenUsage?: TokenUsage;
}

export type ReferenceStyle = 'harvard_short' | 'harvard_full';

export interface GuidelineProfile {
  id: string;
  name: string;
  writingRules: string;
  referenceRules: string;
  qaChecklist: string;
  scoreScale: 10 | 100;
  referenceStyle: ReferenceStyle;
  referenceCount: number;
  /** e.g. "2 MDPI, 2 PMC, 2 PubMed, 2 ScienceDirect" for replacement reference options. */
  referenceMix: string;
  allowedDomains: string[];
  minWordCount: number;
  cta: string;
  internalLinks: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicationVerdict =
  | 'Ready to Publish'
  | 'Ready to Publish After Minor Changes'
  | 'Requires Substantial Revision'
  | 'Not Ready to Publish Yet';

export interface QaReview {
  id?: string;
  review: string;
  verdict?: PublicationVerdict;
  score?: number;
  scoreAfter?: number;
  scoreScale: number;
  profileName?: string;
  createdAt: string;
  tokenUsage?: TokenUsage;
}

export interface RunSession {
  id: string;
  projectId: string;
  userInput: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentStepIndex: number;
  stepOutputs: Record<string, StepOutputRecord>;
  finalBlog?: string;
  research?: ResearchPack;
  qaReview?: QaReview;
  chatMessages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  totalTokens?: TokenUsage;
}

export interface ProjectUsageRecord {
  id: string;
  projectId: string;
  projectName: string;
  date: string; // YYYY-MM-DD
  timestamp: string; // ISO string
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionTopic?: string;
  stepsCompleted?: number;
}

