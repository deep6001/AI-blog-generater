import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { LayoutReport } from '../types/pipeline';

/** Result of the automatic template and word-range check on the delivered article. */
export const LayoutReportPanel: React.FC<{ report: LayoutReport }> = ({ report }) => {
  if (report.error) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300 flex gap-2">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>The template check could not run ({report.error}). The article was kept as written; re-run this step to try again.</span>
      </div>
    );
  }

  const [min, max] = report.range;
  const inRange = report.wordCount >= min && report.wordCount <= max;
  const ok = report.issues.length === 0;
  const fixed = report.initialIssues.length - report.issues.length;

  return (
    <div
      className={`mb-4 p-3 rounded-lg border text-[11px] space-y-1.5 ${
        ok
          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
          : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
      }`}
    >
      <p className="font-semibold flex items-center gap-1.5">
        {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
        {ok ? (report.builtFromSample ? "Built on the sample's layout" : 'Matches the template') : `${report.issues.length} template difference${report.issues.length === 1 ? '' : 's'} remain`}
        <span className="font-normal">
          · {report.wordCount.toLocaleString('en-GB')} words {inRange ? 'within' : 'outside'} the {min.toLocaleString('en-GB')}–
          {max.toLocaleString('en-GB')} range (excluding references)
          {report.passes > 0 && ` · ${fixed > 0 ? `${fixed} fixed` : 'checked'} in ${report.passes} correction pass${report.passes === 1 ? '' : 'es'}`}
        </span>
      </p>
      {!ok && (
        <ul className="list-disc pl-5 space-y-0.5">
          {report.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
