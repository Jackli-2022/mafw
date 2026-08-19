import { log } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { ParametricStore } from './memory/store';
import { MemoryIndexManager } from './compression/memory-index';
import { SessionPruner } from './compression/session-pruner';
import { VectorIndex } from './compression/vector-index';
import { TokenBudgetAllocator } from './compression/token-budget-allocator';
import { reciprocalRankFusion, diversifyByLoop, RRFResult } from './compression/rrf-fusion';
import { loadState, updateState } from './utils/state';
import { sessionEndingHook } from './hooks/session-ending';
import { ConfigLoader } from './utils/config-loader';
import { HookManager } from './hooks/hook-manager';
import { KnowledgeGraphManager } from './graph/knowledge-graph-manager';
import { HarmonicIndexManager } from './memory/harmonic-index';
import { CognitiveGraphManager } from './memory/cognitive-graph';
import { ReviewScheduler } from './memory/review-scheduler';
import { CostEstimator } from './cost/cost-estimator';
import type { CostRecord } from './cost/types';
import { sessionStartHook } from './hooks/session-start';
import { toolBeforeHook } from './hooks/tool-before';
import { userPromptHook } from './hooks/user-prompt';
import { llmAfterHook } from './hooks/llm-after';
import { sessionCompactingHook } from './hooks/session-compacting';
import { handoffHook } from './hooks/handoff';
import { T1Store } from './memory/t1-store';
import { CompressionPipeline } from './compression/compression-pipeline';
import { T1ToT2Compressor } from './memory/t1-to-t2-compressor';
import { ObservationService } from './memory/observation-service';
import { renderMemoryBlocks } from '../recall/inject-format';
import { TtlMap } from '../recall/ttl-map';

// First-turn injection dedup: keyed by the first-user message ID (globally
// unique), so each user message gets memory blocks injected exactly once —
// tool-call rounds re-present the same firstUser and must not re-inject.
const injectedFirstUser = new TtlMap<string, string>(24 * 60 * 60 * 1000);


/**
 * MAFW Plugin 锟?OpenCode Official Format v5.0
 *
 * Architecture: 搂8.1
 * Returns an object with config, command, tool, hooks.
 * No activate() function. No registerSkill/registerCommand API.
 */

interface HybridSearchResult {
  semantic: Array<{ id: string; score: number; facts: string[]; concepts: string[]; energy: number }>;
  procedural: Array<{ id: string; score: number; pattern: string; successRate: number; energy: number }>;
  parametric: Array<{ id: string; score: number; content: string; energy: number; type: string }>;
  episodic: Array<{ id: string; score: number; summary: string; verdict: string; energy: number }>;
  totalTokens: number;
}

export default async function MafwPlugin({ directory }: { directory: string }) {
  const mafwDir = path.join(directory, '.mafw');

  // 0. 鍒濆锟?MAFW 鐩綍缁撴瀯锛堟彃浠惰繍琛屾椂鍒涘缓锟?
  await ensureMafwDirectories(mafwDir);

  // 0a. 锟?console.log/warn/error 鍚屾椂鍐欏叆鏂囦欢 .mafw/logs/mafw.log
  const { log } = require('./utils/logger');
  log.info('Plugin activated');

  // 0b. Load configuration
  const config = ConfigLoader.getInstance(directory).getAll();

  // 1. 锟?Gateway 娉ㄥ唽椤圭洰锛堟帰娴嬬锟?3000-3010锟?
  await registerWithGateway(directory, mafwDir);

  log.info('[MAFW] Plugin activated. All skills loaded. All commands registered.');

  // 2. 鍒濆鍖栬蹇嗗眰
  const parametricStore = new ParametricStore({
    baseDir: path.join(mafwDir, 'parametric'),
    bannedDir: path.join(mafwDir, 'parametric', 'banned'),
    manifestFile: path.join(mafwDir, 'parametric', 'base-skill-manifest.yaml')
  });
  const memoryIndex = new MemoryIndexManager(path.join(mafwDir, 'memory-index.json'));
  const vectorIndex = new VectorIndex();
  const tokenBudgetAllocator = new TokenBudgetAllocator({ defaultBudget: 2000 });
  const sessionPruner = new SessionPruner({ maxContextTokens: 8000, compressionThreshold: 0.6 });

  const knowledgeGraphManager = new KnowledgeGraphManager(path.join(mafwDir, 'knowledge-graph.json'));
  await knowledgeGraphManager.load();

  // 鈹€鈹€ Hook Manager (moved before HarmonicIndex which needs it) 鈹€鈹€
  const hookManager = new HookManager({ failBehavior: 'continue', timeout: 30000 });

  // 鈹€鈹€ v6.3 Harmonic Index 鈹€鈹€
  const harmonicIndex = new HarmonicIndexManager(mafwDir, hookManager);

  // 鈹€鈹€ v6.4 Cognitive Graph (association network) 鈹€鈹€
  const cognitiveGraph = new CognitiveGraphManager(mafwDir);

  // 鈹€鈹€ v6.4 Review Scheduler (spaced repetition) 鈹€鈹€
  const reviewScheduler = new ReviewScheduler(harmonicIndex, mafwDir);
  reviewScheduler.start();

  // 鈹€鈹€ T1 Observation Store 鈹€鈹€
  const t1Store = new T1Store(mafwDir);
  const compressionPipeline = new CompressionPipeline({ baseDir: mafwDir, harmonicIndex });
  const t1ToT2Compressor = new T1ToT2Compressor(t1Store, compressionPipeline, harmonicIndex, mafwDir);
  const observationService = new ObservationService({ t1Store, compressor: t1ToT2Compressor });

  // 鈹€鈹€ v6.3 Auto-migration (first load) 鈹€鈹€
  if (!fs.existsSync(path.join(mafwDir, 'memory', '.harmonic_index.json'))) {
    log.info('[MAFW] No harmonic index found, running v6.1鈫抳6.3 migration...');
    try {
      const { migrateV61 } = require('./memory/migrate-v6.1');
      const result = await migrateV61(mafwDir, harmonicIndex);
      log.info(`[MAFW] Migration complete: ${result.migrated} migrated, ${result.errors.length} errors`);
    } catch (err: any) {
      log.error(`[MAFW] Migration failed: ${err.message}`);
    }
  }

  const toolExecutedHook = async ({ tool }: any, { output }: any) => {
    if (output && output.length > 1000) {
      log.info(`[MAFW] Compressing output for ${tool} (${output.length} chars)`);
    }
  };

  // 鈹€鈹€ Cost Estimator (Task 6) 鈹€鈹€
  const costEstimator = new CostEstimator();

  function persistCosts(): void {
    const all = costEstimator.getAllRecords();
    if (all.length === 0) return;

    // Write to SQLite
    try {
      const dbPath = path.join(mafwDir, 'data', 'state.db');
      if (fs.existsSync(dbPath)) {
        const { SQLiteStorage } = require('./storage/sqlite-storage');
        const storage = new SQLiteStorage(dbPath);
        storage.batch(all.map((r: any) => ({
          type: 'set' as const,
          scope: 'cost_logs',
          key: r.id,
          value: r
        })));
      }
    } catch {}

    // Write JSON for Dashboard FS fallback
    const costDir = path.join(mafwDir, 'cost');
    if (!fs.existsSync(costDir)) fs.mkdirSync(costDir, { recursive: true });
    const byGoal = new Map<string, CostRecord[]>();
    for (const r of all) {
      const key = r.goalId || 'unknown';
      const list = byGoal.get(key) || [];
      list.push(r);
      byGoal.set(key, list);
    }
    for (const [goalId, records] of byGoal) {
      fs.writeFileSync(
        path.join(costDir, `${goalId}.json`),
        JSON.stringify(records, null, 2),
        'utf-8'
      );
    }
  }

  hookManager.register({
    name: 'session-ending',
    event: 'session.end',
    handler: async (ctx) => {
      await sessionEndingHook({ sessionId: ctx.sessionID, projectDir: directory });
    },
    priority: 100
  });
  hookManager.register({
    name: 'tool-executed',
    event: 'tool.execute.after',
    handler: async (ctx) => {
      const { tool, output, input, sessionID } = ctx.data || ctx;
      if (output && output.length > 1000) {
        log.info(`[MAFW] Compressing output for ${tool} (${output.length} chars)`);
      }
      const args = typeof input === 'string' ? input : JSON.stringify(input || {});
      observationService.captureToolResult(sessionID || '', tool || '', output || '', args);
    },
    priority: 50
  });
  hookManager.register({
    name: 'cost-recording',
    event: 'tool.execute.after',
    handler: async (ctx) => {
      const data = ctx.data || ctx;
      const { tool, input } = data;
      if (!tool) return;
      let goalId: string = 'unknown';
      let loopNum: number = 1;
      if (input) {
        try {
          const parsed = typeof input === 'string' ? JSON.parse(input) : input;
          goalId = parsed.goalId || parsed.goal_id || goalId;
          loopNum = parsed.loopNum || parsed.loop_num || loopNum;
        } catch { /* ignore parse errors */ }
      }
      if (goalId === 'unknown') {
        try {
          const stateDir = path.join(mafwDir, 'state');
          if (fs.existsSync(stateDir)) {
            const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
            if (files.length > 0) goalId = files[0].replace('.json', '');
          }
        } catch { /* ignore */ }
      }
      costEstimator.recordToolCall({
        goalId,
        loopNum,
        toolName: tool,
        input: typeof input === 'string' ? input : JSON.stringify(input || {})
      });
      persistCosts();
    },
    priority: 40
  });

  // 鈹€鈹€ v6.0 Cost Threshold Hook 鈹€鈹€
  hookManager.register({
    name: 'cost-threshold',
    event: 'session.start',
    priority: 10,
    handler: async (ctx: any) => {
      const allRecords = costEstimator.getAllRecords();
      const totalCost = allRecords.reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);
      const budget = (config as any)?.cost?.budget?.total || 1000000;
      const threshold = (config as any)?.cost?.budget?.threshold || 0.8;
      if (budget > 0 && totalCost / budget > threshold) {
        ctx.forceHaiku = true;
        ctx.compressInjection = true;
      }
    }
  });

  // 鈹€鈹€ Wave 1: Memory Internal Hooks 鈹€鈹€
  hookManager.register({
    name: 'memory-write-handler',
    event: 'memory.write',
    handler: async (ctx) => {
      const { unit, tier, source } = ctx.data || ctx;
      if (cognitiveGraph && unit) {
        // goal_id connections removed in v6.6 flattening
      }
    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-recall-handler',
    event: 'memory.recall',
    handler: async (ctx) => {
      const { query, resultIds } = ctx.data || ctx;
      if (cognitiveGraph && resultIds && resultIds.length > 1) {
        for (let i = 0; i < resultIds.length; i++) {
          for (let j = i + 1; j < resultIds.length; j++) {
            cognitiveGraph.addConnection(resultIds[i], resultIds[j]);
          }
        }
      }
    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-contradiction-handler',
    event: 'memory.contradiction',
    handler: async (ctx) => {
      const { existingId, newId, field, existingValue, newValue } = ctx.data || ctx;

    },
    priority: 100
  });

  hookManager.register({
    name: 'memory-decay-handler',
    event: 'memory.decay',
    handler: async (ctx) => {
      const { oldEnergy, newEnergy, reason, unitId } = ctx.data || ctx;
      if (newEnergy < 0.3) {
      }
    },
    priority: 100
  });

  // 鈹€鈹€ Wave 2: Session Start 鈹€鈹€
  hookManager.register({
    name: 'session-start',
    event: 'session.start',
    handler: async (ctx) => {
      await sessionStartHook({ sessionId: ctx.sessionId, projectDir: directory });
    },
    priority: 5
  });

  // 鈹€鈹€ Wave 2: Tool Before 鈹€鈹€
  hookManager.register({
    name: 'tool-before',
    event: 'tool.execute.before',
    handler: async (ctx) => {
      await toolBeforeHook({ tool: ctx.tool, sessionID: ctx.sessionID, callID: ctx.callID, args: ctx.args });
    },
    priority: 100
  });

  // 鈹€鈹€ Wave 2: User Prompt 鈹€鈹€
  hookManager.register({
    name: 'user-prompt',
    event: 'user.prompt.submit',
    handler: async (ctx) => {
      const text = ctx.message?.parts?.[0]?.text || '';
      await userPromptHook({ sessionID: ctx.sessionID, text });
      observationService.captureUserInput(ctx.sessionID || '', text);
    },
    priority: 50
  });

  // 鈹€鈹€ Wave 2: LLM After 鈹€鈹€
  hookManager.register({
    name: 'llm-after',
    event: 'llm.call.after',
    handler: async (ctx) => {
      await llmAfterHook({ sessionID: ctx.sessionID, text: ctx.text });
      observationService.captureAssistantReply(ctx.sessionID || '', ctx.text || '');
    },
    priority: 50
  });

  // 鈹€鈹€ Session End: trigger turn-based T1鈫扵2 compression 鈹€鈹€
  hookManager.register({
    name: 'session-end-compress',
    event: 'session.end',
    handler: async (ctx) => {
      observationService.endSession(ctx.sessionID || '').catch(() => {});
    },
    priority: 50
  });

  // 鈹€鈹€ Wave 2: Session Compacting 鈹€鈹€
  hookManager.register({
    name: 'session-compacting',
    event: 'session.compacting',
    handler: async (ctx) => {
      await sessionCompactingHook({ sessionID: ctx.sessionID, projectDir: directory });
    },
    priority: 100
  });

  // 鈹€鈹€ Handoff detection: fires session.handoff on phase transitions 鈹€鈹€
  hookManager.register({
    name: 'handoff-detector',
    event: 'session.end',
    priority: 90,
    handler: async (ctx) => {
      try {
        const stateDir = path.join(mafwDir, 'state');
        if (!fs.existsSync(stateDir)) return;
        const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
          const session = Object.entries(state.sessions || {}).find(([_, s]: any) => (s as any).id === ctx.sessionID);
          if (!session) continue;
          const [phase] = session;

          let nextPhase = '';
          if (state.nextAction === 'CREATE_EXECUTE_SESSION') nextPhase = 'EXECUTING';
          else if (state.nextAction === 'CREATE_REVIEW_SESSION') nextPhase = 'REVIEW';
          else if (state.nextAction === 'CREATE_PLAN_SESSION') nextPhase = 'PLANNING';
          else if (state.nextAction === 'PASS' || state.nextAction === 'FAIL') nextPhase = state.nextAction;

          if (nextPhase) {
            await hookManager.execute('session.handoff', {
              from: phase,
              to: nextPhase,
              goalId: state.goalId,
              context: { wave: state.currentWave, loop: state.loop }
            });
          }
        }
      } catch (err: any) {
        log.error(`[hook:handoff-detector] Error: ${err.message}`);
      }
    }
  });

  // 鈹€鈹€ Wave 3: Handoff 鈹€鈹€
  hookManager.register({
    name: 'session-handoff',
    event: 'session.handoff',
    handler: async (ctx) => {
      await handoffHook({
        from: ctx.from,
        to: ctx.to,
        goalId: ctx.goalId,
        context: ctx.context,
        projectDir: directory
      });
    },
    priority: 100
  });

  // 鈹€鈹€ V5 Hybrid Search 宸ュ叿鍑芥暟 鈹€鈹€
  async function executeHybridSearch({ query, maxResults = 10, tokenBudget = 2000 }: {
    query: string; maxResults?: number; tokenBudget?: number;
  }): Promise<HybridSearchResult> {
    // 2. Search BM25 index
    let bm25Results: RRFResult[] = [];
    try { bm25Results = (memoryIndex.searchBM25(query, maxResults) || []).map(r => ({ id: `bm25-${r.id}`, score: r.score, text: r.text, loopNum: 1 })); } catch { /* ignore */ }

    // 3. Search Vector index (if initialized and has vectors)
    let vectorResults: RRFResult[] = [];
    try {
      if (vectorIndex.size > 0) {
        const vecResults = await vectorIndex.search(query, maxResults);
        vectorResults = vecResults.map(r => ({ id: `vec-${r.id}`, score: r.score, text: r.text, metadata: r.metadata, loopNum: r.metadata?.loopNum || 1 }));
      }
    } catch { /* ignore */ }

    // 3b. Search v6.3 Harmonic Index (tier-agnostic)
    let harmonicResults: any[] = [];
    try {
      harmonicResults = (harmonicIndex.search(query, maxResults) || []).map((e: any) => ({
        id: `harmonic-${e.id}`,
        score: e.energy * 0.8,
        text: e.primary_abstraction + ' ' + e.cue_anchors.join(' '),
        loopNum: 1,
        metadata: { tier: e.tier, type: e.type }
      }));
    } catch { /* ignore */ }

    // 4. Read parametric deltas from store
    let parametricDeltas: any[] = [];
    try { parametricDeltas = parametricStore.match({ domain: 'any' }); } catch { /* ignore */ }

    // 5. Read review files for episodic memories
    const reviewFiles: any[] = [];
    try {
      const reviewsDir = path.join(mafwDir, 'reviews');
      if (fs.existsSync(reviewsDir)) {
        const files = fs.readdirSync(reviewsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
          const content = fs.readFileSync(path.join(reviewsDir, f), 'utf-8');
          const loopMatch = f.match(/loop(\d+)/);
          const loopNum = loopMatch ? parseInt(loopMatch[1]) : 1;
          const verdictMatch = content.match(/verdict:\s*(\w+)/i);
          const verdict = verdictMatch ? verdictMatch[1] : 'unknown';
          reviewFiles.push({ id: f.replace('.md', ''), content, verdict, loopNum, energy: 0.5 });
        }
      }
    } catch { /* ignore */ }

    // 6. RRF fusion
    const fused = reciprocalRankFusion(60, bm25Results, vectorResults, harmonicResults);
    const diversified = diversifyByLoop(fused, 3);

    // 7. Build categorized result sets
    const semantic: HybridSearchResult['semantic'] = [];
    const procedural: HybridSearchResult['procedural'] = [];
    const parametric: HybridSearchResult['parametric'] = [];
    const episodic: HybridSearchResult['episodic'] = [];

    for (const item of diversified) {
      const meta = item.metadata || {};
      const type = meta.type || '';
      if (type === 'pattern' || item.id.startsWith('pattern-')) {
        procedural.push({ id: item.id, score: item.score, pattern: item.text || '', successRate: meta.successRate || 0.5, energy: meta.energy || 0.5 });
      } else if (type === 'constraint' || type === 'prompt' || type === 'parametric') {
        parametric.push({ id: item.id, score: item.score, content: item.text || '', energy: meta.energy || 0.5, type });
      } else if (type === 'review' || type === 'episodic') {
        episodic.push({ id: item.id, score: item.score, summary: item.text || '', verdict: meta.verdict || 'unknown', energy: meta.energy || 0.5 });
      } else {
        semantic.push({ id: item.id, score: item.score, facts: item.text ? [item.text] : [], concepts: meta.concepts || [], energy: meta.energy || 0.5 });
      }
    }

    for (const d of parametricDeltas) {
      parametric.push({ id: d.id || `delta-${parametric.length}`, score: d.energy_score || 0.5, content: d.rule || d.prompt_delta || d.pattern_template || '', energy: d.energy_score || 0.5, type: d.type || 'constraint' });
    }

    for (const r of reviewFiles) {
      episodic.push({ id: r.id, score: 0.5, summary: r.content.substring(0, 200), verdict: r.verdict, energy: r.energy });
    }

    // 8a. Record associations in cognitive graph
    if (cognitiveGraph) {
      const allResultIds: string[] = [];
      for (const r of [...bm25Results, ...vectorResults, ...harmonicResults]) {
        const id = (r.id || '').replace(/^(bm25|vec|harmonic)-/, '');
        if (id) allResultIds.push(id);
      }
      for (let i = 0; i < allResultIds.length; i++) {
        for (let j = i + 1; j < allResultIds.length; j++) {
          cognitiveGraph.addConnection(allResultIds[i], allResultIds[j]);
        }
      }
    }

    // 8b. Apply token budget
    const allocated = tokenBudgetAllocator.allocate({ parametric: parametric as any, procedural: procedural as any, semantic: semantic as any, episodic: episodic as any }, tokenBudget);

    return {
      semantic: allocated.semantic as any,
      procedural: allocated.procedural as any,
      parametric: allocated.parametric as any,
      episodic: allocated.episodic as any,
      totalTokens: allocated.totalTokens
    };
  }

  async function executeGetDeltas({ goalId, phase, maxResults = 5 }: { goalId?: string; phase?: string; maxResults?: number }): Promise<{ deltas: any[] }> {
    try {
      const matchCtx: any = {};
      if (phase) matchCtx.loopStage = phase;
      if (goalId) matchCtx.goalKeywords = [goalId];
      if (phase) matchCtx.domain = phase;
      const deltas = parametricStore.match(matchCtx);
      return { deltas: deltas.slice(0, maxResults) };
    } catch { return { deltas: [] }; }
  }

  return {
    // 鈹€鈹€ 閰嶇疆 鈹€鈹€
    config: async (config: any) => {
      config.mafw = {
        gatewayPort: config.dashboard.port,
        maxLoops: 5,
        heartbeatTimeout: 300000,
        agents: {
          plan: 'mafw-plan',
          execute: 'mafw-execute',
          review: 'mafw-review'
        }
      };
    },

    // 鈹€鈹€ V5 鍥涘眰璁板繂鑷姩娉ㄥ叆 User Message锛圚ybrid Search + 鍚戝悗鍏煎锛夆攢鈹€
    'experimental.chat.messages.transform': async (input: any, output: any) => {
      const messages = output.messages || [];
      const firstUser = messages.find((m: any) => m.info?.role === 'user');
      if (!firstUser?.parts?.[0]?.text) return;

      // First-turn-only dedup: real messages always carry info.id; without one
      // (tests / degraded payloads) we still inject but skip dedup.
      const firstUserId = firstUser?.info?.id as string | undefined;
      if (firstUserId) {
        if (injectedFirstUser.has(firstUserId)) return;
        injectedFirstUser.set(firstUserId, '1');
      }

      const text = firstUser.parts[0].text;

      // 瑙ｆ瀽 goalId 锟?phase
      let goalId: string | null = null;
      let phase: string | null = null;

      const skillMatch = text.match(/\/skill mafw-(\w+) (\S+)/);
      if (skillMatch) {
        phase = skillMatch[1];   // 'plan' | 'execute' | 'review'
        goalId = skillMatch[2];  // '001-auth'
      }

      const goalCmdMatch = text.match(/\/goal (.+)/);
      if (goalCmdMatch) {
        goalId = await findPendingGoal(directory);
        phase = 'plan';
      }

      // 1. V5 Hybrid search (try; fall back to existing logic)
      let hybridResults: HybridSearchResult | null = null;
      try { hybridResults = await executeHybridSearch({ query: text, maxResults: 10, tokenBudget: 2000 }); } catch { /* ignore search failures */ }

      // 2. 璇诲彇璁板繂锛堜笉锟?goal 缁戝畾锟?
      let deltas: any[] = [];
      let lessons: any[] = [];
      let state: any = null;
      try {
        const matchCtx: any = {};
        if (phase) matchCtx.loopStage = phase;
        if (goalId) matchCtx.goalKeywords = [goalId];
        if (phase) matchCtx.domain = phase;
        deltas = parametricStore.match(matchCtx);
      } catch { /* ignore */ }
      if (goalId) {
        try { lessons = memoryIndex.search([goalId], phase ?? undefined, 3); } catch { /* ignore */ }
        try { state = await loadState(goalId, directory); } catch { /* ignore */ }
      }

      const waveContext = state?.currentWave && state.currentWave > 0
        ? `Wave ${state.currentWave}/${state.totalWaves || '?'}`
        : '';

      // 3. Build memory block
      const parts: string[] = [];

      const hasHybridResults = hybridResults && (
        hybridResults.parametric.length > 0 ||
        hybridResults.procedural.length > 0 ||
        hybridResults.semantic.length > 0 ||
        hybridResults.episodic.length > 0
      );

      if (hasHybridResults) {
        // V5 enhanced pipeline: token-budgeted hybrid results
        const allocated = tokenBudgetAllocator.allocate({
          parametric: [...deltas, ...(hybridResults!.parametric || [])],
          procedural: hybridResults!.procedural || [],
          semantic: hybridResults!.semantic || [],
          episodic: hybridResults!.episodic || []
        }, 2000);

        const blocks = renderMemoryBlocks([
          ...allocated.parametric.map((d: any) => ({ source: 'parametric', type: d.type || 'constraint', content: d.content || d.rule || '' })),
          ...allocated.procedural.map((p: any) => ({ source: 'procedural', type: 'pattern', pattern: p.pattern || '', successRate: p.successRate })),
          ...allocated.semantic.map((s: any) => ({ source: 'semantic', type: 'fact', facts: s.facts || [] })),
          ...allocated.episodic.map((e: any) => ({ source: 'episodic', type: 'history', summary: e.summary || e.content || '', verdict: e.verdict, loopNum: e.loopNum })),
        ]);
        parts.push(...blocks);
      } else {
        // Fall back to v4.1 simple injection
        if (deltas.length > 0) {
          parts.push('<deltas>',
            ...deltas.map((d: any) => `[Δ ${d.type}] ${d.id} (energy=${d.energy || 0.5}): ${(d as any).rule || (d as any).prompt_delta || (d as any).pattern_template || ''}`),
            '</deltas>');
        }
        if (lessons.length > 0) {
          parts.push('<lessons>',
            ...lessons.map((l: any) => `[Lesson] ${typeof l === 'string' ? l : l.content || ''}`),
            '</lessons>');
        }
        if (waveContext) {
          parts.push('<context>', waveContext, '</context>');
        }
      }

      parts.push(text);
      firstUser.parts[0].text = parts.join('\n\n');
    },

    // 鈹€鈹€ 鑷畾涔夊懡锟?鈹€鈹€
    command: {
      goal: {
        description: 'Submit a new Goal to MAFW',
        async execute(args: string, context: any) {
          const result = await context.runSkill('mafw-goal', { text: args });
          if (result?.confirmed) {
            await writeGoalRequest(result, directory);
            return {
              type: 'goal_submitted',
              goalId: result.goalId,
              message: `锟?Goal "${result.title}" confirmed\n馃搧 requests/${result.goalId}.json\n馃搳 state/${result.goalId}.json\n锟?Gateway will auto-schedule...\n\n馃挕 Tip: TUI can be closed, Goal runs in background.`
            };
          }
        }
      },
      status: {
        description: 'Show MAFW dashboard status',
        async execute(args: string, context: any) {
          try {
            const statusPath = path.join(mafwDir, 'STATUS.md');
            if (!fs.existsSync(statusPath)) {
              return { text: 'No active Goals. Use /goal to create one.' };
            }
            const content = fs.readFileSync(statusPath, 'utf-8');
            return { text: content };
          } catch (err: any) {
            return { text: `Error: ${err.message}` };
          }
        }
      },
      'mafw-loop': {
        description: 'Trigger MAFW plan for a goal',
        async execute(args: string, context: any) {
          const goalId = args.trim();
          return await context.runSkill('mafw-plan', { goalId });
        }
      },
      triage: {
        description: 'List pending triage items',
        async execute(args: string, context: any) {
          const triageDir = path.join(mafwDir, 'triage');
          if (!fs.existsSync(triageDir)) return { type: 'triage_list', items: [] };
          const files = fs.readdirSync(triageDir).filter(f => f.endsWith('.json'));
          const pending = [];
          for (const file of files) {
            const item = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
            if (item.state === 'PENDING_CONFIRMATION') pending.push(item);
          }
          return { type: 'triage_list', items: pending, actions: ['confirm', 'ignore', 'edit'] };
        }
      },
      'triage-confirm': {
        description: 'Confirm a triage item',
        async execute(args: string, context: any) {
          const triageId = args.trim();
          fs.writeFileSync(
            path.join(mafwDir, 'control'),
            JSON.stringify({ action: 'CONFIRM_TRIAGE', triageId })
          );
          return { type: 'triage_confirming', triageId };
        }
      },
      'automation-add': {
        description: 'Add a new automation rule',
        async execute(args: string, context: any) {
          return { type: 'automation_add', message: 'Use automations/*.json to configure rules' };
        }
      },
      'automation-list': {
        description: 'List all automation rules',
        async execute(args: string, context: any) {
          const autoDir = path.join(mafwDir, 'automations');
          if (!fs.existsSync(autoDir)) return { type: 'automation_list', rules: [] };
          const files = fs.readdirSync(autoDir).filter(f => f.endsWith('.json'));
          const rules = files.map(f => JSON.parse(fs.readFileSync(path.join(autoDir, f), 'utf-8')));
          return { type: 'automation_list', rules };
        }
      },
      'automation-toggle': {
        description: 'Toggle automation rule on/off',
        async execute(args: string, context: any) {
          const [autoId, enabledStr] = args.trim().split(' ');
          const filePath = path.join(mafwDir, 'automations', `${autoId}.json`);
          const rule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          rule.enabled = enabledStr === 'true';
          fs.writeFileSync(filePath, JSON.stringify(rule, null, 2));
          fs.writeFileSync(path.join(mafwDir, 'control'), JSON.stringify({ action: 'RELOAD_AUTOMATIONS' }));
          return { type: 'automation_toggled', autoId, enabled: rule.enabled };
        }
      },
      'merge-memory': {
        description: 'Merge memories from another worktree into the current project',
        async execute(args: string, context: any) {
          try {
            const parts = args.trim().split(/\s+/);
            const sourceWorktree = parts[0];
            const resolveStrategy = parts[1] || 'manual';
            if (!sourceWorktree) {
              return { text: 'Usage: /merge-memory <sourceWorktreePath> [strategy]\nstrategy: manual (default) | higher_energy | newer' };
            }

            const { MinHashMerger } = await import('./memory/minhash-merger.js');
            const { generateHarmonicId } = await import('./memory/harmonic-types.js');
            const { HarmonicUnitFileStore } = await import('../memory/harmonic-file-store.js');

            const sourceMafwDir = path.join(sourceWorktree, '.mafw');
            const targetMafwDir = mafwDir;
            const sourceMemPath = path.join(sourceMafwDir, 'memory', 'memories.json');

            if (!fs.existsSync(sourceMemPath)) {
              return { text: `No memories found at ${sourceMemPath}` };
            }

            const sourceUnits: any[] = JSON.parse(fs.readFileSync(sourceMemPath, 'utf-8'));
            const minhash = new MinHashMerger();
            const store = new HarmonicUnitFileStore(targetMafwDir);
            const targetIndex = store.indexManager_().getIndex();
            let added = 0;
            let conflicts = 0;

            for (const srcUnit of sourceUnits) {
              if (srcUnit.type === 'episodic') continue;
              const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
              let bestSim = 0;
              for (const tgtEntry of targetIndex.entries) {
                const tgtSig = minhash.generateSignature(tgtEntry.primary_abstraction || '');
                const sim = minhash.similarity(srcSig, tgtSig);
                if (sim > bestSim) bestSim = sim;
              }
              if (bestSim > 0.6) { conflicts++; }
              else {
                srcUnit.id = generateHarmonicId();
                srcUnit.energy = 0.4;
                srcUnit.merged_from = [srcUnit.id];
                const now = new Date().toISOString();
                srcUnit.created_at = now;
                srcUnit.updated_at = now;
                await store.write(srcUnit);
                added++;
              }
            }

            return { text: `Memory merge complete.\n  Added: ${added} new memories (energy=0.4)\n  Conflicts: ${conflicts}\n  Fusion log: .mafw/fusion-log.jsonl` };
          } catch (err: any) {
            return { text: `Error: ${err.message}` };
          }
        }
      },
      'worktree-list': {
        description: 'List all active git worktrees',
        async execute(args: string, context: any) {
          try {
            const { GoalWorktreeManager } = await import('./engine/goal-worktree-manager.js');
            const mgr = new GoalWorktreeManager(directory);
            const trees = await mgr.listWorktrees();
            if (trees.length === 0) return { text: 'No worktrees found.' };
            const lines = trees.map(t => `${t.path}  [${t.branch}]${t.head ? ' ' + t.head : ''}`);
            return { text: lines.join('\n') };
          } catch (err: any) {
            return { text: `Error: ${err.message}` };
          }
        }
      },
      'worktree-prune': {
        description: 'Prune stale git worktree records',
        async execute(args: string, context: any) {
          try {
            const { GoalWorktreeManager } = await import('./engine/goal-worktree-manager.js');
            const mgr = new GoalWorktreeManager(directory);
            await mgr.prune();
            return { text: 'Worktree records pruned.' };
          } catch (err: any) {
            return { text: `Error: ${err.message}` };
          }
        }
      },
    },

    // 鈹€鈹€ Hook aliases for OpenCode v4.1 format (delegated to HookManager) 鈹€鈹€
    hooks: {
      'session.end': (ctx: any) => hookManager.execute('session.end', ctx),
      'tool.execute.before': (ctx: any) => hookManager.execute('tool.execute.before', ctx),
      'tool.execute.after': (ctx: any, result: any) => hookManager.execute('tool.execute.after', { ...ctx, data: result }),
      'chat.message': (ctx: any) => {
        hookManager.execute('user.prompt.submit', ctx);
        return { message: ctx.message, parts: ctx.parts };
      },
    },

    // 鈹€鈹€ Session 鍘嬬缉鍓嶏細淇濆瓨鐘舵€佸揩锟?鈹€鈹€
    'experimental.session.compacting': async ({ sessionID }: any, { snapshot }: any) => {
      await hookManager.execute('session.compacting', { sessionID, projectDir: directory });
    },

    'experimental.text.complete': async ({ sessionID, messageID, partID }: any, result: any) => {
      await hookManager.execute('llm.call.after', {
        sessionID, messageID, partID, text: result?.text || ''
      });
    },

    // 鈹€鈹€ 浜嬩欢閽╁瓙锛歋ession 鐢熷懡鍛ㄦ湡鍏滃簳 鈹€鈹€
    event: async ({ event }: any) => {
      if (event.type === 'session.created' || event.type === 'session.start') {
        await hookManager.execute('session.start', {
          sessionId: event.info?.id || event.sessionID,
          projectDir: directory
        });
      }
    },
  };
}

// 鈹€鈹€ 鍐呴儴宸ュ叿鍑芥暟 鈹€鈹€

async function ensureMafwDirectories(mafwDir: string) {
  const dirs = [
    'state', 'requests', 'goals', 'waves', 'tasks',
    'lessons', 'handoffs', 'receipts', 'reviews', 'reports',
    'checkpoints', 'decisions', 'triage', 'automations', 'cost',
    'parametric/prompt-deltas', 'parametric/constraint-deltas',
    'parametric/pattern-deltas', 'parametric/banned',
    'memory/tier1',
    'logs'
  ];
  for (const dir of dirs) {
    const fullPath = path.join(mafwDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const manifestPath = path.join(mafwDir, 'parametric', 'base-skill-manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, 'manifest_version: 1\nmerged_deltas: []\n', 'utf-8');
  }
}

async function registerWithGateway(directory: string, mafwDir: string) {
  const payload = {
    projectDir: directory,
    mafwDir,
    pluginVersion: '4.1',
    timestamp: new Date().toISOString()
  };

  const registryDir = path.join(mafwDir, 'registry');
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }

  const registryFile = path.join(registryDir, 'plugin.json');
  fs.writeFileSync(registryFile, JSON.stringify(payload, null, 2), 'utf-8');
  log.info(`[MAFW] Registered via filesystem: ${registryFile}`);
}

async function findPendingGoal(directory: string): Promise<string> {
  const stateDir = path.join(directory, '.mafw', 'state');
  if (!fs.existsSync(stateDir)) return 'unknown';
  const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 'unknown';
  return files[0].replace('.json', '');
}

async function writeGoalRequest(result: any, directory: string) {
  const goalId = result.goalId;
  const mafwDir = path.join(directory, '.mafw');
  await ensureMafwDirectories(mafwDir);

  const goalsDir = path.join(mafwDir, 'goals');
  fs.writeFileSync(path.join(goalsDir, `${goalId}.md`), formatGoalCharter(result), 'utf-8');

  fs.writeFileSync(
    path.join(mafwDir, 'requests', `${goalId}.json`),
    JSON.stringify({
      version: '1', goalId, title: result.title, state: 'PENDING',
      createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
      source: 'tui', projectDir: directory, mafwDir,
      goalCharter: `goals/${goalId}.md`,
      metrics: result.metrics, boundaries: result.boundaries,
      priority: result.priority || 'normal', maxLoops: result.maxLoops || 5,
      parallel: result.parallel || false, remoteCli: result.remoteCli
    }, null, 2)
  );

  fs.writeFileSync(
    path.join(mafwDir, 'state', `${goalId}.json`),
    JSON.stringify({
      version: '2', goalId, loop: 1, phase: 'PLANNING', lastPhase: null,
      currentWave: 0, totalWaves: null, sessions: {},
      nextAction: 'CREATE_PLAN_SESSION', artifacts: {},
      updatedAt: new Date().toISOString()
    }, null, 2)
  );

  const statusPath = path.join(mafwDir, 'STATUS.md');
  const statusLine = `---\ngoalId: "${goalId}"\nstate: "PENDING"\nloop: 0\nlastHeartbeat: "${new Date().toISOString()}"\n`;
  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, `# MAFW STATUS\n\n${statusLine}`, 'utf-8');
  } else {
    fs.appendFileSync(statusPath, statusLine, 'utf-8');
  }
}

function formatGoalCharter(result: any): string {
  return `# Goal Charter 锟?${result.title}\n\n> Goal ID: ${result.goalId}\n> Created: ${new Date().toISOString()}\n> Priority: ${result.priority || 'normal'}\n> Max Loops: ${result.maxLoops || 5}\n\n## Objective\n\n${result.title}\n\n## Metrics\n\n${Object.entries(result.metrics || {}).map(([k, v]: [string, any]) => `- ${k}: ${v.target}${v.unit}`).join('\n')}\n\n## Boundaries\n\n${(result.boundaries || []).map((b: string) => `- [ ] ${b}`).join('\n')}\n`;
}


