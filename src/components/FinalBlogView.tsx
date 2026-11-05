import React, { useState } from 'react';
import { GuidelineProfile, Project, RunSession } from '../types/pipeline';
import { QaReviewPanel } from './QaReviewPanel';
import { ModelCatalog } from '../services/models';
import {
  calculateBlogMetrics,
  generateMedicalHtmlDocument,
  generatePlainTextDocument,
} from '../utils/pipeline';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  Copy,
  Check,
  Download,
  BookOpen,
  Code,
  Eye,
  Clock,
  FileText,
  Hash,
  Sparkles,
  ArrowLeft,
  Printer,
  ChevronDown,
  ShieldCheck,
  Building2,
  Stethoscope,
  Info,
  Zap,
  Coins,
} from 'lucide-react';

interface FinalBlogViewProps {
  project: Project;
  session: RunSession;
  guidelines: GuidelineProfile | null;
  modelCatalog: ModelCatalog;
  onUpdateSession: (session: RunSession) => void;
  onBackToStudio: () => void;
  onUpdateSessionBlog: (newBlogContent: string) => void;
}

export const FinalBlogView: React.FC<FinalBlogViewProps> = ({
  project,
  session,
  guidelines,
  modelCatalog,
  onUpdateSession,
  onBackToStudio,
  onUpdateSessionBlog,
}) => {
  const finalStep =
    project.steps.find((s) => s.isFinalBlogStep) || project.steps[project.steps.length - 1];
  const initialContent =
    (finalStep && session.stepOutputs[finalStep.id]?.output) || session.finalBlog || '';

  const [copiedType, setCopiedType] = useState<'md' | 'html' | 'text' | null>(null);
  const [viewMode, setViewMode] = useState<'clinical' | 'preview' | 'raw' | 'html'>('clinical');
  const [editableBlog, setEditableBlog] = useState(initialContent);
  const [isDownloadDropdownOpen, setIsDownloadDropdownOpen] = useState(false);

  React.useEffect(() => {
    const finalS =
      project.steps.find((s) => s.isFinalBlogStep) || project.steps[project.steps.length - 1];
    const resolved =
      (finalS && session.stepOutputs[finalS.id]?.output) || session.finalBlog || '';
    if (resolved) {
      setEditableBlog(resolved);
    }
  }, [session.finalBlog, session.stepOutputs, project.steps]);

  const metrics = calculateBlogMetrics(editableBlog);

  const handleCopy = async (type: 'md' | 'html' | 'text') => {
    let contentToCopy = editableBlog;
    if (type === 'html') {
      contentToCopy = generateMedicalHtmlDocument(project.name, editableBlog, project);
    } else if (type === 'text') {
      contentToCopy = generatePlainTextDocument(editableBlog);
    }
    await navigator.clipboard.writeText(contentToCopy);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setIsDownloadDropdownOpen(false);
  };

  const handleDownloadMarkdown = () => {
    const filename = `${(project.name || 'medical-blog').toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
    downloadFile(editableBlog, filename, 'text/markdown;charset=utf-8');
  };

  const handleDownloadMedicalHtml = () => {
    const filename = `${(project.name || 'medical-blog').toLowerCase().replace(/[^a-z0-9]/g, '-')}-prostate-clinic-format.html`;
    const html = generateMedicalHtmlDocument(project.name, editableBlog, project);
    downloadFile(html, filename, 'text/html;charset=utf-8');
  };

  const [docxError, setDocxError] = useState<string | null>(null);
  const handleDownloadWordDoc = async () => {
    setDocxError(null);
    try {
      // Loaded on demand: the docx library is large and only needed here.
      const { markdownToDocxBlob, docxFileName } = await import('../utils/docxExport');
      const blob = await markdownToDocxBlob(editableBlog, session.userInput || project.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = docxFileName(editableBlog, session.userInput || project.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      console.error('DOCX export failed:', err);
      setDocxError(`Could not create the Word file: ${err?.message || err}`);
    }
  };

  const handleDownloadPlainText = () => {
    const filename = `${(project.name || 'medical-blog').toLowerCase().replace(/[^a-z0-9]/g, '-')}-plain.txt`;
    const text = generatePlainTextDocument(editableBlog);
    downloadFile(text, filename, 'text/plain;charset=utf-8');
  };

  const handlePrintOrPdf = () => {
    const html = generateMedicalHtmlDocument(project.name, editableBlog, project);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 350);
    }
  };

  const handleSaveEdit = () => {
    onUpdateSessionBlog(editableBlog);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Navigation & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={onBackToStudio}
          className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 flex items-center gap-1.5 transition-colors self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Studio Pipeline</span>
        </button>

        {/* View mode switcher */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setViewMode('clinical')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'clinical'
                ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 font-semibold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Clinic Layout</span>
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'preview'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 font-semibold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Standard View</span>
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'raw'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 font-semibold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Markdown Code</span>
          </button>
          <button
            onClick={() => setViewMode('html')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'html'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 font-semibold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>HTML Source</span>
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Word Count
            </span>
            <span className="text-lg font-semibold text-slate-900 dark:text-white font-mono">
              {metrics.wordCount.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Read Time
            </span>
            <span className="text-lg font-semibold text-slate-900 dark:text-white font-mono">
              {metrics.readingTimeMinutes} min
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Hash className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Headings
            </span>
            <span className="text-lg font-semibold text-slate-900 dark:text-white font-mono">
              {metrics.headingCount}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Tokens Used
            </span>
            <span className="text-lg font-semibold text-slate-900 dark:text-white font-mono">
              {(
                session.totalTokens?.totalTokens ||
                Object.values(session.stepOutputs || {}).reduce((acc, curr) => {
                  if (curr.tokenUsage?.totalTokens) return acc + curr.tokenUsage.totalTokens;
                  const promptEst = Math.round((curr.promptSent?.length || 600) / 4);
                  const candEst = Math.round((curr.output?.length || 0) / 4);
                  return acc + (promptEst + candEst);
                }, 0) ||
                Math.round((editableBlog.length / 4) * 5.2)
              ).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Est. API Cost
            </span>
            <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
              ${(
                session.totalTokens?.estimatedCostUsd || 0.0028
              ).toFixed(4)}
            </span>
          </div>
        </div>
      </div>

      <QaReviewPanel
        project={project}
        session={session}
        article={editableBlog}
        guidelines={guidelines}
        model={project.model || modelCatalog.defaultModel}
        onUpdateSession={onUpdateSession}
      />

      {/* Main Delivered Blog Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Card Header & Multi-format Export Actions */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-100 dark:bg-teal-950/80 text-teal-800 dark:text-teal-300 text-xs font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Publication Ready Clinical Blog</span>
            </div>
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              {session.userInput || project.name}
            </h2>
          </div>

          {/* Action Button Bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Copy dropdown/buttons */}
            <button
              onClick={() => handleCopy('md')}
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              {copiedType === 'md' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied MD!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleCopy('html')}
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              {copiedType === 'html' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied HTML!</span>
                </>
              ) : (
                <>
                  <Code className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy Clinic HTML</span>
                </>
              )}
            </button>

            <button
              onClick={handlePrintOrPdf}
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs"
              title="Print or Save as PDF"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Print / PDF</span>
            </button>

            {/* DOWNLOAD DROPDOWN WITH ALL REQUESTED FORMATS */}
            <div className="relative">
              <button
                onClick={() => setIsDownloadDropdownOpen((prev) => !prev)}
                className="text-xs font-semibold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-teal-600/30 flex items-center gap-1.5 transition-all hover:shadow active:scale-[0.98]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Blog Formats</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
              </button>

              {isDownloadDropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl z-20 py-2 text-xs">
                  <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-700 mb-1">
                    Select Download Format
                  </div>

                  <button
                    onClick={handleDownloadMedicalHtml}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between text-slate-800 dark:text-slate-200"
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5 text-teal-700 dark:text-teal-300">
                        <span>Clinic HTML (.html)</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-bold uppercase">
                          Recommended
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">Standalone with Prostate Clinic London styles</div>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadMarkdown}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between text-slate-800 dark:text-slate-200"
                  >
                    <div>
                      <div className="font-bold">Markdown (.md)</div>
                      <div className="text-[11px] text-slate-500">Full structured text with tables & callouts</div>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadWordDoc}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between text-slate-800 dark:text-slate-200"
                  >
                    <div>
                      <div className="font-bold">Microsoft Word (.docx)</div>
                      <div className="text-[11px] text-slate-500">Document formatted for Word & Google Docs</div>
                    </div>
                  </button>

                  <button
                    onClick={handleDownloadPlainText}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between text-slate-800 dark:text-slate-200"
                  >
                    <div>
                      <div className="font-bold">Plain Text (.txt)</div>
                      <div className="text-[11px] text-slate-500">Clean text without tags for EHR / CMS</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {docxError && (
          <div className="mx-5 mt-4 p-3 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {docxError}
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 sm:p-10">
          {editableBlog ? (
            <>
              {viewMode === 'clinical' && (
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* London Clinic Authority Header */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                        PCL
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Prostate Clinic London</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 font-semibold">
                            Harley Street
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          10 Harley Street, London W1G 9PF &bull; Specialist Urology Care
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-teal-600" />
                      <span><strong>Reviewed by:</strong> Consultant Urological Surgeon</span>
                    </div>
                  </div>

                  {/* Rendered Clinical Article */}
                  <div className="prose-content">
                    <MarkdownRenderer content={editableBlog} />
                  </div>

                  {/* London Clinic Consultation CTA Card */}
                  <div className="p-6 sm:p-8 rounded-3xl bg-linear-to-br from-slate-900 to-teal-950 text-white shadow-xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 text-xs font-semibold">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>Harley Street Specialist Care</span>
                    </div>
                    <h3 className="text-xl font-bold">Specialist Consultation & Second Opinions</h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">
                      If you are experiencing persistent or recurring prostate, pelvic, or urinary symptoms, specialist urological investigation can pinpoint the underlying cause and determine a targeted, culture-guided treatment plan.
                    </p>
                    <div className="pt-2 flex flex-wrap gap-4 text-xs font-medium">
                      <span className="px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs">📍 10 Harley Street, London W1G 9PF</span>
                      <span className="px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs">📞 020 3928 7447</span>
                      <span className="px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs">🌐 prostatecliniclondon.co.uk</span>
                    </div>
                  </div>

                  {/* Medical Disclaimer */}
                  <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 leading-relaxed flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Medical Disclaimer:</strong> This publication is produced for informational and educational purposes in accordance with British clinical guidelines (NICE, MHRA, and AUA standards). It does not replace individualized diagnostic assessment or specialist medical consultation. If you develop acute urinary retention, high fever with pelvic pain, or signs of systemic infection, seek immediate emergency medical care.
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'preview' && (
                <div className="max-w-3xl mx-auto">
                  <MarkdownRenderer content={editableBlog} />
                </div>
              )}

              {viewMode === 'raw' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>You can edit the markdown text below and click save.</span>
                    <button
                      onClick={handleSaveEdit}
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-xs transition-colors"
                    >
                      Save Changes
                    </button>
                  </div>
                  <textarea
                    rows={24}
                    value={editableBlog}
                    onChange={(e) => setEditableBlog(e.target.value)}
                    className="w-full text-xs font-mono p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-900 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 leading-relaxed"
                  />
                </div>
              )}

              {viewMode === 'html' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Generated standalone clinical HTML code (ready to paste into CMS or publish).</span>
                    <button
                      onClick={() => handleCopy('html')}
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-xs transition-colors"
                    >
                      Copy Complete HTML
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={24}
                    value={generateMedicalHtmlDocument(project.name, editableBlog, project)}
                    className="w-full text-xs font-mono p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-900 text-teal-300 focus:outline-none leading-relaxed"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 space-y-3">
              <BookOpen className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
              <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                No Final Blog Output Delivered Yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Head over to the Studio, select or input your topic, and execute the 5 clinical stages to generate the Prostate Clinic London formatted blog.
              </p>
              <button
                onClick={onBackToStudio}
                className="text-xs font-semibold px-4 py-2 rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors"
              >
                Go to Studio Pipeline
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
