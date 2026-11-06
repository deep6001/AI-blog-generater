import React, { useState, useEffect, useRef } from 'react';
import { Project, RunSession, StepOutputRecord, ChatMessage, TokenUsage, ResearchPack, GuidelineProfile } from '../types/pipeline';
import { guidelinePayload } from '../services/guidelines';
import { ModelCatalog, modelName } from '../services/models';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/supabase';
import { fetchResearch, saveResearchRun } from '../services/research';
import {
  interpolatePrompt,
  calculateGeminiCost,
  recordTokenUsage,
  getDailyTokenUsage,
  recordProjectRunUsage,
  DailyTokenLog,
} from '../utils/pipeline';
import { MarkdownRenderer } from './MarkdownRenderer';
import { RunStatusBar, RunOutcome, RunActivity } from './RunStatusBar';
import {
  Play,
  RotateCcw,
  Sparkles,
  Send,
  CheckCircle2,
  Clock,
  Edit2,
  Save,
  MessageSquare,
  ArrowRight,
  BookOpen,
  AlertCircle,
  HelpCircle,
  FileText,
  Sliders,
  ChevronRight,
  Check,
  RefreshCw,
  Coins,
  Zap,
  Globe,
  Loader2,
  ExternalLink,
} from 'lucide-react';

interface ExecutionStudioProps {
  project: Project;
  currentSession: RunSession;
  guidelines: GuidelineProfile | null;
  modelCatalog: ModelCatalog;
  onUpdateSession: (session: RunSession) => void;
  onViewFinalBlog: () => void;
}

// Runs keep going when the studio unmounts (tab switch), so in-flight runs are tracked outside the component.
// A saved "running" status with no in-flight run means the page was reloaded mid-run.
const inFlightRuns = new Map<string, number>();
const INTERRUPTED = 'Interrupted: the page was reloaded or closed while this was running. Run it again.';

export const ExecutionStudio: React.FC<ExecutionStudioProps> = ({
  project,
  currentSession,
  guidelines,
  modelCatalog,
  onUpdateSession,
  onViewFinalBlog,
}) => {
  const projectModel = project.model || modelCatalog.defaultModel;
  const { user, currentTenant } = useAuth();
  const [useWebResearch, setUseWebResearch] = useState(true);
  const [researchStatus, setResearchStatus] = useState<{
    state: 'idle' | 'running' | 'failed';
    error?: string;
    startedAt?: string;
  }>({ state: 'idle' });
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Run handlers spread a render-time copy of currentSession, so research is kept in a ref
  // and attached to every update rather than relying on that copy.
  const researchRef = useRef<ResearchPack | undefined>(currentSession.research);
  useEffect(() => {
    researchRef.current = currentSession.research;
  }, [currentSession.id]);

  const topicRef = useRef<HTMLTextAreaElement>(null);
  const focusTopic = () => {
    topicRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topicRef.current?.focus();
  };

  function tracked<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
    return async (...args: A) => {
      const id = currentSession.id;
      setOutcome(null);
      inFlightRuns.set(id, (inFlightRuns.get(id) || 0) + 1);
      try {
        await fn(...args);
      } finally {
        const n = (inFlightRuns.get(id) || 1) - 1;
        if (n > 0) inFlightRuns.set(id, n);
        else inFlightRuns.delete(id);
      }
    };
  }

  // Release a session left "running" by a reload, so its buttons work again.
  useEffect(() => {
    const outputs = currentSession.stepOutputs;
    const stuck = currentSession.status === 'running' || Object.values(outputs).some((o) => o.status === 'running');
    if (!stuck || inFlightRuns.has(currentSession.id)) return;
    const fixed = Object.fromEntries(
      Object.entries(outputs).map(([k, o]) => [k, o.status === 'running' ? { ...o, status: 'failed' as const, error: INTERRUPTED } : o])
    );
    onUpdateSession({ ...currentSession, status: 'failed', stepOutputs: fixed });
  }, [currentSession.id]);

  const updateSession = (session: RunSession) => {
    onUpdateSession({ ...session, research: researchRef.current });
  };

  /** Returns the research pack for this topic, running web research if needed. null means it failed. */
  const prepareResearch = async (topic: string): Promise<ResearchPack | undefined | null> => {
    if (!useWebResearch) return undefined;
    const existing = researchRef.current;
    if (existing && existing.topic === topic.trim()) return existing;

    setResearchStatus({ state: 'running', startedAt: new Date().toISOString() });
    try {
      const pack = await fetchResearch(project, topic.trim(), guidelines?.allowedDomains || [], project.model);
      researchRef.current = pack;

      if (pack.tokenUsage) {
        const usage = {
          ...pack.tokenUsage,
          estimatedCostUsd: calculateGeminiCost(pack.tokenUsage.promptTokens, pack.tokenUsage.candidatesTokens),
        };
        setDailyTokens(recordTokenUsage(usage));
        recordProjectRunUsage({
          projectId: project.id,
          projectName: project.name,
          date: new Date().toISOString().slice(0, 10),
          timestamp: new Date().toISOString(),
          promptTokens: usage.promptTokens,
          candidatesTokens: usage.candidatesTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          sessionTopic: topic,
          stepsCompleted: 0,
        });
      }

      if (user && currentTenant) {
        saveResearchRun({
          userId: user.uid,
          tenantId: currentTenant.id,
          projectId: project.id,
          sessionId: currentSession.id,
          referenceUrls: project.referenceUrls || [],
          pack,
        })
          .then((id) => {
            if (researchRef.current === pack) researchRef.current = { ...pack, id };
          })
          .catch((err) => console.warn('Could not save research run:', err?.message || err));
      }

      setResearchStatus({ state: 'idle' });
      return pack;
    } catch (err: any) {
      setResearchStatus({ state: 'failed', error: err.message || 'Web research failed.' });
      return null;
    }
  };
  const [inputTopic, setInputTopic] = useState(currentSession.userInput || '');
  const [selectedStepId, setSelectedStepId] = useState<string>(
    project.steps[0]?.id || ''
  );
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [showPromptSent, setShowPromptSent] = useState(false);

  const activeSteps = project.steps.filter((s) => s.isEnabled);

  const isMedicalProject =
    project.tags?.some((t) => /medical|clinic|prostate|health/i.test(t)) ||
    /prostate|clinic|medical|health/i.test(project.name);

  // Quick suggestions for easy testing matching user references
  const sampleTopics = isMedicalProject
    ? [
        'Why Does Prostatitis Keep Coming Back?',
        'Prostatitis in Younger Men: Why Does It Happen and Is It Different?',
        'Does Prostatitis Increase Your Risk of Prostate Cancer?',
        'Antibiotics for Prostatitis: How Long Do They Take to Work and When Do They Not Help?',
        'Bacterial vs Non-Bacterial Prostatitis: What’s the Difference?',
        'Mindfulness and Pelvic Floor Relaxation for Chronic Pelvic Pain Syndrome (CP/CPPS)',
      ]
    : [
        'Why Rust and WebAssembly are revolutionizing Cloud Infrastructure in 2026',
        'The rise of Autonomous AI Coding Agents: Developer Playbook & Trade-offs',
        'Modern Distributed Database Architectures: From Raft to Serverless Scale',
        'How to build resilient Microservices with Event-Driven Choreography',
      ];

  const [dailyTokens, setDailyTokens] = useState<DailyTokenLog>(() => getDailyTokenUsage());

  const computeSessionTokens = (outputs: Record<string, StepOutputRecord>): TokenUsage => {
    let promptTokens = 0;
    let candidatesTokens = 0;
    Object.values(outputs).forEach((record) => {
      if (record.status === 'completed') {
        if (record.tokenUsage) {
          promptTokens += record.tokenUsage.promptTokens;
          candidatesTokens += record.tokenUsage.candidatesTokens;
        } else if (record.output) {
          const estPrompt = Math.round((record.promptSent?.length || 600) / 4);
          const estCandidates = Math.round(record.output.length / 4);
          promptTokens += estPrompt;
          candidatesTokens += estCandidates;
        }
      }
    });
    const totalTokens = promptTokens + candidatesTokens;
    return {
      promptTokens,
      candidatesTokens,
      totalTokens,
      estimatedCostUsd: calculateGeminiCost(promptTokens, candidatesTokens),
    };
  };

  // Helper to execute a single step with automatic retry on timeout or network errors
  const executeStep = async (
    stepIndex: number,
    topic: string,
    existingOutputs: Record<string, StepOutputRecord>,
    research?: ResearchPack
  ): Promise<{ output: string; usage?: TokenUsage; unverifiedUrls?: string[]; error?: string }> => {
    const step = activeSteps[stepIndex];
    if (!step) return { output: '', error: 'Step not found' };

    // Determine previous step output
    let prevOutput = '';
    if (stepIndex > 0) {
      const prevStep = activeSteps[stepIndex - 1];
      prevOutput = existingOutputs[prevStep.id]?.output || '';
    }

    // Build variables
    const variables: Record<string, string> = {
      user_input: topic,
      previous_step_output: prevOutput,
      project_name: project.name,
      project_audience: project.targetAudience,
      project_tone: project.tone,
      project_word_count: String(project.targetWordCount),
    };

    // Also inject specific step outputs if referenced like step_1_output
    activeSteps.forEach((s, idx) => {
      if (existingOutputs[s.id]?.output) {
        variables[`step_${idx + 1}_output`] = existingOutputs[s.id].output;
      }
    });

    const compiledPrompt = interpolatePrompt(step.promptTemplate, variables);

    // Call server API with 1 automatic retry on timeout or 504
    let attempts = 0;
    let lastError = '';

    while (attempts < 2) {
      attempts++;
      try {
        const response = await apiFetch('/api/generate-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: compiledPrompt,
            systemInstruction: `You are acting as: ${step.systemRole}. Always output clean, professional content adhering to the instructions.`,
            temperature: step.temperature,
            guidelines: guidelines ? guidelinePayload(guidelines) : undefined,
            model: step.model || project.model || undefined,
            targetWordCount: project.targetWordCount,
            research: research && {
              brief: research.brief,
              sources: research.sources,
              styleNotes: research.styleNotes,
              createdAt: research.createdAt,
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg =
            errData.error ||
            (response.status === 504
              ? 'HTTP 504 Gateway Timeout: AI server took longer than expected to process this step. Please click "Retry Step" below.'
              : `HTTP error ${response.status}`);

          if (attempts < 2 && (response.status === 504 || response.status === 502 || response.status === 503)) {
            // Wait 1.5s before retry
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          throw new Error(errMsg);
        }

        const data = await response.json();
        const text = data.text || '';
        const promptTokens = data.usage?.promptTokens || Math.round(compiledPrompt.length / 4);
        const candidatesTokens = data.usage?.candidatesTokens || Math.round(text.length / 4);
        const totalTokens = data.usage?.totalTokens || (promptTokens + candidatesTokens);
        const usage: TokenUsage = {
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUsd: calculateGeminiCost(promptTokens, candidatesTokens),
        };
        const updatedDaily = recordTokenUsage(usage);
        setDailyTokens(updatedDaily);

        recordProjectRunUsage({
          projectId: project.id,
          projectName: project.name,
          date: new Date().toISOString().slice(0, 10),
          timestamp: new Date().toISOString(),
          promptTokens,
          candidatesTokens,
          totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd || 0,
          sessionTopic: topic,
          stepsCompleted: stepIndex + 1,
        });

        return { output: text, usage, unverifiedUrls: data.unverifiedUrls || [] };
      } catch (err: any) {
        lastError = err.message || 'Execution error';
        if (attempts < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        throw new Error(lastError);
      }
    }

    return { output: '', error: lastError };
  };

  // Run or retry a single step directly
  const handleRunSingleStep = tracked(async (stepId: string) => {
    if (!inputTopic.trim()) {
      focusTopic();
      return;
    }

    const research = await prepareResearch(inputTopic);
    if (research === null) return;

    const stepIndex = activeSteps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return;
    const currentStep = activeSteps[stepIndex];

    const updatedOutputs = {
      ...currentSession.stepOutputs,
      [currentStep.id]: {
        stepId: currentStep.id,
        stepTitle: currentStep.title,
        promptSent: 'Executing step...',
        output: '',
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        error: undefined,
      },
    };

    updateSession({
      ...currentSession,
      userInput: inputTopic,
      status: 'running',
      stepOutputs: updatedOutputs,
    });

    try {
      const result = await executeStep(stepIndex, inputTopic, updatedOutputs, research);

      const completedOutputs: Record<string, StepOutputRecord> = {
        ...updatedOutputs,
        [currentStep.id]: {
          ...updatedOutputs[currentStep.id],
          output: result.output,
          status: 'completed' as const,
          completedAt: new Date().toISOString(),
          tokenUsage: result.usage,
          unverifiedUrls: result.unverifiedUrls,
          error: undefined,
        },
      };

      const finalStep = activeSteps.find((s) => s.isFinalBlogStep) || activeSteps[activeSteps.length - 1];
      const finalBlogContent = completedOutputs[finalStep.id]?.output;
      const allCompleted = activeSteps.every((s) => completedOutputs[s.id]?.status === 'completed');

      updateSession({
        ...currentSession,
        userInput: inputTopic,
        status: allCompleted ? 'completed' : 'paused',
        stepOutputs: completedOutputs,
        finalBlog: finalBlogContent || currentSession.finalBlog,
        totalTokens: computeSessionTokens(completedOutputs),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Single step execution error:', err);
      updateSession({
        ...currentSession,
        status: 'failed',
        stepOutputs: {
          ...updatedOutputs,
          [currentStep.id]: {
            ...updatedOutputs[currentStep.id],
            status: 'failed',
            error: err.message,
          },
        },
      });
    }
  });

  // Resume the pipeline from the first incomplete or failed step
  const handleResumePipeline = tracked(async () => {
    if (!inputTopic.trim()) {
      focusTopic();
      return;
    }

    const research = await prepareResearch(inputTopic);
    if (research === null) return;

    // Find the first step that is not completed
    const resumeIndex = activeSteps.findIndex((s) => {
      const out = currentSession.stepOutputs[s.id];
      return !out || out.status !== 'completed';
    });

    if (resumeIndex === -1) {
      handleRunAllSteps();
      return;
    }

    let localOutputs = { ...currentSession.stepOutputs };

    updateSession({
      ...currentSession,
      userInput: inputTopic,
      status: 'running',
      currentStepIndex: resumeIndex,
    });

    for (let i = resumeIndex; i < activeSteps.length; i++) {
      const step = activeSteps[i];
      setSelectedStepId(step.id);

      localOutputs[step.id] = {
        stepId: step.id,
        stepTitle: step.title,
        promptSent: 'Executing step...',
        output: '',
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      };

      updateSession({
        ...currentSession,
        userInput: inputTopic,
        currentStepIndex: i,
        status: 'running',
        stepOutputs: { ...localOutputs },
      });

      try {
        const result = await executeStep(i, inputTopic, localOutputs, research);
        localOutputs[step.id] = {
          ...localOutputs[step.id],
          output: result.output,
          status: 'completed',
          completedAt: new Date().toISOString(),
          tokenUsage: result.usage,
          unverifiedUrls: result.unverifiedUrls,
          error: undefined,
        };

        const finalStep = activeSteps.find((s) => s.isFinalBlogStep) || activeSteps[activeSteps.length - 1];
        const deliveredBlog = localOutputs[finalStep.id]?.output;

        updateSession({
          ...currentSession,
          userInput: inputTopic,
          currentStepIndex: i + 1,
          status: i + 1 >= activeSteps.length ? 'completed' : 'running',
          stepOutputs: { ...localOutputs },
          finalBlog: deliveredBlog || currentSession.finalBlog,
          totalTokens: computeSessionTokens(localOutputs),
          updatedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error('Pipeline failed at step:', step.title, err);
        localOutputs[step.id] = {
          ...localOutputs[step.id],
          status: 'failed',
          error: err.message,
        };
        updateSession({
          ...currentSession,
          status: 'failed',
          stepOutputs: { ...localOutputs },
        });
        return;
      }
    }
  });

  // Run next single step
  const handleRunNextStep = tracked(async () => {
    if (!inputTopic.trim()) {
      focusTopic();
      return;
    }

    const research = await prepareResearch(inputTopic);
    if (research === null) return;

    // Find first uncompleted step or use current index
    let targetIndex = activeSteps.findIndex((s) => currentSession.stepOutputs[s.id]?.status !== 'completed');
    if (targetIndex === -1) targetIndex = currentSession.currentStepIndex;
    if (targetIndex >= activeSteps.length) return;

    const currentStep = activeSteps[targetIndex];

    // Mark running
    const updatedOutputs = {
      ...currentSession.stepOutputs,
      [currentStep.id]: {
        stepId: currentStep.id,
        stepTitle: currentStep.title,
        promptSent: 'Compiling...',
        output: '',
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        error: undefined,
      },
    };

    updateSession({
      ...currentSession,
      userInput: inputTopic,
      status: 'running',
      stepOutputs: updatedOutputs,
    });

    setSelectedStepId(currentStep.id);

    try {
      const result = await executeStep(targetIndex, inputTopic, updatedOutputs, research);

      const completedOutputs: Record<string, StepOutputRecord> = {
        ...updatedOutputs,
        [currentStep.id]: {
          ...updatedOutputs[currentStep.id],
          output: result.output,
          status: 'completed' as const,
          completedAt: new Date().toISOString(),
          tokenUsage: result.usage,
          unverifiedUrls: result.unverifiedUrls,
          error: undefined,
        },
      };

      const nextIndex = targetIndex + 1;
      const isFinished = nextIndex >= activeSteps.length;

      // Check if this step or final step delivers the blog
      const finalStep = activeSteps.find((s) => s.isFinalBlogStep) || activeSteps[activeSteps.length - 1];
      const finalBlogContent = completedOutputs[finalStep.id]?.output;

      updateSession({
        ...currentSession,
        userInput: inputTopic,
        currentStepIndex: nextIndex,
        status: isFinished ? 'completed' : 'paused',
        stepOutputs: completedOutputs,
        finalBlog: finalBlogContent || currentSession.finalBlog,
        totalTokens: computeSessionTokens(completedOutputs),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Step execution error:', err);
      updateSession({
        ...currentSession,
        status: 'failed',
        stepOutputs: {
          ...updatedOutputs,
          [currentStep.id]: {
            ...updatedOutputs[currentStep.id],
            status: 'failed',
            error: err.message,
          },
        },
      });
    }
  });

  // Run all remaining steps sequentially
  const handleRunAllSteps = tracked(async () => {
    if (!inputTopic.trim()) {
      focusTopic();
      return;
    }

    const research = await prepareResearch(inputTopic);
    if (research === null) return;

    let localOutputs = { ...currentSession.stepOutputs };
    let startIndex = currentSession.currentStepIndex;

    // If already finished, restart from 0
    if (startIndex >= activeSteps.length) {
      startIndex = 0;
      localOutputs = {};
    }

    updateSession({
      ...currentSession,
      userInput: inputTopic,
      status: 'running',
      currentStepIndex: startIndex,
    });

    for (let i = startIndex; i < activeSteps.length; i++) {
      const step = activeSteps[i];
      setSelectedStepId(step.id);

      localOutputs[step.id] = {
        stepId: step.id,
        stepTitle: step.title,
        promptSent: 'Executing step...',
        output: '',
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      };

      updateSession({
        ...currentSession,
        userInput: inputTopic,
        currentStepIndex: i,
        status: 'running',
        stepOutputs: { ...localOutputs },
      });

      try {
        const result = await executeStep(i, inputTopic, localOutputs, research);
        localOutputs[step.id] = {
          ...localOutputs[step.id],
          output: result.output,
          status: 'completed',
          completedAt: new Date().toISOString(),
          tokenUsage: result.usage,
          unverifiedUrls: result.unverifiedUrls,
          error: undefined,
        };

        const finalStep = activeSteps.find((s) => s.isFinalBlogStep) || activeSteps[activeSteps.length - 1];
        const deliveredBlog = localOutputs[finalStep.id]?.output;

        updateSession({
          ...currentSession,
          userInput: inputTopic,
          currentStepIndex: i + 1,
          status: i + 1 >= activeSteps.length ? 'completed' : 'running',
          stepOutputs: { ...localOutputs },
          finalBlog: deliveredBlog || currentSession.finalBlog,
          totalTokens: computeSessionTokens(localOutputs),
          updatedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error('Pipeline failed at step:', step.title, err);
        localOutputs[step.id] = {
          ...localOutputs[step.id],
          status: 'failed',
          error: err.message,
        };
        updateSession({
          ...currentSession,
          status: 'failed',
          stepOutputs: { ...localOutputs },
        });
        return;
      }
    }
  });

  // Chat refinement on current selected step
  const handleChatRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatSubmitting) return;

    const currentOutputRecord = currentSession.stepOutputs[selectedStepId];
    if (!currentOutputRecord || !currentOutputRecord.output) {
      alert('Please run this step first to generate output before refining it.');
      return;
    }

    const stepObj = activeSteps.find((s) => s.id === selectedStepId);
    const userMsg = chatInput.trim();
    setChatInput('');
    setIsChatSubmitting(true);

    const userChatMessage: ChatMessage = {
      id: `chat-${Date.now()}`,
      role: 'user',
      content: userMsg,
      timestamp: new Date().toISOString(),
      stepId: selectedStepId,
    };

    const newChatList = [...currentSession.chatMessages, userChatMessage];
    updateSession({
      ...currentSession,
      chatMessages: newChatList,
    });

    try {
      const response = await apiFetch('/api/chat-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepTitle: stepObj?.title || 'Current Step',
          currentOutput: currentOutputRecord.output,
          userMessage: userMsg,
          systemRole: stepObj?.systemRole || 'Editor',
          model: stepObj?.model || project.model || undefined,
        }),
      });

      const data = await response.json();

      const assistantChatMessage: ChatMessage = {
        id: `chat-${Date.now() + 1}`,
        role: 'assistant',
        content: data.reply || 'Refinement complete.',
        timestamp: new Date().toISOString(),
        stepId: selectedStepId,
      };

      const updatedOutputs: Record<string, StepOutputRecord> = {
        ...currentSession.stepOutputs,
        [selectedStepId]: {
          ...currentOutputRecord,
          output: data.updatedContent || currentOutputRecord.output,
        },
      };

      // If this was the final blog step, update finalBlog as well
      const isFinal = stepObj?.isFinalBlogStep;

      updateSession({
        ...currentSession,
        stepOutputs: updatedOutputs,
        finalBlog: isFinal ? data.updatedContent : currentSession.finalBlog,
        chatMessages: [...newChatList, assistantChatMessage],
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Chat refinement error:', err);
      alert('Refinement failed: ' + err.message);
    } finally {
      setIsChatSubmitting(false);
    }
  };

  const handleSaveDirectEdit = () => {
    const currentRecord = currentSession.stepOutputs[selectedStepId];
    if (!currentRecord) return;

    const updatedOutputs = {
      ...currentSession.stepOutputs,
      [selectedStepId]: {
        ...currentRecord,
        output: editedText,
      },
    };

    const stepObj = activeSteps.find((s) => s.id === selectedStepId);
    const isFinal = stepObj?.isFinalBlogStep;

    updateSession({
      ...currentSession,
      stepOutputs: updatedOutputs,
      finalBlog: isFinal ? editedText : currentSession.finalBlog,
      updatedAt: new Date().toISOString(),
    });

    setIsEditingOutput(false);
  };

  const handleResetSession = () => {
    if (confirm('Reset this generation run and start fresh?')) {
      researchRef.current = undefined;
      setResearchStatus({ state: 'idle' });
      updateSession({
        id: `run-${Date.now()}`,
        projectId: project.id,
        userInput: inputTopic,
        status: 'idle',
        currentStepIndex: 0,
        stepOutputs: {},
        chatMessages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setSelectedStepId(activeSteps[0]?.id || '');
    }
  };

  const selectedStep = activeSteps.find((s) => s.id === selectedStepId) || activeSteps[0];
  const selectedRecord = currentSession.stepOutputs[selectedStepId];
  const isResearching = researchStatus.state === 'running';
  const isRunning = currentSession.status === 'running' || isResearching;
  const research = researchRef.current;
  const isCompleted = currentSession.status === 'completed';
  const hasFailedStep = Object.values(currentSession.stepOutputs).some((o) => o.status === 'failed');
  const hasCompletedAny = Object.values(currentSession.stepOutputs).some((o) => o.status === 'completed');
  const canResume = (hasFailedStep || (hasCompletedAny && !isCompleted)) && !isRunning;
  const completedCount = activeSteps.filter((s) => currentSession.stepOutputs[s.id]?.status === 'completed').length;

  const runningIndex = activeSteps.findIndex((s) => currentSession.stepOutputs[s.id]?.status === 'running');
  const activity: RunActivity | null = isResearching
    ? {
        label: 'Researching the web',
        detail: `Finding sources for "${inputTopic.trim()}" with ${modelName(projectModel) || 'the AI model'}. This usually takes 30 to 90 seconds.`,
        startedAt: researchStatus.startedAt,
        completed: completedCount,
        total: activeSteps.length,
      }
    : runningIndex >= 0
      ? {
          label: `Writing step ${runningIndex + 1} of ${activeSteps.length}: ${activeSteps[runningIndex].title}`,
          detail: `Using ${modelName(activeSteps[runningIndex].model || projectModel) || 'the AI model'}`,
          startedAt: currentSession.stepOutputs[activeSteps[runningIndex].id]?.startedAt,
          completed: completedCount,
          total: activeSteps.length,
        }
      : currentSession.status === 'running'
        ? { label: 'Preparing the next step', detail: '', completed: completedCount, total: activeSteps.length }
        : null;

  // Tick the elapsed timer while something is running.
  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  // When a run ends, say how it went.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      const failedStep = activeSteps.find((s) => currentSession.stepOutputs[s.id]?.status === 'failed');
      if (researchStatus.state === 'failed') {
        setOutcome({ kind: 'error', message: `Web research failed. ${researchStatus.error || ''}` });
      } else if (failedStep) {
        const n = activeSteps.indexOf(failedStep) + 1;
        setOutcome({
          kind: 'error',
          message: `Step ${n} failed: ${currentSession.stepOutputs[failedStep.id]?.error || 'unknown error'}`,
          stepId: failedStep.id,
        });
      } else if (completedCount === activeSteps.length) {
        setOutcome({ kind: 'success', message: `All ${activeSteps.length} steps finished. Open Final blog to review it.` });
      } else {
        const last = activeSteps
          .filter((s) => currentSession.stepOutputs[s.id]?.completedAt)
          .sort((a, b) =>
            (currentSession.stepOutputs[b.id]!.completedAt || '').localeCompare(currentSession.stepOutputs[a.id]!.completedAt || '')
          )[0];
        if (last) {
          setOutcome({ kind: 'success', message: `Step ${activeSteps.indexOf(last) + 1} finished: ${last.title}`, stepId: last.id });
        }
      }
    }
    wasRunning.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (outcome?.kind !== 'success') return;
    const t = setTimeout(() => setOutcome(null), 8000);
    return () => clearTimeout(t);
  }, [outcome]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
      <RunStatusBar
        activity={activity}
        outcome={outcome}
        now={now}
        onDismiss={() => setOutcome(null)}
        onShowStep={(id) => {
          setSelectedStepId(id);
          document.getElementById('step-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      {/* Input Header Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <span>Project Chat & Generation Studio</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Input your topic or source notes. The pipeline will process it sequentially across each configured step.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 [&>button]:whitespace-nowrap">
            <button
              onClick={handleResetSession}
              title="Reset Run"
              className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            {canResume && (
              <button
                disabled={isRunning || !inputTopic.trim()}
                onClick={handleResumePipeline}
                className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm flex items-center gap-1.5 transition-all shadow-amber-500/20 active:scale-[0.98]"
                title="Resume pipeline execution from where it stopped"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Resume Pipeline</span>
              </button>
            )}

            <button
              disabled={isRunning || !inputTopic.trim()}
              onClick={handleRunNextStep}
              className={`text-xs font-semibold px-3.5 py-2 rounded-xl border transition-all flex items-center gap-1.5 ${
                isRunning || !inputTopic.trim()
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
              <span>Step-by-Step</span>
            </button>

            <button
              disabled={isRunning || !inputTopic.trim()}
              onClick={handleRunAllSteps}
              className={`text-xs font-semibold px-4 py-2 rounded-xl text-white shadow-sm flex items-center gap-2 transition-all shadow-indigo-600/30 ${
                isRunning || !inputTopic.trim()
                  ? 'bg-indigo-600 opacity-40 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow active:scale-[0.98]'
              }`}
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isRunning ? 'Running Pipeline...' : isCompleted ? 'Re-Run All Steps' : 'Run All Steps'}</span>
            </button>
          </div>
        </div>

        {/* Input Text Area */}
        <div className="space-y-2">
          <textarea
            ref={topicRef}
            rows={2}
            value={inputTopic}
            onChange={(e) => setInputTopic(e.target.value)}
            placeholder="Type your blog topic, core idea, outline notes, or brief here... (e.g., 'Why Rust and WebAssembly are revolutionizing Cloud Infrastructure in 2026')"
            className="w-full text-sm px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 leading-relaxed resize-y"
          />

          {!user && (
            <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You are browsing as a guest. Sign in to run research, generation and QA.
            </p>
          )}

          {!inputTopic.trim() && (
            <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Enter a topic (or pick a suggestion) to run the pipeline. The run buttons stay disabled until you do.
            </p>
          )}

          {/* Quick topic suggestion pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">Suggestions:</span>
            {sampleTopics.map((topic, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInputTopic(topic)}
                className="text-left text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                {topic.split(':')[0]}
              </button>
            ))}
          </div>

          {/* Web Research */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWebResearch}
                  disabled={isRunning}
                  onChange={(e) => setUseWebResearch(e.target.checked)}
                  className="accent-indigo-600"
                />
                <Globe className="w-3.5 h-3.5 text-indigo-500" />
                <span>Research the web before writing</span>
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {isResearching
                  ? 'Searching the web and reading sources...'
                  : research
                    ? `${research.sources.length} sources found for "${research.topic}"`
                    : project.referenceUrls?.length
                      ? `Will also study ${project.referenceUrls.length} reference article${project.referenceUrls.length === 1 ? '' : 's'}`
                      : 'Add reference articles in project settings to match their style'}
              </span>
            </div>

            {researchStatus.state === 'failed' && (
              <div className="flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {researchStatus.error} Run again to retry, or untick web research to write from the model's own knowledge.
                </span>
              </div>
            )}

            {research && !isResearching && (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-indigo-600 dark:text-indigo-400">
                  View research brief and sources
                </summary>
                <div className="mt-3 grid gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-3 prose prose-slate dark:prose-invert max-w-none max-h-96 overflow-y-auto">
                    <MarkdownRenderer content={research.brief} />
                  </div>
                  <ol className="lg:col-span-2 space-y-1.5 max-h-96 overflow-y-auto">
                    {research.sources.map((src) => (
                      <li key={src.id} className="flex gap-2">
                        <span className="font-mono text-slate-400">[{src.id}]</span>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-700 dark:text-slate-300 hover:text-indigo-600 break-all inline-flex gap-1"
                        >
                          <span>{src.title || src.domain}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            )}
          </div>

          {/* Token Usage & Cost Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 font-medium bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-300">
                <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-slate-500 dark:text-slate-400">Blog Tokens:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {(currentSession.totalTokens?.totalTokens || 0).toLocaleString()}
                </span>
                {Boolean(currentSession.totalTokens?.totalTokens) && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({(currentSession.totalTokens?.promptTokens || 0).toLocaleString()} in / {(currentSession.totalTokens?.candidatesTokens || 0).toLocaleString()} out)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 font-medium bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-xl border border-emerald-200/80 dark:border-emerald-800/60">
                <Coins className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400">Est. cost:</span>
                <span className="font-mono font-bold">
                  ${(currentSession.totalTokens?.estimatedCostUsd || calculateGeminiCost(currentSession.totalTokens?.promptTokens || 0, currentSession.totalTokens?.candidatesTokens || 0)).toFixed(4)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 font-medium bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-slate-500 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>Today's Total:</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {(dailyTokens.totalTokens || 0).toLocaleString()} tokens
                </span>
                <span className="text-[10px] text-slate-400">
                  (~${(dailyTokens.totalCostUsd || 0).toFixed(4)} • {dailyTokens.runsCount || 0} run{dailyTokens.runsCount === 1 ? '' : 's'})
                </span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span>Model:</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">{modelName(selectedStep?.model || projectModel) || 'No model configured'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Completion Banner */}
      {isCompleted && currentSession.finalBlog && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/70 dark:bg-emerald-900/60 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base font-medium">All steps finished</h2>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Open the final blog to review it and run the QA check.
              </p>
            </div>
          </div>

          <button
            onClick={onViewFinalBlog}
            className="shrink-0 h-9 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium flex items-center gap-2 active:scale-[0.98] transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            <span>Open final blog</span>
          </button>
        </div>
      )}

      {/* Step Stepper & Execution Progress Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Pipeline Progress
          </h2>
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {Object.values(currentSession.stepOutputs).filter((o) => o.status === 'completed').length} of{' '}
            {activeSteps.length} Steps Completed
          </span>
        </div>

        {/* Stepper Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {activeSteps.map((step, idx) => {
            const output = currentSession.stepOutputs[step.id];
            const isSelected = selectedStepId === step.id;
            const isStepRunning = output?.status === 'running';
            const isStepCompleted = output?.status === 'completed';
            const isStepFailed = output?.status === 'failed';

            return (
              <button
                key={step.id}
                onClick={() => setSelectedStepId(step.id)}
                className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col justify-between h-24 ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20'
                    : isStepFailed
                    ? 'border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30 hover:border-rose-400'
                    : isStepCompleted
                    ? 'border-emerald-200 dark:border-emerald-800/80 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`w-6 h-6 rounded-lg text-[11px] font-bold flex items-center justify-center ${
                      isStepCompleted
                        ? 'bg-emerald-500 text-white'
                        : isStepRunning
                        ? 'bg-indigo-600 text-white animate-spin'
                        : isStepFailed
                        ? 'bg-rose-600 text-white'
                        : isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {isStepCompleted ? (
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : isStepRunning ? (
                      <RotateCcw className="w-3 h-3 animate-spin" />
                    ) : isStepFailed ? (
                      <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />
                    ) : (
                      idx + 1
                    )}
                  </span>

                  {step.isFinalBlogStep && (
                    <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                      Deliverable
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                    {step.title}
                  </h3>
                  <p
                    className={`text-[10px] capitalize mt-0.5 ${
                      isStepFailed
                        ? 'text-rose-600 dark:text-rose-400 font-bold'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {isStepRunning
                      ? 'Running...'
                      : isStepCompleted
                      ? 'Completed'
                      : isStepFailed
                      ? 'Failed (Click to retry)'
                      : 'Pending'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split View: Step Output & Interactive Refinement Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Output of Selected Step (7 Cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/40">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  Step {activeSteps.findIndex((s) => s.id === selectedStep.id) + 1}:
                </span>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {selectedStep.title}
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Role: {selectedStep.systemRole}
              </p>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                disabled={isRunning || !inputTopic.trim()}
                onClick={() => handleRunSingleStep(selectedStep.id)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Run or re-run this specific step"
              >
                <Play className="w-3 h-3 fill-indigo-600 dark:fill-indigo-400" />
                <span>
                  {selectedRecord?.status === 'failed'
                    ? 'Retry Step'
                    : selectedRecord?.output
                    ? 'Re-run Step'
                    : 'Run This Step'}
                </span>
              </button>

              {selectedRecord?.output && (
                <>
                  {isEditingOutput ? (
                    <button
                      onClick={handleSaveDirectEdit}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white flex items-center gap-1 hover:bg-indigo-700 transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Edit</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setEditedText(selectedRecord.output);
                        setIsEditingOutput(true);
                      }}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Output</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Content Body */}
          <div id="step-output" className="p-6 flex-1 overflow-y-auto scroll-mt-40">
            {isResearching && selectedRecord?.status !== 'running' ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Researching the web first</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    The steps start as soon as the sources are in. You can follow progress in the bar at the top.
                  </p>
                </div>
              </div>
            ) : selectedRecord?.status === 'running' ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center animate-spin">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Executing {selectedStep.title}...
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Sending this step to {modelName(selectedStep.model || projectModel) || 'the AI model'} with the previous step's output.
                  </p>
                </div>
              </div>
            ) : selectedRecord?.status === 'failed' ? (
              <div className="p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm text-rose-900 dark:text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>Execution Failed for Step: {selectedStep.title}</span>
                </div>

                {selectedRecord.startedAt && (
                  <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
                    This attempt started {new Date(selectedRecord.startedAt).toLocaleString('en-GB')}.
                  </p>
                )}
                <div className="bg-white/80 dark:bg-slate-900/80 p-3 rounded-xl border border-rose-200/60 dark:border-rose-800/60 font-mono text-[11px] text-rose-700 dark:text-rose-400 whitespace-pre-wrap break-words">
                  {selectedRecord.error || 'An unexpected error occurred during generation.'}
                </div>

                {selectedRecord.error?.includes('504') ? (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] space-y-1">
                    <p className="font-semibold">Why did this happen (HTTP 504 Gateway Timeout)?</p>
                    <p>
                      The server timed out waiting for the AI model. Retry the step; if it keeps happening, raise STEP_TIMEOUT_MS in .env or shorten the prompt.
                    </p>
                  </div>
                ) : null}

                {!inputTopic.trim() && (
                  <p className="text-[11px]">
                    The topic box is empty, so this step can't run yet.{' '}
                    <button type="button" onClick={focusTopic} className="font-semibold underline underline-offset-2">
                      Enter a topic
                    </button>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    disabled={isRunning || !inputTopic.trim()}
                    onClick={() => handleRunSingleStep(selectedStep.id)}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Step {activeSteps.findIndex((s) => s.id === selectedStep.id) + 1}</span>
                  </button>

                  <button
                    disabled={isRunning || !inputTopic.trim()}
                    onClick={handleResumePipeline}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Resume Full Pipeline</span>
                  </button>
                </div>
              </div>
            ) : selectedRecord?.output ? (
              <div>
                {Boolean(selectedRecord.unverifiedUrls?.length) && (
                  <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      These links were not in the research sources. Check them before publishing:
                    </p>
                    <ul className="list-disc pl-5 break-all">
                      {selectedRecord.unverifiedUrls!.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {isEditingOutput ? (
                  <textarea
                    rows={16}
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="w-full text-xs font-mono p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-900 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 leading-relaxed"
                  />
                ) : (
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <MarkdownRenderer content={selectedRecord.output} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Step Not Executed Yet
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Click "Run All Steps" or "Step-by-Step" above to execute this prompt stage.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Interactive Chat & Refinement (5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[550px]">
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Chat & Refine Current Step
              </h3>
            </div>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-200 dark:border-indigo-800">
              Interactive
            </span>
          </div>

          {/* Chat Messages Log */}
          <div className="p-4 flex-1 overflow-y-auto space-y-3">
            <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs text-indigo-900 dark:text-indigo-300">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Ask for edits or adjustments:
              </p>
              <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                You can chat directly with this step! Try saying:
                <br />
                &bull; <em>"Make this angle more contrarian"</em>
                <br />
                &bull; <em>"Add 2 more technical subsections to the outline"</em>
                <br />
                &bull; <em>"Sharpen the hook and tone"</em>
              </p>
            </div>

            {currentSession.chatMessages
              .filter((m) => !m.stepId || m.stepId === selectedStepId)
              .map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/80 dark:border-slate-700'
                    }`}
                  >
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <span
                      className={`text-[9px] block text-right mt-1 ${
                        msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'
                      }`}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))}
          </div>

          {/* Chat Input Box */}
          <form
            onSubmit={handleChatRefine}
            className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
          >
            <input
              type="text"
              value={chatInput}
              disabled={isChatSubmitting || !selectedRecord?.output}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                selectedRecord?.output
                  ? `Message to refine "${selectedStep.title}"...`
                  : 'Run this step first to chat and refine...'
              }
              className="flex-1 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 disabled:bg-slate-100 dark:disabled:bg-slate-800/40"
            />

            <button
              type="submit"
              disabled={isChatSubmitting || !chatInput.trim() || !selectedRecord?.output}
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 transition-colors shadow-sm"
              title="Send refinement message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
