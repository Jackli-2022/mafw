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
const session_ending_1 = require("./hooks/session-ending");
const config_loader_1 = require("./utils/config-loader");
const hook_manager_1 = require("./hooks/hook-manager");
const session_start_1 = require("./hooks/session-start");
const tool_before_1 = require("./hooks/tool-before");
const user_prompt_1 = require("./hooks/user-prompt");
const llm_after_1 = require("./hooks/llm-after");
const session_compacting_1 = require("./hooks/session-compacting");
const handoff_1 = require("./hooks/handoff");
const session_recall_1 = require("./hooks/session-recall");
const session_system_1 = require("./hooks/session-system");
function getGatewayUrl(mafwDir) {
    const configPath = path.join(mafwDir, '..', '.config', 'mafw', 'desktop-automation.json');
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return `http://127.0.0.1:${config.port}`;
        }
    }
    catch { }
    const portFile = path.join(mafwDir, '.gateway-port');
    try {
        if (fs.existsSync(portFile)) {
            return `http://127.0.0.1:${fs.readFileSync(portFile, 'utf-8').trim()}`;
        }
    }
    catch { }
    return 'http://127.0.0.1:2716';
}
async function ensureMafwDirectories(mafwDir) {
    const dirs = [mafwDir, path.join(mafwDir, 'lessons'), path.join(mafwDir, 'parametric'),
        path.join(mafwDir, 'cost'), path.join(mafwDir, 'reviews'), path.join(mafwDir, 'receipts'),
        path.join(mafwDir, 'triage'), path.join(mafwDir, 'automations'), path.join(mafwDir, 'requests'),
        path.join(mafwDir, 'reports'), path.join(mafwDir, 'goals'), path.join(mafwDir, 'handoffs'),
        path.join(mafwDir, 'decisions'), path.join(mafwDir, 'memory'), path.join(mafwDir, 'events'),
        path.join(mafwDir, 'state'), path.join(mafwDir, 'checkpoints'), path.join(mafwDir, 'tasks')];
    for (const dir of dirs) {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
}
async function registerWithGateway(directory, mafwDir) {
    const gatewayUrl = getGatewayUrl(mafwDir);
    for (let port = 3000; port <= 3010; port++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectDir: directory, mafwDir }),
                signal: AbortSignal.timeout(2000),
            });
            if (res.ok)
                return;
        }
        catch { }
    }
}
async function MafwPlugin({ directory }) {
    const mafwDir = path.join(directory, '.mafw');
    await ensureMafwDirectories(mafwDir);
    const { installFileLogging } = require('./utils/logger');
    installFileLogging(path.join(mafwDir, 'logs'));
    console.log(`[MAFW] File logging enabled: ${mafwDir}/logs/mafw.log`);
    config_loader_1.ConfigLoader.getInstance(directory).getAll();
    await registerWithGateway(directory, mafwDir);
    console.log('[MAFW] Plugin activated. All hooks registered.');
    const hookManager = new hook_manager_1.HookManager({ failBehavior: 'continue', timeout: 30000 });
    const gatewayUrl = getGatewayUrl(mafwDir);
    hookManager.register({
        name: 'session-start-handler', event: 'session.start',
        handler: async (ctx) => { const data = ctx.data || ctx; (0, session_start_1.sessionStartHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'session-end-handler', event: 'session.end',
        handler: async (ctx) => { const data = ctx.data || ctx; (0, session_ending_1.sessionEndingHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'tool-before-handler', event: 'tool.before',
        handler: async (ctx) => { const data = ctx.data || ctx; await (0, tool_before_1.toolBeforeHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'tool-executed-handler', event: 'tool.executed',
        handler: async (ctx) => {
            const data = ctx.data || ctx;
            if (data?.sessionID) {
            }
        },
        priority: 100
    });
    hookManager.register({
        name: 'user-prompt-handler', event: 'user.prompt',
        handler: async (ctx) => { const data = ctx.data || ctx; await (0, user_prompt_1.userPromptHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'llm-after-handler', event: 'llm.after',
        handler: async (ctx) => { const data = ctx.data || ctx; await (0, llm_after_1.llmAfterHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'session-compacting-handler', event: 'session.compacting',
        handler: async (ctx) => { const data = ctx.data || ctx; (0, session_compacting_1.sessionCompactingHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'session-handoff-handler', event: 'session.handoff',
        handler: async (ctx) => { const data = ctx.data || ctx; (0, handoff_1.handoffHook)(data); },
        priority: 100
    });
    hookManager.register({
        name: 'memory-recall-handler', event: 'memory.recall',
        handler: async (ctx) => {
            const { query, resultIds } = ctx.data || ctx;
        },
        priority: 100
    });
    hookManager.register({
        name: 'memory-contradiction-handler', event: 'memory.contradiction',
        handler: async (ctx) => {
            const { existingId, newId, field } = ctx.data || ctx;
        },
        priority: 100
    });
    hookManager.register({
        name: 'goal-state-change-handler', event: 'state_change',
        handler: async (ctx) => {
            const data = ctx.data || ctx;
        },
        priority: 100
    });
    hookManager.register({
        name: 'goal-created-handler', event: 'goal_created',
        handler: async (ctx) => {
            const data = ctx.data || ctx;
        },
        priority: 100
    });
    hookManager.register({
        name: 'user-feedback-handler', event: 'user_feedback',
        handler: async (ctx) => {
            const data = ctx.data || ctx;
        },
        priority: 100
    });
    return {
        config: {
            skills: [{ name: 'mafw-goal', enabled: false }, { name: 'mafw-plan', enabled: false },
                { name: 'mafw-execute', enabled: false }, { name: 'mafw-review', enabled: false }],
        },
        hooks: {
            'session.end': (ctx) => hookManager.execute('session.end', ctx),
            'tool.execute.before': (ctx) => hookManager.execute('tool.before', ctx),
            'tool.execute.after': (ctx, result) => hookManager.execute('tool.executed', { ...ctx, data: result }),
            'chat.message': (ctx) => hookManager.execute('user.prompt', ctx),
            'experimental.chat.messages.transform': (input, output) => (0, session_recall_1.sessionRecallHook)(input, output),
            'experimental.chat.system.transform': (input, output) => (0, session_system_1.sessionSystemHook)(input, output),
        },
        command: {
            goal: {
                description: 'Submit a new Goal to MAFW',
                async execute(args, context) {
                    const result = await context.runSkill('mafw-goal', { text: args });
                    if (result?.confirmed) {
                        const requestsDir = path.join(mafwDir, 'requests');
                        if (!fs.existsSync(requestsDir))
                            fs.mkdirSync(requestsDir, { recursive: true });
                        fs.writeFileSync(path.join(requestsDir, `${result.goalId}.json`), JSON.stringify(result, null, 2));
                        return { type: 'goal_submitted', goalId: result.goalId, message: `�?Goal "${result.title}" submitted` };
                    }
                }
            },
            status: {
                description: 'Show MAFW dashboard status',
                async execute(args, context) {
                    try {
                        const statusPath = path.join(mafwDir, 'STATUS.md');
                        if (!fs.existsSync(statusPath))
                            return { text: 'No active Goals. Use /goal to create one.' };
                        return { text: fs.readFileSync(statusPath, 'utf-8') };
                    }
                    catch (err) {
                        return { text: `Error: ${err.message}` };
                    }
                }
            },
            'merge-memory': {
                description: 'Merge memories from another worktree via gateway',
                async execute(args, context) {
                    const parts = args.trim().split(/\s+/);
                    const sourceWorktree = parts[0];
                    if (!sourceWorktree)
                        return { text: 'Usage: /merge-memory <sourceWorktreePath> [strategy]' };
                    try {
                        const res = await fetch(`${gatewayUrl}/api/merge-memory`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sourceWorktree, strategy: parts[1] || 'manual', mafwDir }),
                            signal: AbortSignal.timeout(30000),
                        });
                        const result = await res.json();
                        return { text: `Merge result: ${JSON.stringify(result)}` };
                    }
                    catch (err) {
                        return { text: `Error: ${err.message}` };
                    }
                }
            },
        },
    };
}
//# sourceMappingURL=plugin.js.map