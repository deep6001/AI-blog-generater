import React, { useState, useEffect } from 'react';
import { Project, GuidelineProfile } from '../types/pipeline';
import { Settings2, Save, X, BookMarked } from 'lucide-react';
import { ModelCatalog, modelName } from '../services/models';
import { ModelSelect } from './ModelSelect';

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
  const [guidelineProfileId, setGuidelineProfileId] = useState(project.guidelineProfileId || '');
  const [model, setModel] = useState<string | null>(project.model || null);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description);
      setTargetAudience(project.targetAudience);
      setTone(project.tone);
      setTargetWordCount(project.targetWordCount);
      setReferenceUrls((project.referenceUrls || []).join('\n'));
      setGuidelineProfileId(project.guidelineProfileId || '');
      setModel(project.model || null);
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
      guidelineProfileId: guidelineProfileId || null,
      model,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-6">
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
              AI Model
            </label>
            <ModelSelect
              catalog={modelCatalog}
              value={model}
              onChange={setModel}
              inheritLabel={
                modelCatalog.defaultModel ? `Server default (${modelName(modelCatalog.defaultModel)})` : 'Server default'
              }
              className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Used for research, every step and the QA review. Individual steps can override it.
            </p>
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
