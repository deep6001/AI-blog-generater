import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// llm.ts reads API keys at import time, so load it after dotenv.
const { availableProviders, defaultModelRef, describeModelError, generate, listModels, resolveModel, resolveResearchModel, PROVIDER_LABELS } =
  await import('./server/llm');
const { runResearch, researchContext, findUnverifiedUrls } = await import('./server/research');
const { guidelinesContext, runQaReview } = await import('./server/guidelines');
const { summariseSampleDocx } = await import('./server/sampleDoc');
const { requireUser } = await import('./server/auth');
const { AdminError, createUser, listUsers, requireSuperAdmin, setAccess, setPassword } = await import('./server/admin');
const { checkLayout, dedupeReferences, finalizeArticle, specFromOutline } = await import('./server/layoutCheck');
const { blueprintFromOutline, buildFromBlueprint, fillPrompt } = await import('./server/skeleton');
const { checklistFromBrief } = await import('./server/coverage');
const { DEFAULT_EVIDENCE } = await import('./server/evidence');
const { wordRange } = await import('./server/guidelines');
type ModelInfo = import('./server/llm').ModelInfo;
type GuidelineInput = import('./server/guidelines').GuidelineInput;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS || process.env.GEMINI_STEP_TIMEOUT_MS) || 120000;
const RESEARCH_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS || process.env.GEMINI_RESEARCH_TIMEOUT_MS) || 150000;
const QA_TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || process.env.GEMINI_QA_TIMEOUT_MS) || 180000;

// APPROVED_REFERENCE_CHECK=false turns off the approved-reference step: research does not search or
// check the client's approved sites, and the final check does not enforce the approved list.
// References then come from the normal research sources. On by default.
const APPROVED_REFERENCE_CHECK = !/^(false|off|0|no)$/i.test(process.env.APPROVED_REFERENCE_CHECK?.trim() || '');

app.use(express.json({ limit: '10mb' }));

// One line per API call: method, path, model, status and duration.
app.use('/api', (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const model = typeof req.body?.model === 'string' ? ` ${req.body.model}` : '';
    console.log(`[api] ${req.method} ${req.originalUrl}${model} -> ${res.statusCode} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  });
  next();
});

app.get('/api/health', async (_req, res) => {
  const providers = availableProviders();
  res.json({ status: 'ok', hasApiKey: providers.length > 0, providers, model: await defaultModelRef() });
});

app.get('/api/models', async (_req, res) => {
  res.json({
    defaultModel: await defaultModelRef(),
    providers: availableProviders().map((id) => ({ id, label: PROVIDER_LABELS[id] })),
    models: await listModels(),
    approvedReferenceCheck: APPROVED_REFERENCE_CHECK,
  });
});

/** Validates a guideline profile from the client and fills any missing optional fields. */
function toGuidelineInput(g: any): GuidelineInput | null {
  if (!g || typeof g.name !== 'string' || !g.name.trim()) return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    name: g.name.trim(),
    writingRules: text(g.writingRules),
    referenceRules: text(g.referenceRules),
    qaChecklist: text(g.qaChecklist),
    scoreScale: g.scoreScale === 10 ? 10 : 100,
    referenceStyle: g.referenceStyle === 'harvard_full' ? 'harvard_full' : 'harvard_short',
    referenceCount: Number.isInteger(g.referenceCount) && g.referenceCount > 0 ? g.referenceCount : 5,
    referenceMix: text(g.referenceMix),
    allowedDomains: Array.isArray(g.allowedDomains) ? g.allowedDomains.filter((d: unknown) => typeof d === 'string') : [],
    minWordCount: Number(g.minWordCount) > 0 ? Number(g.minWordCount) : 0,
    maxWordCount: Number(g.maxWordCount) > 0 ? Number(g.maxWordCount) : 0,
    cta: text(g.cta),
    internalLinks: text(g.internalLinks),
    sampleOutline: text(g.sampleOutline) || null,
    sampleWordCount: Number(g.sampleWordCount) > 0 ? Number(g.sampleWordCount) : null,
  };
}

function sendModelError(res: express.Response, where: string, err: any, info?: ModelInfo) {
  const { status, message } = describeModelError(err, info);
  console.error(`Model call failed in ${where} (${info?.id ?? 'no model'}):`, err?.message || err);
  res.status(status).json({ error: message });
}

/** Resolves the requested "provider:model", or answers with an error and returns null. */
async function modelOrError(res: express.Response, ref: unknown, where: string): Promise<ModelInfo | null> {
  try {
    return await resolveModel(ref);
  } catch (err) {
    sendModelError(res, where, err);
    return null;
  }
}

// Approved sample article (.docx): describe its layout so blogs can follow it
app.post('/api/sample-docx', requireUser, express.raw({ type: 'application/octet-stream', limit: '15mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: 'Upload a .docx file.' });
    return;
  }
  try {
    res.json(summariseSampleDocx(new Uint8Array(req.body)));
  } catch (err: any) {
    res.status(400).json({ error: err?.message?.includes('Word') ? err.message : 'This file could not be read as a Word .docx document.' });
  }
});

// Web research: provider web search for cited facts, plus reference articles for house style
app.post('/api/research', requireUser, async (req, res) => {
  const { topic, audience, tone, referenceUrls, approvedSources, minSources } = req.body;
  if (!topic || typeof topic !== 'string') {
    res.status(400).json({ error: 'Missing topic parameter.' });
    return;
  }
  let info: ModelInfo;
  try {
    info = await resolveResearchModel();
  } catch (err) {
    sendModelError(res, '/api/research', err);
    return;
  }

  try {
    const result = await runResearch(
      info,
      {
        topic,
        audience,
        tone,
        referenceUrls: Array.isArray(referenceUrls) ? referenceUrls : [],
        approvedSources:
          APPROVED_REFERENCE_CHECK && Array.isArray(approvedSources)
            ? approvedSources.filter((s: unknown) => typeof s === 'string').slice(0, 40)
            : [],
        minSources: Math.min(Math.max(Number(minSources) || 0, 0), 15),
      },
      RESEARCH_TIMEOUT_MS
    );
    res.json({ ...result, model: info.id });
  } catch (err: any) {
    sendModelError(res, '/api/research', err, info);
  }
});

app.post('/api/generate-step', requireUser, async (req, res) => {
  const { prompt, systemInstruction, temperature = 0.7, research, guidelines, targetWordCount, model } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing prompt parameter.' });
    return;
  }
  const info = await modelOrError(res, model, '/api/generate-step');
  if (!info) return;

  const hasResearch = research && typeof research.brief === 'string' && Array.isArray(research.sources);
  if (hasResearch && !APPROVED_REFERENCE_CHECK) delete research.approvedReferences;
  const profile = toGuidelineInput(guidelines);
  const fullPrompt =
    prompt +
    (profile ? guidelinesContext(profile, Number(targetWordCount) || 0) : '') +
    (hasResearch ? researchContext(research) : '');

  try {
    const { text, usage } = await generate(info, {
      prompt: fullPrompt,
      system: systemInstruction || 'You are an expert content strategist and professional writer.',
      temperature: Math.min(Math.max(Number(temperature) || 0.7, 0.1), 1.0),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });

    if (!text.trim()) {
      res.status(502).json({ error: 'The model returned an empty response. Please retry this step.' });
      return;
    }

    const promptTokens = usage.promptTokens || Math.round(fullPrompt.length / 4);
    const candidatesTokens = usage.candidatesTokens || Math.round(text.length / 4);
    res.json({
      text,
      model: info.id,
      unverifiedUrls: hasResearch
        ? findUnverifiedUrls(text, [...research.sources, ...(Array.isArray(research.approvedReferences) ? research.approvedReferences : [])])
        : [],
      usage: { promptTokens, candidatesTokens, totalTokens: usage.totalTokens || promptTokens + candidatesTokens },
    });
  } catch (err: any) {
    sendModelError(res, '/api/generate-step', err, info);
  }
});

// Full start-to-finish QA and reference check against the client's guideline profile
app.post('/api/qa-review', requireUser, async (req, res) => {
  const { article, guidelines, sourceUrls, model } = req.body;
  if (!article || typeof article !== 'string') {
    res.status(400).json({ error: 'Missing article to review.' });
    return;
  }
  const profile = toGuidelineInput(guidelines);
  if (!profile) {
    res.status(400).json({ error: 'A guideline profile is required for QA review.' });
    return;
  }
  const info = await modelOrError(res, model, '/api/qa-review');
  if (!info) return;

  try {
    const urls = Array.isArray(sourceUrls) ? sourceUrls.filter((u: unknown) => typeof u === 'string') : [];
    const result = await runQaReview(info, article, profile, urls, QA_TIMEOUT_MS);
    res.json({ ...result, model: info.id });
  } catch (err: any) {
    sendModelError(res, '/api/qa-review', err, info);
  }
});

// Final check: compare the finished article with the sample template and word range, and correct it.
app.post('/api/finalize', requireUser, async (req, res) => {
  const { article, guidelines, targetWordCount, sources, approvedSources, model, brief, topic } = req.body;
  if (!article || typeof article !== 'string') {
    res.status(400).json({ error: 'Missing article.' });
    return;
  }
  const info = await modelOrError(res, model, '/api/finalize');
  if (!info) return;

  const profile = toGuidelineInput(guidelines);
  const [minWords, maxWords] = wordRange(profile, Number(targetWordCount) || 0);
  const spec = specFromOutline(profile?.sampleOutline, {
    minWords,
    maxWords,
    minReferences: profile?.referenceCount || 5,
    noDoiLinks: (profile?.referenceStyle ?? 'harvard_short') === 'harvard_short',
    internalLinkUrls: (profile?.internalLinks.match(/https?:\/\/[^\s|)]+/g) || []).map((u) => u.replace(/[.,]+$/, '')),
  });
  // Real articles are always held to an evidence bar: the sample's, or a sensible default.
  spec.evidence ??= DEFAULT_EVIDENCE;
  spec.mustCover = checklistFromBrief(typeof brief === 'string' ? brief : '');
  spec.topic = typeof topic === 'string' ? topic : '';
  const validSources = Array.isArray(sources)
    ? sources
        .filter((s: any) => typeof s?.url === 'string')
        .map((s: any) => ({
          title: String(s.title || s.url),
          url: s.url,
          citation: typeof s.citation === 'string' ? s.citation : undefined,
        }))
    : [];
  const approved =
    APPROVED_REFERENCE_CHECK && Array.isArray(approvedSources) ? approvedSources.filter((s: unknown) => typeof s === 'string') : [];
  if (approved.length) {
    spec.approvedSources = approved;
    // Only as many references as the approved sites could provide.
    spec.minReferences = Math.min(spec.minReferences, validSources.length);
  }

  try {
    const deadline = AbortSignal.timeout(QA_TIMEOUT_MS * 4); // blueprint fill plus up to 5 correction passes
    const complete = async (prompt: string, temperature = 0.3) => (await generate(info, { prompt, temperature, signal: deadline })).text;

    // With a sample, rebuild the draft on the sample's exact blueprint first, so the layout matches by
    // construction. The checks and correction passes below then deal with wording and length.
    let draft = article;
    let builtFromSample = false;
    const bp = blueprintFromOutline(profile?.sampleOutline);
    let fill: Parameters<typeof fillPrompt>[0] | null = null;
    if (bp) {
      fill = {
        bp,
        draft: article,
        minWords,
        maxWords,
        sampleWords: profile?.sampleWordCount,
        rules: profile?.writingRules,
        internalLinks: profile?.internalLinks,
        sources: validSources,
        voice: spec.voice,
        evidence: spec.evidence,
        checklist: spec.mustCover,
        research: typeof brief === 'string' ? brief.slice(0, 16000) : undefined,
      };
      const built = await buildFromBlueprint(
        bp,
        (only, written) => fillPrompt(fill!, only, written),
        (prompt) => complete(prompt, 0.2)
      );
      if (!('problems' in built)) {
        draft = built.article;
        builtFromSample = true;
      } else {
        console.warn('Could not fit the article to the sample blueprint:', built.problems.slice(0, 5).join(' | '));
      }
    }

    const result = await finalizeArticle(draft, spec, (prompt) => complete(prompt), {
      sources: validSources,
      research: typeof brief === 'string' ? brief : undefined,
    });
    let final = result;
    if (bp && builtFromSample && final.issues.length) {
      const score = (r: { issues: string[]; wordCount: number }) =>
        r.issues.length * 1000 + Math.max(0, r.wordCount - spec.maxWords, spec.minWords - r.wordCount);
      for (let round = 0; round < 2 && final.issues.length; round++) {
        const current = final;
        const refill = await buildFromBlueprint(
          bp,
          (only, written) => fillPrompt({ ...fill!, draft: current.article, fixes: current.issues }, only, written),
          (prompt) => complete(prompt, 0.2)
        );
        if ('problems' in refill) break;
        const article = dedupeReferences(refill.article, spec.referencesHeading);
        const report = checkLayout(article, spec);
        if (score(report) >= score(current)) break;
        final = { ...current, article, issues: report.issues, wordCount: report.wordCount, passes: current.passes + 1 };
      }
    }
    res.json({ ...final, builtFromSample, range: [minWords, maxWords], model: info.id });
  } catch (err: any) {
    sendModelError(res, '/api/finalize', err, info);
  }
});

// Super admin: manage who can use BlogCraft.
function adminRoute(fn: (req: express.Request, res: express.Response) => Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      res.json((await fn(req, res)) ?? { ok: true });
    } catch (err: any) {
      const status = err instanceof AdminError ? err.status : 500;
      if (status >= 500) console.error('Admin action failed:', err?.message || err);
      res.status(status).json({ error: err?.message || 'The admin action failed.' });
    }
  };
}
app.get('/api/admin/users', requireUser, requireSuperAdmin, adminRoute(async () => ({ users: await listUsers() })));
app.post('/api/admin/users', requireUser, requireSuperAdmin, adminRoute(async (req) => createUser(req.body || {})));
app.post(
  '/api/admin/users/:id/access',
  requireUser,
  requireSuperAdmin,
  adminRoute(async (req, res) => setAccess(req.params.id, req.body?.enabled === true, res.locals.userId))
);
app.post(
  '/api/admin/users/:id/password',
  requireUser,
  requireSuperAdmin,
  adminRoute(async (req) => setPassword(req.params.id, req.body?.password))
);

app.post('/api/chat-refine', requireUser, async (req, res) => {
  const { stepTitle, currentOutput, userMessage, systemRole, model } = req.body;
  if (!currentOutput || !userMessage) {
    res.status(400).json({ error: 'currentOutput and userMessage are required.' });
    return;
  }
  const info = await modelOrError(res, model, '/api/chat-refine');
  if (!info) return;

  const prompt = `You are an expert editor (${systemRole || 'Editor'}).
The user is working on step "${stepTitle}".
Here is the current draft/content for this step:
"""
${currentOutput}
"""

The user requested the following modification or refinement:
"${userMessage}"

Keep every existing reference and citation unless the user asks to remove it, and do not add new references.

Please provide:
1. A brief explanation of the modifications made.
2. The complete updated content for this step.

Format your response as:
REPLY: <your concise conversational response to the user>
---UPDATED_CONTENT---
<the revised full content here>`;

  try {
    const { text: raw } = await generate(info, { prompt, temperature: 0.6, signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    if (raw.includes('---UPDATED_CONTENT---')) {
      const [replyPart, content] = raw.split('---UPDATED_CONTENT---');
      res.json({ reply: replyPart.replace(/^REPLY:\s*/i, '').trim(), updatedContent: content.trim() });
    } else {
      res.json({ reply: 'Updated the step according to your feedback.', updatedContent: raw.trim() });
    }
  } catch (err: any) {
    sendModelError(res, '/api/chat-refine', err, info);
  }
});

// Start dev or production server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
