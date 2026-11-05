import React from 'react';
import { ModelCatalog, modelName } from '../services/models';
import { ModelSelect } from './ModelSelect';
import { Project, PipelineStep } from '../types/pipeline';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Play,
  Copy,
  ArrowLeft,
  Home,
  AlertTriangle,
} from 'lucide-react';

/** A pasted guideline/checklist document: the model would reply to it instead of doing a step. */
export function looksLikeGuidelineDocument(prompt: string): boolean {
  const head = prompt.slice(0, 400);
  return prompt.length > 8000 || (prompt.length > 3000 && /(guideline|instruction|checklist|consolidated list|here is the)/i.test(head));
}

interface PipelineBuilderProps {
  project: Project;
  modelCatalog: ModelCatalog;
  onUpdateProject: (updated: Project) => void;
  onLaunchStudio: () => void;
  onBackToProjects?: () => void;
}

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({
  project,
  modelCatalog,
  onUpdateProject,
  onLaunchStudio,
  onBackToProjects,
}) => {
  const projectModel = project.model || modelCatalog.defaultModel;

  const handleUpdateStepModel = (stepId: string, model: string | null) => {
    onUpdateProject({
      ...project,
      steps: project.steps.map((s) => (s.id === stepId ? { ...s, model } : s)),
      updatedAt: new Date().toISOString(),
    });
  };

  // Move step up or down
  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...project.steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;

    const temp = newSteps[index];
    newSteps[index] = newSteps[targetIndex];
    newSteps[targetIndex] = temp;

    onUpdateProject({
      ...project,
      steps: newSteps,
      updatedAt: new Date().toISOString(),
    });
  };

  // Update prompt directly for a step
  const handleUpdateStepPrompt = (stepId: string, newPrompt: string) => {
    const newSteps = project.steps.map((s) =>
      s.id === stepId ? { ...s, promptTemplate: newPrompt } : s
    );
    onUpdateProject({
      ...project,
      steps: newSteps,
      updatedAt: new Date().toISOString(),
    });
  };

  // Update title for a step
  const handleUpdateStepTitle = (stepId: string, newTitle: string) => {
    const newSteps = project.steps.map((s) =>
      s.id === stepId ? { ...s, title: newTitle } : s
    );
    onUpdateProject({
      ...project,
      steps: newSteps,
      updatedAt: new Date().toISOString(),
    });
  };

  // Delete a step
  const handleDeleteStep = (stepId: string) => {
    if (project.steps.length <= 1) {
      alert('You need at least one step in the project.');
      return;
    }
    const newSteps = project.steps.filter((s) => s.id !== stepId);
    onUpdateProject({
      ...project,
      steps: newSteps,
      updatedAt: new Date().toISOString(),
    });
  };

  // Duplicate a step
  const handleDuplicateStep = (step: PipelineStep, index: number) => {
    const duplicated: PipelineStep = {
      ...step,
      id: `step-${Date.now()}`,
      title: `${step.title} (Copy)`,
    };
    const newSteps = [...project.steps];
    newSteps.splice(index + 1, 0, duplicated);
    onUpdateProject({
      ...project,
      steps: newSteps,
      updatedAt: new Date().toISOString(),
    });
  };

  // Add a brand new step
  const handleAddStep = () => {
    const stepNumber = project.steps.length + 1;
    const newStep: PipelineStep = {
      id: `step-${Date.now()}`,
      title: `Step ${stepNumber}`,
      promptTemplate: `Analyze the input and continue building the blog post.`,
      isEnabled: true,
    };

    onUpdateProject({
      ...project,
      steps: [...project.steps, newStep],
      updatedAt: new Date().toISOString(),
    });
  };

  // Insert helper tag into step prompt
  const handleInsertTag = (stepId: string, tag: string) => {
    const step = project.steps.find((s) => s.id === stepId);
    if (!step) return;
    const updated = step.promptTemplate ? `${step.promptTemplate} ${tag}` : tag;
    handleUpdateStepPrompt(stepId, updated);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Simple Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          {onBackToProjects && (
            <button
              onClick={onBackToProjects}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline mb-2 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All projects</span>
            </button>
          )}
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Process Steps for: {project.name}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Write what the AI should do in each step. The output passes automatically to the next step to create your final blog.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleAddStep}
            className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 rounded-xl transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 text-indigo-500" />
            <span>Add Step</span>
          </button>

          <button
            onClick={onLaunchStudio}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl shadow-sm shadow-indigo-600/30 flex items-center gap-2 transition-all hover:shadow active:scale-[0.98]"
          >
            <Play className="w-4 h-4" />
            <span>Start Chat & Generate</span>
          </button>
        </div>
      </div>

      {/* Clean, Simple Steps List */}
      <div className="space-y-4">
        {project.steps.map((step, index) => {
          const isFirst = index === 0;
          const isLast = index === project.steps.length - 1;
          // Same rule the studio uses: the flagged step, otherwise the last one.
          const finalStepId = (project.steps.find((s) => s.isFinalBlogStep) || project.steps[project.steps.length - 1])?.id;
          const isFinal = step.id === finalStepId;
          const finalNotLast = isFinal && !isLast;
          const guidelineDoc = looksLikeGuidelineDocument(step.promptTemplate);

          return (
            <div
              key={step.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden transition-all hover:border-slate-300 dark:hover:border-slate-700"
            >
              {/* Step Top Bar: Step Number, Title, Actions */}
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>

                  <input
                    type="text"
                    value={step.title}
                    onChange={(e) => handleUpdateStepTitle(step.id, e.target.value)}
                    placeholder={`Step ${index + 1} Name`}
                    className="flex-1 min-w-0 font-medium text-sm text-slate-900 dark:text-slate-100 bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-slate-500 focus:outline-none px-1 py-0.5 truncate"
                  />

                  {isFinal && (
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      Delivers Final Blog
                    </span>
                  )}
                </div>

                {/* Simple Actions: Move Up / Down, Duplicate, Delete */}
                <div className="flex items-center space-x-1 shrink-0 text-slate-400">
                  <button
                    disabled={isFirst}
                    onClick={() => handleMoveStep(index, 'up')}
                    title="Move Up"
                    className={`p-1.5 rounded-lg transition-colors ${
                      isFirst
                        ? 'text-slate-200 dark:text-slate-800 cursor-not-allowed'
                        : 'hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>

                  <button
                    disabled={isLast}
                    onClick={() => handleMoveStep(index, 'down')}
                    title="Move Down"
                    className={`p-1.5 rounded-lg transition-colors ${
                      isLast
                        ? 'text-slate-200 dark:text-slate-800 cursor-not-allowed'
                        : 'hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDuplicateStep(step, index)}
                    title="Duplicate Step"
                    className="p-1.5 rounded-lg hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  {project.steps.length > 1 && (
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      title="Delete Step"
                      className="p-1.5 rounded-lg hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Direct Prompt Box */}
              <div className="p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 pb-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Model</span>
                  <ModelSelect
                    catalog={modelCatalog}
                    value={step.model}
                    onChange={(m) => handleUpdateStepModel(step.id, m)}
                    inheritLabel={projectModel ? `Project model (${modelName(projectModel)})` : 'Project model'}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Write Prompt for this Step:
                  </label>

                  {/* Optional helper tags */}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-400 text-[10px]">Insert:</span>
                    <button
                      type="button"
                      onClick={() => handleInsertTag(step.id, '{{input}}')}
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700 font-mono text-[10px]"
                    >
                      + {"{{input}}"}
                    </button>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => handleInsertTag(step.id, '{{previous_step}}')}
                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700 font-mono text-[10px]"
                      >
                        + {"{{previous_step}}"}
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={step.promptTemplate}
                  onChange={(e) => handleUpdateStepPrompt(step.id, e.target.value)}
                  placeholder="e.g. Analyze the user's topic and generate 3 compelling hooks and an outline for the blog post."
                  className="w-full text-xs font-medium px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 leading-relaxed resize-y"
                />

                {guidelineDoc && (
                  <div className="flex gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>
                      This looks like a guideline document, not a step instruction. The AI will reply to it ("Understood…")
                      instead of working on your blog. Move it to <strong>Project settings → Client Guidelines</strong>, which applies
                      it to every step and the QA review, and delete this step.
                    </p>
                  </div>
                )}

                {finalNotLast && (
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 min-w-0">
                      The Final blog page shows this step's output, but {project.steps.length - index - 1} step(s) run after it.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProject({
                          ...project,
                          steps: project.steps.map((s, i) => ({ ...s, isFinalBlogStep: i === project.steps.length - 1 })),
                          updatedAt: new Date().toISOString(),
                        })
                      }
                      className="font-semibold underline underline-offset-2"
                    >
                      Use the last step as the final blog
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Step Button Card */}
        <button
          onClick={handleAddStep}
          className="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600/70 rounded-2xl text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center gap-2 transition-all bg-white/40 dark:bg-slate-900/30"
        >
          <Plus className="w-4 h-4" />
          <span>Add Another Step</span>
        </button>
      </div>
    </div>
  );
};
