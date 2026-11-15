import React from 'react';
import { Project } from '../types/pipeline';
import {
  Layers,
  Sparkles,
  Trash2,
  Copy,
  Settings2,
  Plus,
  PlayCircle,
} from 'lucide-react';

interface ProjectListProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onOpenStudio: (id: string) => void;
  onNewProject: () => void;
  onDuplicateProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
  onEditSettings: (project: Project) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onSelectProject,
  onOpenStudio,
  onNewProject,
  onDuplicateProject,
  onDeleteProject,
  onEditSettings,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Intro */}
      <section className="pt-6 sm:pt-10 pb-2 max-w-3xl space-y-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
          Blog pipelines
        </p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl text-slate-900 dark:text-slate-100">
          Research, write and check medical blogs in clear, repeatable steps.
        </h1>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
          Each project is a chain of prompts: angle, outline, draft, review and final polish. Every step can use web
          research and your client's guidelines, and the finished article gets a QA and reference check.
        </p>
        <div className="pt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium active:scale-[0.98] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New project</span>
          </button>
        </div>
      </section>

      {/* Projects Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Your Blog Generation Projects</span>
            <span className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full font-mono">
              {projects.length}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select a project to configure its process steps or launch the generation studio.
          </p>
        </div>

        <button
          onClick={onNewProject}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {/* Projects Grid or Empty State */}
      {projects.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-12 text-center flex flex-col items-center justify-center space-y-5 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
            <Layers className="w-8 h-8" />
          </div>

          <div className="max-w-md space-y-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              No Projects Yet
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              You haven't created any blog generation pipelines yet. Click below to create your first custom project with customizable prompt steps.
            </p>
          </div>

          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium active:scale-[0.98] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group relative flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all overflow-hidden"
            >
              <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                <div>
                  {/* Header & Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-serif text-xl text-slate-900 dark:text-slate-100 line-clamp-1">
                      {project.name}
                    </h3>
                    <div className="flex items-center space-x-1 shrink-0 text-slate-400">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditSettings(project);
                        }}
                        title="Project Settings"
                        className="p-1.5 rounded-lg hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateProject(project);
                        }}
                        title="Duplicate Project"
                        className="p-1.5 rounded-lg hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Are you sure you want to delete "${project.name}"?`)) {
                            onDeleteProject(project.id);
                          }
                        }}
                        title="Delete Project"
                        className="p-1.5 rounded-lg hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    {project.steps.length} sequential prompt steps to generate your blog.
                  </p>
                </div>

                {/* Steps overview & Primary CTA */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                      <Layers className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{project.steps.length} Pipeline Steps</span>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {project.steps.filter((s) => s.isEnabled).length} active
                    </span>
                  </div>

                  {/* Step mini pill trail */}
                  <div className="flex flex-wrap gap-1">
                    {project.steps.slice(0, 4).map((step, idx) => (
                      <span
                        key={step.id}
                        className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md font-medium truncate max-w-[130px]"
                      >
                        {idx + 1}. {step.title}
                      </span>
                    ))}
                    {project.steps.length > 4 && (
                      <span className="text-[10px] text-slate-400 py-0.5 px-1 font-mono">
                        +{project.steps.length - 4} more
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      onClick={() => onSelectProject(project.id)}
                      className="w-full text-xs font-semibold py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Edit Steps</span>
                    </button>

                    <button
                      onClick={() => onOpenStudio(project.id)}
                      className="w-full text-xs font-semibold py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-sm flex items-center justify-center gap-1.5 group-hover:shadow"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Start Chat</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
