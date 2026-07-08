"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MafwPlugin;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const store_1 = require("./memory/store");
const memory_index_1 = require("./compression/memory-index");
const session_pruner_1 = require("./compression/session-pruner");
const vector_index_1 = require("./compression/vector-index");
const token_budget_allocator_1 = require("./compression/token-budget-allocator");
const rrf_fusion_1 = require("./compression/rrf-fusion");
const state_1 = require("./utils/state");
const session_ending_1 = require("./hooks/session-ending");
const config_loader_1 = require("./utils/config-loader");
const hook_manager_1 = require("./hooks/hook-manager");
const retry_1 = require("./utils/retry");
const knowledge_graph_manager_1 = require("./graph/knowledge-graph-manager");
const harmonic_index_1 = require("./memory/harmonic-index");
const cognitive_graph_1 = require("./memory/cognitive-graph");
const review_scheduler_1 = require("./memory/review-scheduler");
const cost_estimator_1 = require("./cost/cost-estimator");
const session_start_1 = require("./hooks/session-start");
const tool_before_1 = require("./hooks/tool-before");
const user_prompt_1 = require("./hooks/user-prompt");
const llm_after_1 = require("./hooks/llm-after");
const session_compacting_1 = require("./hooks/session-compacting");
const handoff_1 = require("./hooks/handoff");
async function MafwPlugin({ directory }) {
    const mafwDir = path.join(directory, '.opencode', 'mafw');
    // 0. 初始化 MAFW 目录结构（插件运行时创建）
    await ensureMafwDirectories(mafwDir);
    // 0a. Load configuration
    const config = config_loader_1.ConfigLoader.getInstance(directory).getAll();
    // 1. 向 Gateway 注册项目（探测端口 3000-3010）
    await registerWithGateway(directory, mafwDir);
    console.log('[MAFW] Plugin activated. All skills loaded. All commands registered.');
    // 2. 初始化记忆层
    const parametricStore = new store_1.ParametricStore({
        baseDir: path.join(mafwDir, 'parametric'),
        bannedDir: path.join(mafwDir, 'parametric', 'banned'),
        manifestFile: path.join(mafwDir, 'parametric', 'base-skill-manifest.yaml')
    });
    const memoryIndex = new memory_index_1.MemoryIndexManager(path.join(mafwDir, 'memory-index.json'));
    const vectorIndex = new vector_index_1.VectorIndex();
    const tokenBudgetAllocator = new token_budget_allocator_1.TokenBudgetAllocator({ defaultBudget: 2000 });
    const sessionPruner = new session_pruner_1.SessionPruner({ maxContextTokens: 8000, compressionThreshold: 0.6 });
    const knowledgeGraphManager = new knowledge_graph_manager_1.KnowledgeGraphManager(path.join(mafwDir, 'knowledge-graph.json'));
    await knowledgeGraphManager.load();
    // ── Hook Manager (moved before HarmonicIndex which needs it) ──
    const hookManager = new hook_manager_1.HookManager({ failBehavior: 'continue', timeout: 30000 });
    // ── v6.3 Harmonic Index ──
    const harmonicIndex = new harmonic_index_1.HarmonicIndexManager(mafwDir, hookManager);
    // ── v6.4 Cognitive Graph (association network) ──
    const cognitiveGraph = new cognitive_graph_1.CognitiveGraphManager(mafwDir);
    // ── v6.4 Review Scheduler (spaced repetition) ──
    const reviewScheduler = new review_scheduler_1.ReviewScheduler(harmonicIndex, mafwDir);
    reviewScheduler.start();
    // ── v6.3 Auto-migration (first load) ──
    if (!fs.existsSync(path.join(mafwDir, 'memory', '.harmonic_index.json'))) {
        console.log('[MAFW] No harmonic index found, running v6.1→v6.3 migration...');
        try {
            const { migrateV61 } = require('./memory/migrate-v6.1');
            const result = await migrateV61(mafwDir, harmonicIndex);
            console.log(`[MAFW] Migration complete: ${result.migrated} migrated, ${result.errors.length} errors`);
        }
        catch (err) {
            console.error(`[MAFW] Migration failed: ${err.message}`);
        }
    }
    const toolExecutedHook = async ({ tool }, { output }) => {
        if (output && output.length > 1000) {
            console.log(`[MAFW] Compressing output for ${tool} (${output.length} chars)`);
        }
    };
    // ── Cost Estimator (Task 6) ──
    const costEstimator = new cost_estimator_1.CostEstimator();
    function persistCosts() {
        const all = costEstimator.getAllRecords();
        if (all.length === 0)
            return;
        // Write to SQLite
        try {
            const dbPath = path.join(mafwDir, 'data', 'state.db');
            if (fs.existsSync(dbPath)) {
                const { SQLiteStorage } = require('./storage/sqlite-storage');
                const storage = new SQLiteStorage(dbPath);
                storage.batch(all.map((r) => ({
                    type: 'set',
                    scope: 'cost_logs',
                    key: r.id,
                    value: r
                })));
            }
        }
        catch { }
        // Write JSON for Dashboard FS fallback
        const costDir = path.join(mafwDir, 'cost');
        if (!fs.existsSync(costDir))
            fs.mkdirSync(costDir, { recursive: true });
        const byGoal = new Map();
        for (const r of all) {
            const list = byGoal.get(r.goalId) || [];
            list.push(r);
            byGoal.set(r.goalId, list);
        }
        for (const [goalId, records] of byGoal) {
            fs.writeFileSync(path.join(costDir, `${goalId}.json`), JSON.stringify(records, null, 2), 'utf-8');
        }
    }
    hookManager.register({
        name: 'session-ending',
        event: 'session.end',
        handler: async (ctx) => {
            await (0, session_ending_1.sessionEndingHook)({ sessionId: ctx.sessionID, projectDir: directory });
        },
        priority: 100
    });
    hookManager.register({
        name: 'tool-executed',
        event: 'tool.execute.after',
        handler: async (ctx) => {
            const { tool, output } = ctx.data || ctx;
            if (output && output.length > 1000) {
                console.log(`[MAFW] Compressing output for ${tool} (${output.length} chars)`);
            }
        },
        priority: 50
    });
    hookManager.register({
        name: 'cost-recording',
        event: 'tool.execute.after',
        handler: async (ctx) => {
            const data = ctx.data || ctx;
            const { tool, input } = data;
            if (!tool)
                return;
            let goalId = 'unknown';
            let loopNum = 1;
            if (input) {
                try {
                    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
                    goalId = parsed.goalId || parsed.goal_id || goalId;
                    loopNum = parsed.loopNum || parsed.loop_num || loopNum;
                }
                catch { /* ignore parse errors */ }
            }
            if (goalId === 'unknown') {
                try {
                    const stateDir = path.join(mafwDir, 'state');
                    if (fs.existsSync(stateDir)) {
                        const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
                        if (files.length > 0)
                            goalId = files[0].replace('.json', '');
                    }
                }
                catch { /* ignore */ }
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
    // ── v6.0 Cost Threshold Hook ──
    hookManager.register({
        name: 'cost-threshold',
        event: 'session.start',
        priority: 10,
        handler: async (ctx) => {
            const allRecords = costEstimator.getAllRecords();
            const totalCost = allRecords.reduce((s, r) => s + (r.estimatedCost || 0), 0);
            const budget = config?.cost?.budget?.total || 1000000;
            const threshold = config?.cost?.budget?.threshold || 0.8;
            if (budget > 0 && totalCost / budget > threshold) {
                ctx.forceHaiku = true;
                ctx.compressInjection = true;
            }
        }
    });
    // ── Wave 1: Memory Internal Hooks ──
    hookManager.register({
        name: 'memory-write-handler',
        event: 'memory.write',
        handler: async (ctx) => {
            const { unit, tier, source } = ctx.data || ctx;
            console.log(`[hook:memory.write] ${unit?.id} -> tier ${tier} (from ${source})`);
            if (cognitiveGraph && unit) {
                if (unit.goal_id) {
                    cognitiveGraph.addConnection(unit.id, `goal:${unit.goal_id}`);
                }
            }
        },
        priority: 100
    });
    hookManager.register({
        name: 'memory-recall-handler',
        event: 'memory.recall',
        handler: async (ctx) => {
            const { query, resultIds } = ctx.data || ctx;
            console.log(`[hook:memory.recall] "${query?.substring(0, 50) || ''}" -> ${resultIds?.length || 0} results`);
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
            console.log(`[hook:memory.contradiction] ${existingId} vs ${newId} on ${field}`);
        },
        priority: 100
    });
    hookManager.register({
        name: 'memory-decay-handler',
        event: 'memory.decay',
        handler: async (ctx) => {
            const { oldEnergy, newEnergy, reason, unitId } = ctx.data || ctx;
            if (newEnergy < 0.3) {
                console.log(`[hook:memory.decay] ${unitId} fell below cleanup threshold (${newEnergy})`);
            }
        },
        priority: 100
    });
    // ── Wave 2: Session Start ──
    hookManager.register({
        name: 'session-start',
        event: 'session.start',
        handler: async (ctx) => {
            await (0, session_start_1.sessionStartHook)({ sessionId: ctx.sessionId, projectDir: directory });
        },
        priority: 5
    });
    // ── Wave 2: Tool Before ──
    hookManager.register({
        name: 'tool-before',
        event: 'tool.execute.before',
        handler: async (ctx) => {
            await (0, tool_before_1.toolBeforeHook)({ tool: ctx.tool, sessionID: ctx.sessionID, callID: ctx.callID, args: ctx.args });
        },
        priority: 100
    });
    // ── Wave 2: User Prompt ──
    hookManager.register({
        name: 'user-prompt',
        event: 'user.prompt.submit',
        handler: async (ctx) => {
            await (0, user_prompt_1.userPromptHook)({ sessionID: ctx.sessionID, text: ctx.message?.parts?.[0]?.text || '' });
        },
        priority: 50
    });
    // ── Wave 2: LLM After ──
    hookManager.register({
        name: 'llm-after',
        event: 'llm.call.after',
        handler: async (ctx) => {
            await (0, llm_after_1.llmAfterHook)({ sessionID: ctx.sessionID, text: ctx.text });
        },
        priority: 50
    });
    // ── Wave 2: Session Compacting ──
    hookManager.register({
        name: 'session-compacting',
        event: 'session.compacting',
        handler: async (ctx) => {
            await (0, session_compacting_1.sessionCompactingHook)({ sessionID: ctx.sessionID, projectDir: directory });
        },
        priority: 100
    });
    // ── Handoff detection: fires session.handoff on phase transitions ──
    hookManager.register({
        name: 'handoff-detector',
        event: 'session.end',
        priority: 90,
        handler: async (ctx) => {
            try {
                const stateDir = path.join(mafwDir, 'state');
                if (!fs.existsSync(stateDir))
                    return;
                const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
                    const session = Object.entries(state.sessions || {}).find(([_, s]) => s.id === ctx.sessionID);
                    if (!session)
                        continue;
                    const [phase] = session;
                    let nextPhase = '';
                    if (state.nextAction === 'CREATE_EXECUTE_SESSION')
                        nextPhase = 'EXECUTING';
                    else if (state.nextAction === 'CREATE_REVIEW_SESSION')
                        nextPhase = 'REVIEW';
                    else if (state.nextAction === 'CREATE_PLAN_SESSION')
                        nextPhase = 'PLANNING';
                    else if (state.nextAction === 'PASS' || state.nextAction === 'FAIL')
                        nextPhase = state.nextAction;
                    if (nextPhase) {
                        await hookManager.execute('session.handoff', {
                            from: phase,
                            to: nextPhase,
                            goalId: state.goalId,
                            context: { wave: state.currentWave, loop: state.loop }
                        });
                    }
                }
            }
            catch (err) {
                console.error(`[hook:handoff-detector] Error: ${err.message}`);
            }
        }
    });
    // ── Wave 3: Handoff ──
    hookManager.register({
        name: 'session-handoff',
        event: 'session.handoff',
        handler: async (ctx) => {
            await (0, handoff_1.handoffHook)({
                from: ctx.from,
                to: ctx.to,
                goalId: ctx.goalId,
                context: ctx.context,
                projectDir: directory
            });
        },
        priority: 100
    });
    // ── V5 Hybrid Search 工具函数 ──
    async function executeHybridSearch({ query, maxResults = 10, tokenBudget = 2000 }) {
        // 2. Search BM25 index
        let bm25Results = [];
        try {
            bm25Results = (memoryIndex.searchBM25(query, maxResults) || []).map(r => ({ id: `bm25-${r.id}`, score: r.score, text: r.text, loopNum: 1 }));
        }
        catch { /* ignore */ }
        // 3. Search Vector index (if initialized and has vectors)
        let vectorResults = [];
        try {
            if (vectorIndex.size > 0) {
                const vecResults = await vectorIndex.search(query, maxResults);
                vectorResults = vecResults.map(r => ({ id: `vec-${r.id}`, score: r.score, text: r.text, metadata: r.metadata, loopNum: r.metadata?.loopNum || 1 }));
            }
        }
        catch { /* ignore */ }
        // 3b. Search v6.3 Harmonic Index (tier-agnostic)
        let harmonicResults = [];
        try {
            harmonicResults = (harmonicIndex.search(query, maxResults) || []).map((e) => ({
                id: `harmonic-${e.id}`,
                score: e.energy * 0.8,
                text: e.primary_abstraction + ' ' + e.cue_anchors.join(' '),
                loopNum: 1,
                metadata: { tier: e.tier, memory_type: e.memory_type }
            }));
        }
        catch { /* ignore */ }
        // 4. Read parametric deltas from store
        let parametricDeltas = [];
        try {
            parametricDeltas = parametricStore.match({ domain: 'any' });
        }
        catch { /* ignore */ }
        // 5. Read review files for episodic memories
        const reviewFiles = [];
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
        }
        catch { /* ignore */ }
        // 6. RRF fusion
        const fused = (0, rrf_fusion_1.reciprocalRankFusion)(60, bm25Results, vectorResults, harmonicResults);
        const diversified = (0, rrf_fusion_1.diversifyByLoop)(fused, 3);
        // 7. Build categorized result sets
        const semantic = [];
        const procedural = [];
        const parametric = [];
        const episodic = [];
        for (const item of diversified) {
            const meta = item.metadata || {};
            const type = meta.type || '';
            if (type === 'pattern' || item.id.startsWith('pattern-')) {
                procedural.push({ id: item.id, score: item.score, pattern: item.text || '', successRate: meta.successRate || 0.5, energy: meta.energy || 0.5 });
            }
            else if (type === 'constraint' || type === 'prompt' || type === 'parametric') {
                parametric.push({ id: item.id, score: item.score, content: item.text || '', energy: meta.energy || 0.5, type });
            }
            else if (type === 'review' || type === 'episodic') {
                episodic.push({ id: item.id, score: item.score, summary: item.text || '', verdict: meta.verdict || 'unknown', energy: meta.energy || 0.5 });
            }
            else {
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
            const allResultIds = [];
            for (const r of [...bm25Results, ...vectorResults, ...harmonicResults]) {
                const id = (r.id || '').replace(/^(bm25|vec|harmonic)-/, '');
                if (id)
                    allResultIds.push(id);
            }
            for (let i = 0; i < allResultIds.length; i++) {
                for (let j = i + 1; j < allResultIds.length; j++) {
                    cognitiveGraph.addConnection(allResultIds[i], allResultIds[j]);
                }
            }
        }
        // 8b. Apply token budget
        const allocated = tokenBudgetAllocator.allocate({ parametric: parametric, procedural: procedural, semantic: semantic, episodic: episodic }, tokenBudget);
        return {
            semantic: allocated.semantic,
            procedural: allocated.procedural,
            parametric: allocated.parametric,
            episodic: allocated.episodic,
            totalTokens: allocated.totalTokens
        };
    }
    async function executeGetDeltas({ goalId, phase, maxResults = 5 }) {
        try {
            const deltas = parametricStore.match({ domain: phase, goalKeywords: [goalId], loopStage: phase, loopCount: 1 });
            return { deltas: deltas.slice(0, maxResults) };
        }
        catch {
            return { deltas: [] };
        }
    }
    return {
        // ── 配置 ──
        config: async (config) => {
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
        // ── V5 四层记忆自动注入 User Message（Hybrid Search + 向后兼容）──
        'experimental.chat.messages.transform': async (input, output) => {
            const messages = output.messages || [];
            const firstUser = messages.find((m) => m.info?.role === 'user');
            if (!firstUser?.parts?.[0]?.text)
                return;
            const text = firstUser.parts[0].text;
            // 解析 goalId 和 phase
            let goalId = null;
            let phase = null;
            const skillMatch = text.match(/\/skill mafw-(\w+) (\S+)/);
            if (skillMatch) {
                phase = skillMatch[1]; // 'plan' | 'execute' | 'review'
                goalId = skillMatch[2]; // '001-auth'
            }
            const goalCmdMatch = text.match(/\/goal (.+)/);
            if (goalCmdMatch) {
                goalId = await findPendingGoal(directory);
                phase = 'plan';
            }
            if (!goalId || !phase)
                return;
            // 1. V5 Hybrid search (try; fall back to existing logic)
            let hybridResults = null;
            try {
                hybridResults = await executeHybridSearch({ query: text, maxResults: 10, tokenBudget: 2000 });
            }
            catch { /* ignore search failures */ }
            // 2. 读取三层记忆（Plugin 直接读文件，不通过 Gateway）
            let deltas = [];
            let lessons = [];
            let state = null;
            try {
                deltas = parametricStore.match({ domain: phase, goalKeywords: [goalId], loopStage: phase, loopCount: 1 });
            }
            catch { /* ignore */ }
            try {
                lessons = memoryIndex.search([goalId], phase, 3);
            }
            catch { /* ignore */ }
            try {
                state = await (0, state_1.loadState)(goalId, directory);
            }
            catch { /* ignore */ }
            const waveContext = state?.currentWave && state.currentWave > 0
                ? `Wave ${state.currentWave}/${state.totalWaves || '?'}`
                : '';
            // 3. Build memory block
            const parts = [];
            const hasHybridResults = hybridResults && (hybridResults.parametric.length > 0 ||
                hybridResults.procedural.length > 0 ||
                hybridResults.semantic.length > 0 ||
                hybridResults.episodic.length > 0);
            if (hasHybridResults) {
                // V5 enhanced pipeline: token-budgeted hybrid results
                const allocated = tokenBudgetAllocator.allocate({
                    parametric: [...deltas, ...(hybridResults.parametric || [])],
                    procedural: hybridResults.procedural || [],
                    semantic: hybridResults.semantic || [],
                    episodic: hybridResults.episodic || []
                }, 2000);
                if (allocated.parametric.length > 0) {
                    parts.push('<mafw-deltas>', ...allocated.parametric.map((d) => `[${d.type || 'constraint'}] ${d.content || d.rule || ''}`), '</mafw-deltas>');
                }
                if (allocated.procedural.length > 0) {
                    parts.push('<mafw-patterns>', ...allocated.procedural.map((p) => `[${((p.successRate || 0) * 100).toFixed(0)}%] ${p.pattern || ''}`), '</mafw-patterns>');
                }
                if (allocated.semantic.length > 0) {
                    parts.push('<mafw-facts>', ...allocated.semantic.map((s) => `• ${(s.facts || []).join('; ')}`), '</mafw-facts>');
                }
                if (allocated.episodic.length > 0) {
                    parts.push('<mafw-history>', ...allocated.episodic.map((e) => `Loop ${e.loopNum || '?'}: ${e.verdict || '?'} — ${e.summary || e.content || ''}`), '</mafw-history>');
                }
            }
            else {
                // Fall back to v4.1 simple injection
                if (deltas.length > 0) {
                    parts.push('<mafw-deltas>', ...deltas.map((d) => `[Δ ${d.type}] ${d.id} (energy=${d.energy || 0.5}): ${d.rule || d.prompt_delta || d.pattern_template || ''}`), '</mafw-deltas>');
                }
                if (lessons.length > 0) {
                    parts.push('<mafw-lessons>', ...lessons.map((l) => `[Lesson] ${typeof l === 'string' ? l : l.content || ''}`), '</mafw-lessons>');
                }
                if (waveContext) {
                    parts.push('<mafw-context>', waveContext, '</mafw-context>');
                }
            }
            parts.push(text);
            firstUser.parts[0].text = parts.join('\n\n');
        },
        // ── 自定义命令 ──
        command: {
            goal: {
                description: 'Submit a new Goal to MAFW',
                async execute(args, context) {
                    const result = await context.runSkill('mafw-goal', { text: args });
                    if (result?.confirmed) {
                        await writeGoalRequest(result, directory);
                        return {
                            type: 'goal_submitted',
                            goalId: result.goalId,
                            message: `✅ Goal "${result.title}" confirmed\n📁 requests/${result.goalId}.json\n📊 state/${result.goalId}.json\n⏳ Gateway will auto-schedule...\n\n💡 Tip: TUI can be closed, Goal runs in background.`
                        };
                    }
                }
            },
            status: {
                description: 'Show MAFW dashboard status',
                async execute(args, context) {
                    try {
                        const statusPath = path.join(mafwDir, 'STATUS.md');
                        if (!fs.existsSync(statusPath)) {
                            return { text: 'No active Goals. Use /goal to create one.' };
                        }
                        const content = fs.readFileSync(statusPath, 'utf-8');
                        return { text: content };
                    }
                    catch (err) {
                        return { text: `Error: ${err.message}` };
                    }
                }
            },
            'mafw-loop': {
                description: 'Trigger MAFW plan for a goal',
                async execute(args, context) {
                    const goalId = args.trim();
                    return await context.runSkill('mafw-plan', { goalId });
                }
            },
            triage: {
                description: 'List pending triage items',
                async execute(args, context) {
                    const triageDir = path.join(mafwDir, 'triage');
                    if (!fs.existsSync(triageDir))
                        return { type: 'triage_list', items: [] };
                    const files = fs.readdirSync(triageDir).filter(f => f.endsWith('.json'));
                    const pending = [];
                    for (const file of files) {
                        const item = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
                        if (item.state === 'PENDING_CONFIRMATION')
                            pending.push(item);
                    }
                    return { type: 'triage_list', items: pending, actions: ['confirm', 'ignore', 'edit'] };
                }
            },
            'triage-confirm': {
                description: 'Confirm a triage item',
                async execute(args, context) {
                    const triageId = args.trim();
                    fs.writeFileSync(path.join(mafwDir, 'control'), JSON.stringify({ action: 'CONFIRM_TRIAGE', triageId }));
                    return { type: 'triage_confirming', triageId };
                }
            },
            'automation-add': {
                description: 'Add a new automation rule',
                async execute(args, context) {
                    return { type: 'automation_add', message: 'Use automations/*.json to configure rules' };
                }
            },
            'automation-list': {
                description: 'List all automation rules',
                async execute(args, context) {
                    const autoDir = path.join(mafwDir, 'automations');
                    if (!fs.existsSync(autoDir))
                        return { type: 'automation_list', rules: [] };
                    const files = fs.readdirSync(autoDir).filter(f => f.endsWith('.json'));
                    const rules = files.map(f => JSON.parse(fs.readFileSync(path.join(autoDir, f), 'utf-8')));
                    return { type: 'automation_list', rules };
                }
            },
            'automation-toggle': {
                description: 'Toggle automation rule on/off',
                async execute(args, context) {
                    const [autoId, enabledStr] = args.trim().split(' ');
                    const filePath = path.join(mafwDir, 'automations', `${autoId}.json`);
                    const rule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    rule.enabled = enabledStr === 'true';
                    fs.writeFileSync(filePath, JSON.stringify(rule, null, 2));
                    fs.writeFileSync(path.join(mafwDir, 'control'), JSON.stringify({ action: 'RELOAD_AUTOMATIONS' }));
                    return { type: 'automation_toggled', autoId, enabled: rule.enabled };
                }
            }
        },
        // ── Hook aliases for OpenCode v4.1 format (delegated to HookManager) ──
        hooks: {
            'session.end': (ctx) => hookManager.execute('session.end', ctx),
            'tool.execute.before': (ctx) => hookManager.execute('tool.execute.before', ctx),
            'tool.execute.after': (ctx, result) => hookManager.execute('tool.execute.after', { ...ctx, data: result }),
            'chat.message': (ctx) => {
                hookManager.execute('user.prompt.submit', ctx);
                return { message: ctx.message, parts: ctx.parts };
            },
        },
        // ── Session 压缩前：保存状态快照 ──
        'experimental.session.compacting': async ({ sessionID }, { snapshot }) => {
            await hookManager.execute('session.compacting', { sessionID, projectDir: directory });
        },
        'experimental.text.complete': async ({ sessionID, messageID, partID }, result) => {
            await hookManager.execute('llm.call.after', {
                sessionID, messageID, partID, text: result?.text || ''
            });
        },
        // ── 事件钩子：Session 生命周期兜底 ──
        event: async ({ event }) => {
            if (event.type === 'session.created' || event.type === 'session.start') {
                await hookManager.execute('session.start', {
                    sessionId: event.info?.id || event.sessionID,
                    projectDir: directory
                });
            }
        },
    };
}
// ── 内部工具函数 ──
async function ensureMafwDirectories(mafwDir) {
    const dirs = [
        'state', 'requests', 'goals', 'waves', 'tasks',
        'lessons', 'handoffs', 'receipts', 'reviews', 'reports',
        'checkpoints', 'decisions', 'triage', 'automations', 'cost',
        'parametric/prompt-deltas', 'parametric/constraint-deltas',
        'parametric/pattern-deltas', 'parametric/banned'
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
async function registerWithGateway(directory, mafwDir) {
    const payload = {
        projectDir: directory,
        mafwDir,
        pluginVersion: '4.1',
        timestamp: new Date().toISOString()
    };
    for (let port = 3000; port <= 3010; port++) {
        try {
            const res = await (0, retry_1.withRetry)(() => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }), { maxRetries: 2 });
            if (res.ok) {
                await (0, retry_1.withRetry)(() => fetch(`http://127.0.0.1:${port}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }), { maxRetries: 2 });
                console.log(`[MAFW] Registered with Gateway @ localhost:${port}`);
                return;
            }
        }
        catch (e) { }
    }
    console.warn(`
[MAFW] ⚠️ Gateway not running
  Please run: npx mafw-gateway start
  Or register system service: npx mafw-gateway service-register
  Goal submission will write to filesystem, Gateway will take over when started.
`);
}
async function findPendingGoal(directory) {
    const stateDir = path.join(directory, '.opencode', 'mafw', 'state');
    if (!fs.existsSync(stateDir))
        return 'unknown';
    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    if (files.length === 0)
        return 'unknown';
    return files[0].replace('.json', '');
}
async function writeGoalRequest(result, directory) {
    const goalId = result.goalId;
    const mafwDir = path.join(directory, '.opencode', 'mafw');
    await ensureMafwDirectories(mafwDir);
    const goalsDir = path.join(mafwDir, 'goals');
    fs.writeFileSync(path.join(goalsDir, `${goalId}.md`), formatGoalCharter(result), 'utf-8');
    fs.writeFileSync(path.join(mafwDir, 'requests', `${goalId}.json`), JSON.stringify({
        version: '1', goalId, title: result.title, state: 'PENDING',
        createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
        source: 'tui', projectDir: directory, mafwDir,
        goalCharter: `goals/${goalId}.md`,
        metrics: result.metrics, boundaries: result.boundaries,
        priority: result.priority || 'normal', maxLoops: result.maxLoops || 5,
        parallel: result.parallel || false, remoteCli: result.remoteCli
    }, null, 2));
    fs.writeFileSync(path.join(mafwDir, 'state', `${goalId}.json`), JSON.stringify({
        version: '2', goalId, loop: 1, phase: 'PLANNING', lastPhase: null,
        currentWave: 0, totalWaves: null, sessions: {},
        nextAction: 'CREATE_PLAN_SESSION', artifacts: {},
        updatedAt: new Date().toISOString()
    }, null, 2));
    const statusPath = path.join(mafwDir, 'STATUS.md');
    const statusLine = `---\ngoalId: "${goalId}"\nstate: "PENDING"\nloop: 0\nlastHeartbeat: "${new Date().toISOString()}"\n`;
    if (!fs.existsSync(statusPath)) {
        fs.writeFileSync(statusPath, `# MAFW STATUS\n\n${statusLine}`, 'utf-8');
    }
    else {
        fs.appendFileSync(statusPath, statusLine, 'utf-8');
    }
}
function formatGoalCharter(result) {
    return `# Goal Charter — ${result.title}\n\n> Goal ID: ${result.goalId}\n> Created: ${new Date().toISOString()}\n> Priority: ${result.priority || 'normal'}\n> Max Loops: ${result.maxLoops || 5}\n\n## Objective\n\n${result.title}\n\n## Metrics\n\n${Object.entries(result.metrics || {}).map(([k, v]) => `- ${k}: ${v.target}${v.unit}`).join('\n')}\n\n## Boundaries\n\n${(result.boundaries || []).map((b) => `- [ ] ${b}`).join('\n')}\n`;
}
//# sourceMappingURL=plugin.js.map