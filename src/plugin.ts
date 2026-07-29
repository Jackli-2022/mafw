import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState } from './utils/state';
import { sessionEndingHook } from './hooks/session-ending';
import { ConfigLoader } from './utils/config-loader';
import { HookManager } from './hooks/hook-manager';
import { sessionStartHook } from './hooks/session-start';
import { toolBeforeHook } from './hooks/tool-before';
import { userPromptHook } from './hooks/user-prompt';
import { llmAfterHook } from './hooks/llm-after';
import { sessionCompactingHook } from './hooks/session-compacting';
import { handoffHook } from './hooks/handoff';

function getGatewayUrl(mafwDir: string): string {
  const configPath = path.join(mafwDir, '..', '.config', 'mafw', 'desktop-automation.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return `http://127.0.0.1:${config.port}`;
    }
  } catch {}
  const portFile = path.join(mafwDir, '.gateway-port');
  try {
    if (fs.existsSync(portFile)) {
      return `http://127.0.0.1:${fs.readFileSync(portFile, 'utf-8').trim()}`;
    }
  } catch {}
  return 'http://127.0.0.1:2716';
}

async function ensureMafwDirectories(mafwDir: string) {
  const dirs = [mafwDir, path.join(mafwDir, 'lessons'), path.join(mafwDir, 'parametric'),
    path.join(mafwDir, 'cost'), path.join(mafwDir, 'reviews'), path.join(mafwDir, 'receipts'),
    path.join(mafwDir, 'triage'), path.join(mafwDir, 'automations'), path.join(mafwDir, 'requests'),
    path.join(mafwDir, 'reports'), path.join(mafwDir, 'goals'), path.join(mafwDir, 'handoffs'),
    path.join(mafwDir, 'decisions'), path.join(mafwDir, 'memory'), path.join(mafwDir, 'events'),
    path.join(mafwDir, 'state'), path.join(mafwDir, 'checkpoints'), path.join(mafwDir, 'tasks')];
  for (const dir of dirs) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
}

async function registerWithGateway(directory: string, mafwDir: string) {
  const gatewayUrl = getGatewayUrl(mafwDir);
  for (let port = 3000; port <= 3010; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: directory, mafwDir }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {}
  }
}

export default async function MafwPlugin({ directory }: { directory: string }) {
  const mafwDir = path.join(directory, '.mafw');
  await ensureMafwDirectories(mafwDir);

  const { installFileLogging } = require('./utils/logger');
  installFileLogging(path.join(mafwDir, 'logs'));
  console.log(`[MAFW] File logging enabled: ${mafwDir}/logs/mafw.log`);

  ConfigLoader.getInstance(directory).getAll();
  await registerWithGateway(directory, mafwDir);
  console.log('[MAFW] Plugin activated. All hooks registered.');

  const hookManager = new HookManager({ failBehavior: 'continue', timeout: 30000 });
  const gatewayUrl = getGatewayUrl(mafwDir);

  hookManager.register({
    name: 'session-start-handler', event: 'session.start',
    handler: async (ctx) => { const data = ctx.data || ctx; sessionStartHook(data); },
    priority: 100
  });
  hookManager.register({
    name: 'session-end-handler', event: 'session.end',
    handler: async (ctx) => { const data = ctx.data || ctx; sessionEndingHook(data); },
    priority: 100
  });
  hookManager.register({
    name: 'tool-before-handler', event: 'tool.before',
    handler: async (ctx) => { const data = ctx.data || ctx; await toolBeforeHook(data); },
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
    handler: async (ctx) => { const data = ctx.data || ctx; await userPromptHook(data); },
    priority: 100
  });
  hookManager.register({
    name: 'llm-after-handler', event: 'llm.after',
    handler: async (ctx) => { const data = ctx.data || ctx; await llmAfterHook(data); },
    priority: 100
  });
  hookManager.register({
    name: 'session-compacting-handler', event: 'session.compacting',
    handler: async (ctx) => { const data = ctx.data || ctx; sessionCompactingHook(data); },
    priority: 100
  });
  hookManager.register({
    name: 'session-handoff-handler', event: 'session.handoff',
    handler: async (ctx) => { const data = ctx.data || ctx; handoffHook(data); },
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
      'session.end': (ctx: any) => hookManager.execute('session.end', ctx),
      'tool.execute.before': (ctx: any) => hookManager.execute('tool.before', ctx),
      'tool.execute.after': (ctx: any, result: any) => hookManager.execute('tool.executed', { ...ctx, data: result }),
      'chat.message': (ctx: any) => hookManager.execute('user.prompt', ctx),
    },
    command: {
      goal: {
        description: 'Submit a new Goal to MAFW',
        async execute(args: string, context: any) {
          const result = await context.runSkill('mafw-goal', { text: args });
          if (result?.confirmed) {
            const requestsDir = path.join(mafwDir, 'requests');
            if (!fs.existsSync(requestsDir)) fs.mkdirSync(requestsDir, { recursive: true });
            fs.writeFileSync(path.join(requestsDir, `${result.goalId}.json`), JSON.stringify(result, null, 2));
            return { type: 'goal_submitted', goalId: result.goalId, message: `�?Goal "${result.title}" submitted` };
          }
        }
      },
      status: {
        description: 'Show MAFW dashboard status',
        async execute(args: string, context: any) {
          try {
            const statusPath = path.join(mafwDir, 'STATUS.md');
            if (!fs.existsSync(statusPath)) return { text: 'No active Goals. Use /goal to create one.' };
            return { text: fs.readFileSync(statusPath, 'utf-8') };
          } catch (err: any) { return { text: `Error: ${err.message}` }; }
        }
      },
      'merge-memory': {
        description: 'Merge memories from another worktree via gateway',
        async execute(args: string, context: any) {
          const parts = args.trim().split(/\s+/);
          const sourceWorktree = parts[0];
          if (!sourceWorktree) return { text: 'Usage: /merge-memory <sourceWorktreePath> [strategy]' };
          try {
            const res = await fetch(`${gatewayUrl}/api/merge-memory`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceWorktree, strategy: parts[1] || 'manual', mafwDir }),
              signal: AbortSignal.timeout(30000),
            });
            const result = await res.json();
            return { text: `Merge result: ${JSON.stringify(result)}` };
          } catch (err: any) { return { text: `Error: ${err.message}` }; }
        }
      },
    },
  };
}
