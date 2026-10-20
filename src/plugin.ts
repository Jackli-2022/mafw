/**
 * MAFW Plugin — OpenCode V2 plugin API（v5）。
 *
 * V2 入口：默认导出 `{ id, setup(ctx) }` 对象定义（V1 的裸 async 函数入口
 * 已被 V2 拒绝加载——"Plugin must export a default definition with an id and
 * an effect or setup function"）。V1 hooks/tools 的实现保持不动，经
 * `src/utils/v2-compat.ts` 适配到 V2 形状：
 *
 *   V1                                              V2
 *   ──────────────────────────────────────────────  ─────────────────────────────────────
 *   `MafwPlugin({ directory })` 裸函数               `setup(ctx)` + `ctx.location.directory`
 *   `tool` map（zod args）                           `ctx.tool.transform` + JSON Schema
 *   `experimental.chat.messages.transform`           `ctx.session.hook('context')` → `event.messages`
 *   `experimental.chat.system.transform`             `ctx.session.hook('context')` → `event.system`
 *   `chat.message`（user_input 观察 + 媒体预转换）    `ctx.session.hook('prompt')`
 *   `tool.execute.after` + `session.next.tool.failed` `ctx.tool.hook('execute.after')`（status 区分）
 *   `event`（reasoning.ended / text.complete）        `ctx.event.subscribe()` + session.idle 收割
 *   `session.end`                                    事件流 `session.deleted`
 *   `command` map（返回 { text }）                    `ctx.command.transform` + `ctx.session.synthetic`
 */
import * as fs from 'fs';
import * as path from 'path';
import { sessionEndingHook } from './hooks/session-ending';
import { sessionRecallHook } from './hooks/session-recall';
import { mediaIngestHook } from './hooks/media-ingest';
import { pythonGuideHook } from './hooks/bash-python-guide';
import { mediaAskTool } from './tools/media-ask';
import { mediaUploadTool } from './tools/media-upload';
import { mediaSpeakTool } from './tools/media-speak';
import { pythonExecTool } from './tools/python-exec';
import { pythonRestartTool } from './tools/python-restart';
import { memoryGuideHook } from './hooks/memory-guide';
import { userProfileSystemHook } from './hooks/user-profile';
import { agentPriorsSystemHook } from './hooks/agent-priors';
import { voiceGuideMessagesHook, voiceGuideSystemHook } from './hooks/voice-guide';
import { pushObservation, toolFailureText } from './utils/obs-capture';
import { addMemoryTool } from './tools/add-memory';
import { ensureMcpWiring, resolveGatewayApiUrl } from './utils/self-wiring';
import {
  zodToJsonSchema,
  toV1Views,
  propagateSyntheticViews,
  convertPromptFilesToPointers,
  captureAssistantOutput,
} from './utils/v2-compat';

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

/** V1 工具实现（zod args + `{ title, output, metadata }` 返回值）。 */
const V1_TOOLS: Record<string, { description: string; args: any; execute: (args: any, ctx: any) => any }> = {
  mafw_media_ask: mediaAskTool,
  mafw_media_upload: mediaUploadTool,
  mafw_media_speak: mediaSpeakTool,
  mafw_python: pythonExecTool,
  mafw_python_restart: pythonRestartTool,
  mafw_add_memory: addMemoryTool,
};

/** V1 工具结果 → V2 `{ content, metadata }`。 */
async function adaptToolExecute(
  def: { execute: (args: any, ctx: any) => any },
  input: any,
  context: any,
): Promise<any> {
  const result = await def.execute(input, {
    sessionID: context?.sessionID,
    abort: context?.signal,
  });
  if (result == null) return { content: '' };
  if (typeof result === 'string') return { content: result };
  const content = result.content ?? result.output ?? result.text ?? JSON.stringify(result);
  return { content, ...(result.metadata ? { metadata: result.metadata } : {}) };
}

export default {
  id: 'mafw',

  async setup(ctx: any) {
    // V1 宿主可能以 V1 形状调用 setup（缺 session.hook / tool.transform）——
    // 安静返回，不在这类宿主上注册任何东西。
    if (!ctx?.session || typeof ctx.session.hook !== 'function' ||
        !ctx?.tool || typeof ctx.tool.transform !== 'function' ||
        !ctx?.location?.directory) {
      return;
    }

    const directory: string = ctx.location.directory;
    const mafwDir = path.join(directory, '.mafw');
    await ensureMafwDirectories(mafwDir);

    const { installFileLogging } = require('./utils/logger');
    installFileLogging(path.join(mafwDir, 'logs'));
    console.log(`[MAFW] File logging enabled: ${mafwDir}/logs/mafw.log`);

    await registerWithGateway(directory, mafwDir);
    // Self-wire gateway MCP into the global opencode config so mafw_* tools are
    // mounted in every session. Fail-open.
    try {
      const wiring = ensureMcpWiring(resolveGatewayApiUrl());
      if (wiring === 'wired') {
        console.log('[MAFW] Self-wired mcp.mafw into global opencode config (restart sessions to load tools)');
      }
    } catch {}
    const pkg = require('../package.json') as { version: string };
    console.log(`[MAFW] Plugin activated v${pkg.version} (opencode V2 API). All hooks registered.`);

    const gatewayUrl = getGatewayUrl(mafwDir);

    // ── 工具（V1 tool map → ctx.tool.transform + JSON Schema）───────────────
    await ctx.tool.transform((editor: any) => {
      for (const [name, def] of Object.entries(V1_TOOLS)) {
        editor.add({
          name,
          description: def.description,
          input: zodToJsonSchema(def.args),
          execute: (input: any, context: any) => adaptToolExecute(def, input, context),
        });
      }
    });

    // ── context hook（V1 messages.transform + system.transform 合一）────────
    await ctx.session.hook('context', async (event: any) => {
      try {
        const sessionID = event?.sessionID || '';
        const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];

        // V1 视图（parts 与 content 同引用，原地注入自动传播）
        const views = toV1Views(messages, sessionID);
        const out = { messages: views };
        await mediaIngestHook({ sessionID }, out);
        pythonGuideHook({ sessionID }, out);
        await sessionRecallHook({ sessionID }, out);
        voiceGuideMessagesHook({ sessionID }, out);
        // V1 hooks 推入的合成消息（python-guide 提示）回写到 V2 messages
        propagateSyntheticViews(views, messages);

        // system：字符串数组 shim → SystemPart[] 写回
        const sysTexts: string[] = (Array.isArray(event?.system) ? event.system : [])
          .map((p: any) => (typeof p === 'string' ? p : p?.text || ''));
        const sysOut = { system: sysTexts };
        memoryGuideHook({}, sysOut);
        await userProfileSystemHook({}, sysOut);
        await agentPriorsSystemHook({}, sysOut);
        voiceGuideSystemHook({ sessionID }, sysOut);
        if (sysTexts.length && Array.isArray(event.system)) {
          event.system.length = 0;
          for (const text of sysTexts) event.system.push({ type: 'text', text });
        }
      } catch (err: any) {
        console.error('[MAFW] context hook failed (fail-open):', err?.message || err);
      }
    });

    // ── prompt hook（V1 chat.message：user_input 观察 + 媒体预转换）──────────
    await ctx.session.hook('prompt', async (event: any) => {
      try {
        const sessionID = event?.sessionID || '';
        const text = event?.prompt?.text || '';
        // 媒体附件在 admission 阶段转为 A2A 指针（不进持久化输入）
        await convertPromptFilesToPointers(event?.prompt);
        if (text) void pushObservation(sessionID, 'user_input', text);
      } catch (err: any) {
        console.error('[MAFW] prompt hook failed (fail-open):', err?.message || err);
      }
    });

    // ── tool execute.after（V1 tool.execute.after + session.next.tool.failed）─
    await ctx.tool.hook('execute.after', (event: any) => {
      try {
        const sessionID = event?.sessionID || '';
        if (!sessionID) return;
        if (event?.status === 'error') {
          void pushObservation(
            sessionID, 'tool_result',
            toolFailureText({ tool: event.tool, error: event.error }),
            true,
          );
          return;
        }
        const result = event?.result;
        const text = typeof result === 'string'
          ? result
          : result?.content ?? result?.output
            ?? (result && Object.keys(result).length > 0 ? JSON.stringify(result) : '');
        void pushObservation(sessionID, 'tool_result', String(text));
      } catch { /* fail-open */ }
    });

    // ── 事件流（V1 event 钩子 + session.end + text.complete/reasoning.ended）─
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
          const type = ev?.type;
          const sessionID = ev?.sessionID || ev?.info?.sessionID || ev?.info?.id || '';
          if (!sessionID) continue;
          if (type === 'session.idle') {
            // 收割本回合 assistant 文本 + reasoning（游标去重）
            try {
              const messages = await ctx.session.context({ sessionID });
              await captureAssistantOutput(sessionID, messages ?? []);
            } catch { /* fail-open */ }
          } else if (type === 'session.deleted') {
            // V1 session.end 兜底（goal 状态异常恢复）
            void sessionEndingHook({ sessionId: sessionID, projectDir: directory });
          }
        }
      } catch { /* 流被中断（unload） */ }
    })();

    // ── 命令（V1 command map → ctx.command.transform + synthetic 展示）────────
    await ctx.command.transform((editor: any) => {
      const reply = (sessionID: string, text: string) => {
        void ctx.session.synthetic({ sessionID, text }).catch(() => {});
      };
      const gatewayJson = async (body: any, timeoutMs: number): Promise<any> => {
        const res = await fetch(`${gatewayUrl}/api/mafw-commands/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return await res.json();
      };

      editor.add({
        name: 'goal',
        description: 'Submit a new Goal to MAFW',
        async execute({ sessionID, prompt, delivery }: any) {
          const request = (prompt?.text ?? '').replace(/^\/\S+\s*/, '').trim();
          const text =
            `请为以下用户请求创建 MAFW Goal：调用 mafw_create_goal 工具（projectDir 用当前项目目录），` +
            `创建后按返回的 goalId 跟进。用户请求：\n${request}`;
          await ctx.session.prompt({ ...(prompt ?? {}), sessionID, text, delivery });
        },
      });

      editor.add({
        name: 'status',
        description: 'Show MAFW dashboard status',
        async execute({ sessionID }: any) {
          try {
            const statusPath = path.join(mafwDir, 'STATUS.md');
            if (!fs.existsSync(statusPath)) {
              reply(sessionID, 'No active Goals. Use /goal to create one.');
              return;
            }
            reply(sessionID, fs.readFileSync(statusPath, 'utf-8'));
          } catch (err: any) {
            reply(sessionID, `Error: ${err.message}`);
          }
        },
      });

      editor.add({
        name: 'merge-memory',
        description: 'Merge memories from another worktree via gateway',
        async execute({ sessionID, prompt }: any) {
          const parts = (prompt?.text ?? '').trim().split(/\s+/);
          const sourceWorktree = parts[1]; // parts[0] 是命令名
          if (!sourceWorktree) {
            reply(sessionID, 'Usage: /merge-memory <sourceWorktreePath> [strategy]');
            return;
          }
          try {
            const res = await fetch(`${gatewayUrl}/api/merge-memory`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceWorktree, strategy: parts[2] || 'manual', mafwDir }),
              signal: AbortSignal.timeout(30000),
            });
            const result = await res.json();
            reply(sessionID, `Merge result: ${JSON.stringify(result)}`);
          } catch (err: any) {
            reply(sessionID, `Error: ${err.message}`);
          }
        },
      });

      editor.add({
        name: 'new-topic',
        description: 'Start a new MAFW manager topic (archives the current session to history)',
        async execute({ sessionID }: any) {
          try {
            const result = await gatewayJson({ command: 'new-topic' }, 60000);
            reply(sessionID, result?.message || JSON.stringify(result));
          } catch (err: any) {
            reply(sessionID, `Error: ${err.message}`);
          }
        },
      });

      editor.add({
        name: 'btw',
        description: 'One-off side-question session: answer in a throwaway session, keep the main thread clean',
        async execute({ sessionID, prompt }: any) {
          const args = (prompt?.text ?? '').replace(/^\/\S+\s*/, '').trim();
          if (!args) {
            reply(sessionID, 'Usage: /btw <question>');
            return;
          }
          try {
            const result = await gatewayJson({ command: 'btw', args }, 180000);
            reply(sessionID, result?.text || result?.message || JSON.stringify(result));
          } catch (err: any) {
            reply(sessionID, `Error: ${err.message}`);
          }
        },
      });

      editor.add({
        name: 'waitwhat',
        description: 'Re-pitch the last reply in plain language with project glossary terms (CONTEXT.md)',
        async execute({ sessionID }: any) {
          if (!sessionID) {
            reply(sessionID, 'Error: no session context');
            return;
          }
          try {
            const result = await gatewayJson({ command: 'waitwhat', sessionID }, 60000);
            reply(sessionID, result?.message || result?.error || JSON.stringify(result));
          } catch (err: any) {
            reply(sessionID, `Error: ${err.message}`);
          }
        },
      });
    });

    // cleanup：中断事件流订阅（hook/transform 注册随插件卸载自动清理）
    return () => controller.abort();
  },
};
