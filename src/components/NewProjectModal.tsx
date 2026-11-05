import React, { useState } from 'react';
import { Project } from '../types/pipeline';
import { createDefaultProjects } from '../utils/pipeline';
import { Sparkles, X, Stethoscope, FileText, PlusCircle } from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (project: Project) => void;
}

// Hooks live in the form so they run on every render; the wrapper only decides whether to show it.
export const NewProjectModal: React.FC<NewProjectModalProps> = (props) =>
  props.isOpen ? <NewProjectForm {...props} /> : null;

const NewProjectForm: React.FC<NewProjectModalProps> = ({ onClose, onCreateProject }) => {
  const [projectName, setProjectName] = useState('My Blog Project');
  const [templateType, setTemplateType] = useState<'prostate-clinic' | 'standard' | 'blank'>('standard');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    if (templateType === 'prostate-clinic') {
      const defaultPresets = createDefaultProjects();
      const clinicTemplate = defaultPresets.find((p) => p.id === 'proj-prostate-clinic-london');
      if (clinicTemplate) {
        const newProject: Project = {
          ...clinicTemplate,
          id: `proj-${Date.now()}`,
          name: projectName.trim() || clinicTemplate.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          steps: clinicTemplate.steps.map((s, idx) => ({ ...s, id: `step-${Date.now()}-${idx}` })),
        };
        onCreateProject(newProject);
        onClose();
        return;
      }
    }

    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name: projectName.trim() || 'Untitled Blog Project',
      description: 'Blog generation pipeline',
      targetAudience: 'General Readers',
      tone: 'Engaging & Clear',
      targetWordCount: 1200,
      tags: ['Blog'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps:
        templateType === 'standard'
          ? [
              {
                id: `step-${Date.now()}-1`,
                title: 'Step 1: Angles & Hook',
                promptTemplate: 'Analyze {{input}} and generate 3 compelling hooks and editorial angles for this article.',
                isEnabled: true,
              },
              {
                id: `step-${Date.now()}-2`,
                title: 'Step 2: Outline',
                promptTemplate: 'Based on the selected angle from {{previous_step}}, create a structured H2 and H3 section outline.',
                isEnabled: true,
              },
              {
                id: `step-${Date.now()}-3`,
                title: 'Step 3: Final Blog Post',
                promptTemplate: 'Write the complete, engaging blog post in Markdown format following the outline in {{previous_step}}.',
                isEnabled: true,
                isFinalBlogStep: true,
              },
            ]
          : [
              {
                id: `step-${Date.now()}-1`,
                title: 'Step 1: Custom Step',
                promptTemplate: 'Write your prompt here...',
                isEnabled: true,
                isFinalBlogStep: true,
              },
            ],
    };

    onCreateProject(newProject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/80 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Create New Pipeline Project
            </h3>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Project Name
            </label>
            <input
              type="text"
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Prostate Clinic London Guide"
              className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Choose Pipeline Template:
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setTemplateType('prostate-clinic');
                  if (projectName === 'My Blog Project' || !projectName) {
                    setProjectName('Prostate & Urology Clinical Guide');
                  }
                }}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 ${
                  templateType === 'prostate-clinic'
                    ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/40 text-teal-950 dark:text-teal-200 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="w-8 h-8 rounded-xl bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">Prostate Clinic London Clinical Guide</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-200 dark:bg-teal-800 text-teal-900 dark:text-teal-100 font-bold uppercase">
                      Recommended
                    </span>
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    5-step chain: Clinical Dilemma &rarr; Outline & Tables &rarr; Deep Draft &rarr; Red Flags & FAQs &rarr; Final Medical Delivery (strictly NO images).
                  </div>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateType('standard')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    templateType === 'standard'
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-300 font-semibold'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold mb-0.5">
                    <FileText className="w-3.5 h-3.5" />
                    <span>Standard SEO</span>
                  </div>
                  <div className="text-[10px] opacity-75">3 steps: Angles &rarr; Outline &rarr; Post</div>
                </button>

                <button
                  type="button"
                  onClick={() => setTemplateType('blank')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    templateType === 'blank'
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-300 font-semibold'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold mb-0.5">
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Blank Canvas</span>
                  </div>
                  <div className="text-[10px] opacity-75">Build your own custom prompts</div>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
