import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';

export interface RunActivity {
  label: string;
  detail: string;
  startedAt?: string;
  completed: number;
  total: number;
}

export interface RunOutcome {
  kind: 'success' | 'error';
  message: string;
  stepId?: string;
}

interface RunStatusBarProps {
  activity: RunActivity | null;
  outcome: RunOutcome | null;
  now: number;
  onDismiss: () => void;
  onShowStep: (stepId: string) => void;
}

function elapsed(startedAt: string | undefined, now: number): string {
  if (!startedAt) return '';
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Stays pinned under the header so progress is visible wherever the page is scrolled. */
export const RunStatusBar: React.FC<RunStatusBarProps> = ({ activity, outcome, now, onDismiss, onShowStep }) => {
  if (!activity && !outcome) return null;

  if (activity) {
    const pct = activity.total ? Math.round((activity.completed / activity.total) * 100) : 0;
    return (
      <div role="status" aria-live="polite" className="sticky top-[97px] z-30 -mx-1">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-md overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin text-slate-600 dark:text-slate-300 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{activity.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{activity.detail}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-mono tabular-nums text-slate-700 dark:text-slate-200">{elapsed(activity.startedAt, now)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {activity.completed} of {activity.total} done
              </p>
            </div>
          </div>
          <div className="h-1 bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-slate-900 dark:bg-slate-200 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const ok = outcome!.kind === 'success';
  return (
    <div role="status" aria-live="polite" className="sticky top-[97px] z-30 -mx-1">
      <div
        className={`rounded-xl border shadow-md flex items-center gap-3 px-4 py-3 ${
          ok
            ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-100'
            : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/90 text-rose-900 dark:text-rose-100'
        }`}
      >
        {ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
        <p className="text-sm flex-1 min-w-0 line-clamp-2">{outcome!.message}</p>
        {outcome!.stepId && (
          <button
            onClick={() => onShowStep(outcome!.stepId!)}
            className="text-xs font-medium underline underline-offset-2 shrink-0"
          >
            Show step
          </button>
        )}
        <button onClick={onDismiss} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 shrink-0" title="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
