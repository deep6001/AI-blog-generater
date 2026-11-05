import React, { useState } from 'react';
import { GuidelineProfile, Project, QaReview, RunSession } from '../types/pipeline';
import { useAuth } from '../context/AuthContext';
import { requestQaReview, saveQaReview } from '../services/guidelines';
import { createDefaultGuidelineProfile } from '../utils/guidelines';
import { calculateGeminiCost, recordProjectRunUsage } from '../utils/pipeline';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AlertCircle, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { modelName } from '../services/models';

interface QaReviewPanelProps {
  project: Project;
  session: RunSession;
  article: string;
  guidelines: GuidelineProfile | null;
  model: string | null;
  onUpdateSession: (session: RunSession) => void;
}

const BUILT_IN: GuidelineProfile = {
  ...createDefaultGuidelineProfile('Built-in UK medical defaults'),
  id: '',
  createdAt: '',
  updatedAt: '',
};

const verdictStyle: Record<string, string> = {
  'Ready to Publish': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  'Ready to Publish After Minor Changes':
    'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  'Requires Substantial Revision':
    'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  'Not Ready to Publish Yet': 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800',
};

/** The VERDICT/SCORE lines are for parsing; the badges above show them. */
function reviewBody(review: string): string {
  return review.replace(/^\s*(VERDICT|SCORE|SCORE_AFTER):.*$/gim, '').trim();
}

export const QaReviewPanel: React.FC<QaReviewPanelProps> = ({ project, session, article, guidelines, model, onUpdateSession }) => {
  const { user, currentTenant } = useAuth();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = guidelines || BUILT_IN;
  const qa: QaReview | undefined = session.qaReview;

  const handleRun = async () => {
    if (!article.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const sourceUrls = session.research?.sources.map((s) => s.url) || [];
      const result = await requestQaReview(article, profile, sourceUrls, model);

      if (result.tokenUsage) {
        const { promptTokens, candidatesTokens, totalTokens } = result.tokenUsage;
        recordProjectRunUsage({
          projectId: project.id,
          projectName: project.name,
          date: new Date().toISOString().slice(0, 10),
          timestamp: new Date().toISOString(),
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUsd: calculateGeminiCost(promptTokens, candidatesTokens),
          sessionTopic: `QA: ${session.userInput}`,
        });
      }

      const { model: _model, ...review } = result;
      onUpdateSession({ ...session, qaReview: review, updatedAt: new Date().toISOString() });

      if (user && currentTenant) {
        saveQaReview({
          tenantId: currentTenant.id,
          userId: user.uid,
          projectId: project.id,
          sessionId: session.id,
          profileId: guidelines?.id || '',
          article,
          result,
        }).catch((err) => console.warn('Could not save QA review:', err?.message || err));
      }
    } catch (err: any) {
      setError(err.message || 'QA review failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">QA and Reference Review</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {guidelines
                ? `Checked against the "${guidelines.name}" guidelines with ${modelName(model) || 'the default model'}, references verified on the web.`
                : 'No client profile on this project, so the built-in UK medical rules are used. Set one in project settings.'}
            </p>
          </div>
        </div>
        <button
          disabled={running || !article.trim()}
          onClick={handleRun}
          className="shrink-0 text-xs font-semibold px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-2 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>{running ? 'Reviewing (can take 1 to 2 minutes)...' : qa ? 'Re-run QA review' : 'Run QA review'}</span>
        </button>
      </div>

      {error && (
        <div className="m-5 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {qa && (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`px-3 py-1.5 rounded-xl border font-bold ${
                (qa.verdict && verdictStyle[qa.verdict]) || 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {qa.verdict || 'Verdict not stated'}
            </span>
            {qa.score !== undefined && (
              <span className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-slate-800 dark:text-slate-200">
                Score {qa.score}/{qa.scoreScale}
                {qa.scoreAfter !== undefined && ` (after corrections ${qa.scoreAfter}/${qa.scoreScale})`}
              </span>
            )}
            <span className="text-slate-400">
              {qa.profileName} · {new Date(qa.createdAt).toLocaleString('en-GB')}
            </span>
          </div>
          <div className="prose prose-slate dark:prose-invert max-w-none text-sm">
            <MarkdownRenderer content={reviewBody(qa.review)} />
          </div>
        </div>
      )}
    </div>
  );
};
