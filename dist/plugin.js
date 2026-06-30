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
const state_1 = require("./utils/state");
const session_ending_1 = require("./hooks/session-ending");
/**
 * MAFW Plugin — OpenCode Official Format v4.1
 *
 * Architecture: §8.1
 * Returns an object with config, command, tool, hooks.
 * No activate() function. No registerSkill/registerCommand API.
 */
async function MafwPlugin({ directory }) {
    const mafwDir = path.join(directory, '.opencode', 'mafw');
    // 0. 初始化 MAFW 目录结构（插件运行时创建）
    await ensureMafwDirectories(mafwDir);
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
    const sessionPruner = new session_pruner_1.SessionPruner({ maxContextTokens: 8000, compressionThreshold: 0.6 });
    const toolExecutedHook = async ({ tool }, { output }) => {
        if (output && output.length > 1000) {
            console.log(`[MAFW] Compressing output for ${tool} (${output.length} chars)`);
        }
    };
    return {
        // ── 配置 ──
        config: async (config) => {
            config.mafw = {
                gatewayPort: 3000,
                maxLoops: 5,
                heartbeatTimeout: 300000,
                agents: {
                    plan: 'mafw-plan',
                    execute: 'mafw-execute',
                    review: 'mafw-review'
                }
            };
        },
        // ── 三层记忆自动注入 User Message ──
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
            // 读取三层记忆（Plugin 直接读文件，不通过 Gateway）
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
            // 注入到 user message
            const parts = [];
            if (deltas.length > 0) {
                parts.push('<mafw-deltas>', ...deltas.map((d) => `[Δ ${d.type}] ${d.id} (energy=${d.energy || 0.5}): ${d.rule || d.prompt_delta || d.pattern_template || ''}`), '</mafw-deltas>');
            }
            if (lessons.length > 0) {
                parts.push('<mafw-lessons>', ...lessons.map((l) => `[Lesson] ${typeof l === 'string' ? l : l.content || ''}`), '</mafw-lessons>');
            }
            if (waveContext) {
                parts.push('<mafw-context>', waveContext, '</mafw-context>');
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
        // ── Tools ──
        tool: {
            mafw_update_state: {
                description: 'Update the state file for a Goal. Call this after completing a phase.',
                parameters: {
                    type: 'object',
                    properties: {
                        goalId: { type: 'string' },
                        patch: {
                            type: 'object',
                            description: 'Partial state update. Must include phase, nextAction, and optionally artifacts/metrics.'
                        }
                    },
                    required: ['goalId', 'patch']
                },
                async execute({ goalId, patch }) {
                    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
                    const current = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
                    fs.writeFileSync(statePath, JSON.stringify(updated, null, 2));
                    return { updated, path: statePath };
                }
            },
            mafw_load_state: {
                description: 'Load the current state file for a Goal',
                parameters: {
                    type: 'object',
                    properties: { goalId: { type: 'string' } },
                    required: ['goalId']
                },
                async execute({ goalId }) {
                    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
                    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
                    return state;
                }
            }
        },
        // ── Hook aliases for OpenCode v4.1 format ──
        hooks: {
            'session.end': async ({ sessionID }) => {
                await (0, session_ending_1.sessionEndingHook)({ sessionId: sessionID, projectDir: directory });
            },
            'tool.execute.after': toolExecutedHook
        },
        // ── Session 压缩前：保存状态快照 ──
        'experimental.session.compacting': async ({ sessionID }, { snapshot }) => {
            // 简化实现：记录日志，不做复杂操作
            console.log(`[MAFW] Session compacting: ${sessionID}`);
        },
        // ── 事件钩子：Session 生命周期兜底 ──
        event: async ({ event }) => {
            if (event.type === 'session.start') {
                console.log('[MAFW] Session started:', event.sessionID);
            }
            if (event.type === 'session.end') {
                await sessionEndingFallback(event.sessionID, mafwDir);
            }
        }
    };
}
// ── 内部工具函数 ──
async function ensureMafwDirectories(mafwDir) {
    const dirs = [
        'state', 'requests', 'goals', 'waves', 'tasks',
        'lessons', 'handoffs', 'receipts', 'reviews', 'reports',
        'checkpoints', 'decisions', 'triage', 'automations',
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
async function registerWithGateway(directory, mafwDir, retries = 3) {
    const payload = {
        projectDir: directory,
        mafwDir,
        pluginVersion: '4.1',
        timestamp: new Date().toISOString()
    };
    for (let port = 3000; port <= 3010; port++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
            if (res.ok) {
                await fetch(`http://127.0.0.1:${port}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
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
async function sessionEndingFallback(sessionId, mafwDir) {
    const stateDir = path.join(mafwDir, 'state');
    if (!fs.existsSync(stateDir))
        return;
    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    let targetGoalId = null;
    let targetPhase = null;
    for (const file of files) {
        try {
            const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
            for (const [phase, session] of Object.entries(state.sessions || {})) {
                const sess = session;
                if (sess.id === sessionId && sess.active) {
                    targetGoalId = state.goalId;
                    targetPhase = phase;
                    break;
                }
            }
            if (targetGoalId)
                break;
        }
        catch { }
    }
    if (!targetGoalId)
        return;
    const statePath = path.join(stateDir, `${targetGoalId}.json`);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
        console.warn(`[MAFW] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`);
        const updated = {
            ...state,
            nextAction: `CREATE_${targetPhase.toUpperCase()}_SESSION`,
            error: 'session_ended_without_state_update',
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(statePath, JSON.stringify(updated, null, 2));
    }
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