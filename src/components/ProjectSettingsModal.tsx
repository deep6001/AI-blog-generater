import React, { useState, useEffect } from 'react';
import { Project, GuidelineProfile } from '../types/pipeline';
import { Settings2, Save, X, BookMarked, FileText, Loader2, Upload } from 'lucide-react';
import { ModelCatalog } from '../services/models';
import { analyseSampleDocx } from '../services/guidelines';

interface ProjectSettingsModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: Project) => void;
  guidelineProfiles: GuidelineProfile[];
  modelCatalog: ModelCatalog;
  canManageGuidelines: boolean;
  onManageGuidelines: () => void;
}

// Hooks live in the form so they run on every render; the wrapper only decides whether to show it.
export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = (props) =>
  props.isOpen && props.project ? <ProjectSettingsForm key={props.project.id} {...props} project={props.project} /> : null;

const ProjectSettingsForm: React.FC<ProjectSettingsModalProps & { project: Project }> = ({
  project,
  onClose,
  onSave,
  guidelineProfiles,
  modelCatalog,
  canManageGuidelines,
  onManageGuidelines,
}) => {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [targetAudience, setTargetAudience] = useState(project.targetAudience);
  const [tone, setTone] = useState(project.tone);
  const [targetWordCount, setTargetWordCount] = useState(project.targetWordCount);
  const [referenceUrls, setReferenceUrls] = useState((project.referenceUrls || []).join('\n'));
  const [approvedSources, setApprovedSources] = useState((project.approvedSources || []).join('\n'));
  // This project's own sample article (overrides the profile's sample for this project only).
  const [sample, setSample] = useState({
    name: project.sampleName ?? null,
    outline: project.sampleOutline ?? null,
    wordCount: project.sampleWordCount ?? null,
    style: project.sampleStyle ?? null,
  });
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const profileSample = guidelineProfiles.find((g) => g.id === guidelineProfileId)?.sampleName || null;

  const handleSampleFile = async (file: File | undefined) => {
    if (!file) return;
    setSampleError(null);
    if (!/\.docx$/i.test(file.name)) {
      setSampleError('Choose a Word .docx file.');
      return;
    }
    setSampleBusy(true);
    try {
      const summary = await analyseSampleDocx(file);
      setSample({ name: file.name, outline: summary.outline, wordCount: summary.wordCount, style: summary.style });
    } catch (err: any) {
      setSampleError(err.message || 'Could not read the sample.');
    } finally {
      setSampleBusy(false);
    }
  };
  const [guidelineProfileId, setGuidelineProfileId] = useState(project.guidelineProfileId || '');

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description);
      setTargetAudience(project.targetAudience);
      setTone(project.tone);
      setTargetWordCount(project.targetWordCount);
      setReferenceUrls((project.referenceUrls || []).join('\n'));
      setApprovedSources((project.approvedSources || []).join('\n'));
      setGuidelineProfileId(project.guidelineProfileId || '');
    }
  }, [project]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...project,
      name: name.trim() || project.name,
      description: description.trim(),
      targetAudience: targetAudience.trim(),
      tone: tone.trim(),
      targetWordCount: Number(targetWordCount) || 1200,
      referenceUrls: referenceUrls
        .split(/\s+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\/\S+$/i.test(u)),
      sampleName: sample.outline ? sample.name : null,
      sampleOutline: sample.outline,
      sampleWordCount: sample.outline ? sample.wordCount : null,
      sampleStyle: sample.outline ? sample.style : null,
      approvedSources: [
        ...new Set(
          approvedSources
            .split(/[\s,]+/)
            .map((u) => u.trim().replace(/\/+$/, ''))
            .filter((u) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u))
        ),
      ],
      guidelineProfileId: guidelineProfileId || null,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
      <div className="my-auto bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              Project Settings
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-semibold"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Project Title
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target Audience
              </label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tone of Voice
              </label>
              <input
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Target Word Count (~{targetWordCount} words)
            </label>
            <input
              type="range"
              min="500"
              max="4000"
              step="100"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-600"
            />
          </div>


          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Client Guidelines
            </label>
            <div className="flex gap-2">
              <select
                value={guidelineProfileId}
                onChange={(e) => setGuidelineProfileId(e.target.value)}
                className="flex-1 text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
              >
                <option value="">None (pipeline prompts only)</option>
                {guidelineProfiles.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              {canManageGuidelines && (
                <button
                  type="button"
                  onClick={onManageGuidelines}
                  className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <BookMarked className="w-3.5 h-3.5" />
                  <span>Manage</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              The client's writing, reference and QA rules are added to every step and used for the QA review.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Sample Article for This Project
            </label>
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-700 dark:text-slate-200 flex-1 min-w-0 break-all">
                {sample.outline
                  ? `${sample.name || 'Sample'} (this project only${sample.wordCount ? `, ~${sample.wordCount} words` : ''})`
                  : profileSample
                    ? `Using the client profile's sample: ${profileSample}`
                    : 'No sample. Articles follow the written rules only.'}
              </span>
              <label className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 cursor-pointer inline-flex items-center gap-1.5">
                {sampleBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{sample.outline ? 'Replace' : 'Upload .docx'}</span>
                <input
                  type="file"
                  accept=".docx"
                  className="hidden"
                  disabled={sampleBusy}
                  onChange={(e) => {
                    handleSampleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {sample.outline && (
                <button
                  type="button"
                  onClick={() => setSample({ name: null, outline: null, wordCount: null, style: null })}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  Remove
                </button>
              )}
            </div>
            {sampleError && <p className="text-[11px] text-rose-600 mt-1">{sampleError}</p>}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Articles in this project copy this sample's layout. It does not change other projects, even ones using the same client
              profile. Remove it to go back to the profile's sample.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Approved Reference Sources
            </label>
            <textarea
              rows={4}
              value={approvedSources}
              onChange={(e) => setApprovedSources(e.target.value)}
              placeholder={'nhs.uk\npubmed.ncbi.nlm.nih.gov\nhttps://www.bad.org.uk/patient-information-leaflets\nOne site or page per line'}
              className="w-full text-xs font-mono px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              The client's accepted sources. Research can read any website, but the References list only uses pages from these
              sites (or under these page addresses) that were opened and checked to cover the topic. Leave empty to allow any
              research source.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Reference Articles
            </label>
            <textarea
              rows={3}
              value={referenceUrls}
              onChange={(e) => setReferenceUrls(e.target.value)}
              placeholder={'https://www.example.com/blog/well-written-article\nOne URL per line'}
              className="w-full text-xs font-mono px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Human-written posts whose structure and voice you want to match. They are read during web research; their text is never copied.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-semibold px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
