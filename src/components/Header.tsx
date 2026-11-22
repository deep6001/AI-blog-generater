import React, { useState } from 'react';
import {
  Plus,
  BookOpen,
  MessageSquare,
  LogOut,
  ChevronDown,
  Database,
  Loader2,
  RefreshCw,
  Home,
  ListOrdered,
  ShieldCheck,
} from 'lucide-react';
import { Project } from '../types/pipeline';
import { useAuth } from '../context/AuthContext';

type Tab = 'pipeline' | 'studio' | 'output' | 'settings' | 'admin';

interface HeaderProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  hasApiKey: boolean;
  onOpenTenantModal: () => void;
  onOpenAuth?: () => void;
  syncStatus?: 'synced' | 'saving' | 'error' | 'guest';
  lastSavedTime?: Date | null;
  onTriggerSync?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  activeTab,
  setActiveTab,
  hasApiKey: _hasApiKey,
  onOpenTenantModal,
  onOpenAuth,
  syncStatus = 'synced',
  lastSavedTime,
  onTriggerSync,
}) => {
  const { user, userProfile, currentTenant, logout } = useAuth();
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const currentProject = projects.find((p) => p.id === activeProjectId);

  const tabs: { key: string; label: string; icon: React.ReactNode; active: boolean; onClick: () => void }[] = [
    {
      key: 'home',
      label: 'Projects',
      icon: <Home className="w-3.5 h-3.5" />,
      active: activeProjectId === null && activeTab !== 'admin',
      onClick: () => {
        onSelectProject(null);
        if (activeTab === 'admin') setActiveTab('pipeline');
      },
    },
    ...(currentProject
      ? [
          {
            key: 'pipeline',
            label: `Steps · ${currentProject.steps.length}`,
            icon: <ListOrdered className="w-3.5 h-3.5" />,
            active: activeTab === 'pipeline',
            onClick: () => setActiveTab('pipeline'),
          },
          {
            key: 'studio',
            label: 'Studio',
            icon: <MessageSquare className="w-3.5 h-3.5" />,
            active: activeTab === 'studio',
            onClick: () => setActiveTab('studio'),
          },
          {
            key: 'output',
            label: 'Final blog',
            icon: <BookOpen className="w-3.5 h-3.5" />,
            active: activeTab === 'output',
            onClick: () => setActiveTab('output'),
          },
        ]
      : []),
    ...(userProfile?.isSuperAdmin
      ? [
          {
            key: 'admin',
            label: 'Admin',
            icon: <ShieldCheck className="w-3.5 h-3.5" />,
            active: activeTab === 'admin',
            onClick: () => setActiveTab('admin'),
          },
        ]
      : []),
  ];

  const syncDot =
    !user ? 'bg-slate-400' : syncStatus === 'saving' ? 'bg-amber-500' : syncStatus === 'error' ? 'bg-rose-500' : 'bg-emerald-500';
  const syncLabel = !user
    ? 'Guest'
    : syncStatus === 'saving'
      ? 'Saving'
      : syncStatus === 'error'
        ? 'Not saved'
        : 'Saved';

  return (
    <header className="sticky top-0 z-40 bg-slate-50/85 dark:bg-slate-950/85 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top row */}
        <div className="flex items-center justify-between gap-3 h-14">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => onSelectProject(null)}
              className="flex items-center gap-2 shrink-0 focus:outline-none"
              title="Projects"
            >
              <span className="w-7 h-7 rounded-md bg-slate-900 dark:bg-slate-100 text-slate-50 dark:text-slate-900 flex items-center justify-center font-serif text-base leading-none">
                B
              </span>
              <span className="hidden sm:inline font-serif text-lg tracking-tight text-slate-900 dark:text-slate-100">
                BlogCraft
              </span>
            </button>

            {currentProject && (
              <div className="hidden md:flex items-center gap-2 min-w-0">
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <div className="relative min-w-0">
                  <select
                    aria-label="Active project"
                    value={currentProject.id}
                    onChange={(e) => onSelectProject(e.target.value)}
                    className="appearance-none max-w-65 truncate bg-transparent text-sm font-medium text-slate-800 dark:text-slate-200 pr-6 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-700 cursor-pointer"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Save status */}
            <div className="relative">
              <button
                onClick={() => setShowSyncDetails(!showSyncDetails)}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900"
                title="Save status"
              >
                {user && syncStatus === 'saving' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-slate-500" />
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full ${syncDot}`} />
                )}
                <span className="hidden sm:inline">{syncLabel}</span>
              </button>

              {showSyncDetails && (
                <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-4 z-50 text-xs">
                  <div className="flex items-center gap-1.5 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800 font-medium text-slate-900 dark:text-slate-100">
                    <Database className="w-3.5 h-3.5 text-slate-500" />
                    {user ? 'Saved to your workspace' : 'Guest preview'}
                  </div>
                  {user ? (
                    <dl className="space-y-2 text-slate-600 dark:text-slate-400">
                      {[
                        ['Email', user.email || '-'],
                        ['Workspace', currentTenant?.name || '-'],
                        ['Last saved', lastSavedTime ? lastSavedTime.toLocaleTimeString('en-GB') : '-'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt>{k}</dt>
                          <dd className="text-slate-900 dark:text-slate-200 truncate max-w-40">{v}</dd>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          onTriggerSync?.();
                          setShowSyncDetails(false);
                        }}
                        className="w-full mt-2 flex items-center justify-center gap-1.5 h-8 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Save now
                      </button>
                    </dl>
                  ) : (
                    <>
                      <p className="text-slate-500 dark:text-slate-400">Nothing is saved while you are signed out.</p>
                      <button
                        onClick={() => {
                          setShowSyncDetails(false);
                          onOpenAuth?.();
                        }}
                        className="w-full mt-3 h-8 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        Sign in to save your work
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {user && (
              <button
                onClick={onOpenTenantModal}
                className="hidden sm:flex items-center gap-1 h-8 px-2.5 rounded-md text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 max-w-45"
                title="Switch workspace"
              >
                <span className="truncate">{currentTenant?.name || 'Workspace'}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>
            )}

            <button
              onClick={onNewProject}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium active:scale-[0.98] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New project</span>
            </button>

            {user ? (
              <div className="flex items-center gap-1 pl-1.5 sm:pl-2 sm:border-l border-slate-200 dark:border-slate-800">
                <button
                  onClick={onOpenTenantModal}
                  className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center text-xs font-medium uppercase"
                  title={`${user.displayName || user.email} · switch workspace`}
                >
                  {(user.displayName || user.email || 'U')[0]}
                </button>
                <button
                  onClick={logout}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              onOpenAuth && (
                <button
                  onClick={onOpenAuth}
                  className="h-8 px-2.5 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  Sign in
                </button>
              )
            )}
          </div>
        </div>

        {/* Tabs: scroll sideways on narrow screens instead of wrapping */}
        <nav className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none text-sm" aria-label="Sections">
          {currentProject && (
            <span className="md:hidden shrink-0 max-w-[40vw] truncate pr-2 mr-1 border-r border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100">
              {currentProject.name}
            </span>
          )}
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={t.onClick}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-2.5 h-10 border-b-2 transition-colors ${
                t.active
                  ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100 font-medium'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
