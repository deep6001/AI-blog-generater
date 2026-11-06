import React, { useEffect, useState } from 'react';
import { GuidelineProfile } from '../types/pipeline';
import { createDefaultGuidelineProfile } from '../utils/guidelines';
import { analyseSampleDocx, createGuidelineProfile, deleteGuidelineProfile, updateGuidelineProfile } from '../services/guidelines';
import { BookMarked, Copy, FileText, Loader2, Plus, Save, Trash2, Upload, X } from 'lucide-react';

interface GuidelinesModalProps {
  isOpen: boolean;
  tenantId: string;
  profiles: GuidelineProfile[];
  onClose: () => void;
  onProfilesChanged: (profiles: GuidelineProfile[]) => void;
}

const inputClass =
  'w-full text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600';
const labelClass = 'block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1';

export const GuidelinesModal: React.FC<GuidelinesModalProps> = ({
  isOpen,
  tenantId,
  profiles,
  onClose,
  onProfilesChanged,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id ?? null);
  const [draft, setDraft] = useState<GuidelineProfile | null>(null);
  const [domainsText, setDomainsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedId || !profiles.some((p) => p.id === selectedId)) setSelectedId(profiles[0]?.id ?? null);
  }, [isOpen, profiles, selectedId]);

  useEffect(() => {
    const p = profiles.find((x) => x.id === selectedId) || null;
    setDraft(p);
    setDomainsText(p?.allowedDomains.join('\n') || '');
    setError(null);
  }, [selectedId, profiles]);

  if (!isOpen) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (source?: GuidelineProfile) =>
    run(async () => {
      const base = source
        ? { ...source, name: `${source.name} (copy)` }
        : createDefaultGuidelineProfile(profiles.length ? 'New client' : 'UK medical blog');
      const { id: _i, createdAt: _c, updatedAt: _u, ...fields } = base as GuidelineProfile;
      const created = await createGuidelineProfile(tenantId, fields);
      onProfilesChanged([...profiles, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(created.id);
    });

  const handleSave = () =>
    run(async () => {
      if (!draft) return;
      const allowedDomains = domainsText
        .split(/[\s,]+/)
        .map((d) => d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter(Boolean);
      const saved = await updateGuidelineProfile({ ...draft, allowedDomains });
      onProfilesChanged(profiles.map((p) => (p.id === saved.id ? saved : p)));
    });

  const handleDelete = () =>
    run(async () => {
      if (!draft || !confirm(`Delete the "${draft.name}" guideline profile? Projects using it will have no profile.`)) return;
      await deleteGuidelineProfile(draft.id);
      onProfilesChanged(profiles.filter((p) => p.id !== draft.id));
      setSelectedId(null);
    });

  const set = <K extends keyof GuidelineProfile>(key: K, value: GuidelineProfile[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const handleSampleFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      setError('Choose a Word .docx file.');
      return;
    }
    run(async () => {
      const summary = await analyseSampleDocx(file);
      setDraft((d) =>
        d
          ? {
              ...d,
              sampleName: file.name,
              sampleOutline: summary.outline,
              sampleWordCount: summary.wordCount,
              sampleStyle: summary.style,
            }
          : d
      );
    });
  };

  const clearSample = () =>
    setDraft((d) => (d ? { ...d, sampleName: null, sampleOutline: null, sampleWordCount: null, sampleStyle: null } : d));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-6xl h-[90vh] border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <BookMarked className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">Client Guidelines</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Writing, reference and QA rules applied to every step and to the QA review.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <aside className="md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 p-3 space-y-1 overflow-y-auto">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left text-xs font-semibold px-3 py-2 rounded-xl transition-colors ${
                  p.id === selectedId
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {p.name}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => handleCreate()}
              className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{profiles.length ? 'New profile' : 'Create UK medical default'}</span>
            </button>
          </aside>

          <div className="flex-1 overflow-y-auto p-6">
            {!draft ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Create a profile for each client (for example LDC, JFAM, LMA). New profiles start with the UK medical blog
                rules, which you can then edit.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Profile name</label>
                    <input className={inputClass} value={draft.name} onChange={(e) => set('name', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Score scale</label>
                    <select
                      className={inputClass}
                      value={draft.scoreScale}
                      onChange={(e) => set('scoreScale', Number(e.target.value) as 10 | 100)}
                    >
                      <option value={100}>Out of 100</option>
                      <option value={10}>Out of 10</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Minimum words</label>
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={draft.minWordCount}
                      onChange={(e) => set('minWordCount', Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Reference style</label>
                    <select
                      className={inputClass}
                      value={draft.referenceStyle}
                      onChange={(e) => set('referenceStyle', e.target.value as GuidelineProfile['referenceStyle'])}
                    >
                      <option value="harvard_short">Short Harvard, direct links, no DOI, no access dates</option>
                      <option value="harvard_full">Full Harvard, italic journals, volume/issue/pages, DOI</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>References per blog</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className={inputClass}
                      value={draft.referenceCount}
                      onChange={(e) => set('referenceCount', Number(e.target.value) || 5)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Replacement options mix</label>
                    <input
                      className={inputClass}
                      value={draft.referenceMix}
                      placeholder="2 MDPI, 2 PMC, 2 PubMed, 2 ScienceDirect"
                      onChange={(e) => set('referenceMix', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div>
                    <label className={labelClass}>Allowed reference domains (blank = any credible)</label>
                    <textarea
                      rows={4}
                      className={`${inputClass} font-mono`}
                      value={domainsText}
                      placeholder={'nice.org.uk\nnhs.uk\npubmed.ncbi.nlm.nih.gov'}
                      onChange={(e) => setDomainsText(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Call to action</label>
                    <textarea
                      rows={4}
                      className={inputClass}
                      value={draft.cta}
                      placeholder="Book a consultation with ... on 020 ..."
                      onChange={(e) => set('cta', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Required internal links (anchor text and URL per line)</label>
                    <textarea
                      rows={4}
                      className={`${inputClass} font-mono`}
                      value={draft.internalLinks}
                      placeholder="colposcopy in London | https://example.co.uk/colposcopy"
                      onChange={(e) => set('internalLinks', e.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        Sample article template (.docx)
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        An approved article whose layout every blog should follow. Only its structure and styling are used,
                        never its wording. Save the profile after uploading.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{draft.sampleOutline ? 'Replace sample' : 'Upload sample'}</span>
                        <input
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => {
                            handleSampleFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {draft.sampleOutline && (
                        <button
                          type="button"
                          onClick={clearSample}
                          className="text-xs font-semibold px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {draft.sampleOutline && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-700 dark:text-slate-300">
                        <strong>{draft.sampleName}</strong> · about {draft.sampleWordCount} words
                        {draft.sampleStyle &&
                          ` · ${draft.sampleStyle.font} ${draft.sampleStyle.bodySize}pt, headings ${draft.sampleStyle.h1Size}/${draft.sampleStyle.h2Size}pt, ${draft.sampleStyle.marginMm} mm margins`}
                        {' '}(show the layout the AI will follow)
                      </summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 dark:bg-slate-950 p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {draft.sampleOutline}
                      </pre>
                    </details>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Writing rules</label>
                  <textarea
                    rows={12}
                    className={`${inputClass} font-mono leading-relaxed`}
                    value={draft.writingRules}
                    onChange={(e) => set('writingRules', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Reference rules</label>
                  <textarea
                    rows={8}
                    className={`${inputClass} font-mono leading-relaxed`}
                    value={draft.referenceRules}
                    onChange={(e) => set('referenceRules', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>QA checklist (checked before every verdict)</label>
                  <textarea
                    rows={10}
                    className={`${inputClass} font-mono leading-relaxed`}
                    value={draft.qaChecklist}
                    onChange={(e) => set('qaChecklist', e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {draft && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <button
                disabled={busy}
                onClick={handleDelete}
                className="text-xs font-semibold px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                disabled={busy}
                onClick={() => handleCreate(draft)}
                className="text-xs font-semibold px-3 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Duplicate</span>
              </button>
            </div>
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-rose-600">{error}</span>}
              <button
                disabled={busy}
                onClick={handleSave}
                className="text-xs font-semibold px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save profile</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
