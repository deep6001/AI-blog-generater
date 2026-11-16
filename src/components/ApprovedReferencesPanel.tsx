import React from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { ResearchPack } from '../types/pipeline';

/** The references found on the client's approved sites, and why other pages were left out. */
export const ApprovedReferencesPanel: React.FC<{ research: ResearchPack; needed: number }> = ({ research, needed }) => {
  const refs = research.approvedReferences || [];
  const rejected = research.rejectedReferences || [];
  const short = refs.length < needed;

  return (
    <div className="space-y-2 text-xs">
      {(research.approvedReferencesError || short) && (
        <div className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {research.approvedReferencesError ||
              `Only ${refs.length} of the ${needed} references needed were found on the approved sites for this topic. The article will list only these. Add more approved sites in project settings to get more.`}
          </span>
        </div>
      )}

      <details className="text-xs" open={refs.length > 0 && refs.length <= 10}>
        <summary className="cursor-pointer font-semibold text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Approved references ({refs.length}) from {research.approvedSources?.length || 0} approved source
          {research.approvedSources?.length === 1 ? '' : 's'}
        </summary>
        <ol className="mt-2 space-y-2">
          {refs.map((r) => (
            <li key={r.url} className="flex gap-2">
              <span className="font-mono text-slate-400">R{r.id}</span>
              <div className="min-w-0 space-y-0.5">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-800 dark:text-slate-200 hover:text-indigo-600 break-all inline-flex gap-1"
                >
                  <span>{r.title || r.domain}</span>
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                </a>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  {r.checkedBy === 'page'
                    ? `Page opened, topic found (${r.matchedTerms.join(', ')})`
                    : r.checkedBy === 'abstract'
                      ? 'Study found on PubMed; abstract read and checked'
                      : 'Site blocks automatic reading; cited by search for this topic'}
                </div>
                {r.citation && <div className="text-[11px] text-slate-600 dark:text-slate-300">{r.citation}</div>}
              </div>
            </li>
          ))}
        </ol>
        {rejected.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-slate-500">Left out ({rejected.length})</summary>
            <ul className="mt-1.5 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              {rejected.map((r) => (
                <li key={r.url} className="break-all">
                  {r.title || r.url}: {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
    </div>
  );
};
