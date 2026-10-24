/**
 * MAFW 基础工具集（六件套）——spec 与执行逻辑的 gateway 单一来源。
 *
 * 契约（contract.ts RuntimeTools.registerTools）在激活期把 factory 推给
 * runtime；runtime 只做 plumbing：按会话取 registrations、把 parameters
 * 翻译为自家类型系统（pi typebox T.Unsafe / MCP inputSchema）、把 execute
 * 接到工具调用面。执行 = gateway loopback HTTP（/api/memory/add、
 * /api/python/*、/api/tts、/a2a——HostAdapter 工具动词）。
 *
 * v1 opencode 插件（src/tools/）不经此模块（生产宿主，v2 迁移统一）。
 * spec：docs/superpowers/specs/2026-10-15-runtime-tool-registration-contract-design.md
 */
import { randomUUID } from 'crypto';
import type { AgentRuntime, MafwToolRegistration } from './contract';
import {
  hashText, postToolJson, a2aRequest, taskAnswer, makeMediaPointer, mediaDataFromSource,
} from './host-adapter';
import { setToolClassOverlay, clearToolClassOverlay, annotationsForTool } from './tool-classes';
import { log } from '../core/utils/logger';

export interface MafwToolSpec {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, any>;
  /** MCP stable spec 注解（可选；factory 物化时 spec 自带值走声明覆盖级） */
  annotations?: import('./tool-classes').MafwToolAnnotations;
  /** MCP stable spec 结构化输出声明（本批六件套不产出 structured，字段为将来/runtime 插件作者预留） */
  outputSchema?: Record<string, any>;
}

const ok = (text: string): { text: string } => ({ text });
const fail = (text: string): { text: string; isError: boolean } => ({ text, isError: true });

interface ExecuteCtx { sessionId: string; f: typeof fetch; base: string }

interface ToolDef {
  spec: MafwToolSpec;
  makeExecute(ctx: ExecuteCtx): (params: any, signal?: AbortSignal) => Promise<{ text: string; isError?: boolean }>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    spec: {
      name: 'mafw_add_memory',
      label: 'MAFW 记忆写入',
      description: '保存一条记忆到谐波记忆系统（跨会话存续的事实/决定/偏好/教训/模式）。一次一条，附 cueAnchors 检索关键词；memoryType: semantic=事实/偏好/约束, episodic=叙事, procedural=教训/模式, global=跨项目。逐字保留标识符进 cueAnchors。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容（一句话）' },
          memoryType: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'global'] },
          cueAnchors: { type: 'array', items: { type: 'string', description: '检索关键词（≤8）' } },
          primaryAbstraction: { type: 'string', description: '6-8 词摘要（缺省自动生成）' },
          importance: { type: 'number', description: '重要性 1-10' },
        },
        required: ['content'],
      },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/memory/add', {
          content: params.content,
          memoryType: params.memoryType || 'semantic',
          cueAnchors: params.cueAnchors || [],
          primaryAbstraction: params.primaryAbstraction,
          importance: params.importance,
          sessionID: sid,
        }, 10_000, signal);
        return r.ok ? ok(`记忆已保存：${r.body?.id ?? ''}`) : fail(`记忆写入失败：${r.text ?? ''} ${JSON.stringify(r.body ?? {})}`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_python',
      label: 'MAFW Python 内核',
      description: '在会话的持久 Python 内核中执行代码（变量/导入跨调用保持）。数据分析/统计/科学计算/多步计算优先用本工具。matplotlib 图表作为图片附件返回（输出中标注数量）。',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '要执行的 Python 代码' } },
        required: ['code'],
      },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/python/execute', { sessionID: sid, code: params.code }, 180_000, signal);
        if (!r.ok) return fail(`内核不可用：${r.text ?? ''}（可用 mafw_python_restart 重启）`);
        const j = r.body ?? {};
        if (j.status === 'error' && j.error) {
          const tb = Array.isArray(j.error.traceback) ? j.error.traceback.join('\n').split('\n').slice(-6).join('\n') : '';
          return fail(`代码执行出错：${j.error.ename}: ${j.error.evalue}\n${tb}\n（内核状态保留，可修改后重试）`);
        }
        const parts: string[] = [];
        if (j.kernelRestarted) parts.push('<python_kernel_reset> 内核已重启，之前的变量/导入已丢失。</python_kernel_reset>');
        if (j.stdout) parts.push(j.stdout);
        if (j.result) parts.push(j.result);
        if (j.stderr) parts.push(`stderr:\n${j.stderr}`);
        if (j.truncated) parts.push('...(输出已截断)');
        if (Array.isArray(j.attachments) && j.attachments.length) parts.push(`[生成 ${j.attachments.length} 张图片]`);
        return ok(parts.join('\n') || '(无输出)');
      };
    },
  },
  {
    spec: {
      name: 'mafw_python_restart',
      label: 'MAFW Python 内核重启',
      description: '重启会话的持久 Python 内核（内核崩溃或内存泄漏时调用；重启后变量丢失）。',
      parameters: { type: 'object', properties: {} },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (_params, signal) => {
        const r = await postToolJson(f, base, '/api/python/restart', { sessionID: sid }, 60_000, signal);
        return r.ok ? ok('内核已重启') : fail(`重启失败：${r.text ?? ''}`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_speak',
      label: 'MAFW 语音合成',
      description: '将文本合成为语音。用户通过语音消息输入时必须调用本工具以语音回复。返回 [语音回复 art:... 音色:... h:...] 标记，必须原样包含在回复文本中（h 为文本指纹，桌面端用于流式去重）。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要合成的文本（≤2000 字符）' },
          voice: { type: 'string', description: '音色：冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean（默认茉莉）' },
          style: { type: 'string', description: '发音风格指令' },
        },
        required: ['text'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/tts', { text: params.text, voice: params.voice, style: params.style }, 130_000, signal);
        if (!r.ok || !r.body?.artifactId) return fail(`语音合成失败：${r.text ?? ''}`);
        const voice = r.body.voice || params.voice || '默认';
        return ok(`[语音回复 art:${r.body.artifactId} 音色:${voice} h:${hashText(params.text)}]`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_upload',
      label: 'MAFW 媒体上传',
      description: '上传本地图片/视频/音频到 Media Agent 并返回引用指针；之后用返回的 taskID 经 mafw_media_ask 多轮追问。mediaPath 为本地绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          mediaPath: { type: 'string', description: '本地媒体文件绝对路径' },
          question: { type: 'string', description: '可选的首个问题' },
        },
        required: ['mediaPath'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        try {
          const media = mediaDataFromSource(params.mediaPath);
          if (!media) return fail(`不支持的媒体格式或文件不存在：${params.mediaPath}`);
          const result = await a2aRequest(f, base, 'SendMessage', {
            message: {
              messageId: `upload-${randomUUID()}`,
              role: 1,
              parts: [
                { raw: media.data, mediaType: media.mediaType, filename: media.filename },
                ...(params.question ? [{ text: params.question }] : []),
              ],
            },
          }, signal);
          const task = result?.task;
          if (!task?.id) return fail('gateway 未返回任务');
          const answer = taskAnswer(task);
          if (task?.status?.state === 'TASK_STATE_FAILED') return fail(answer || 'Media Agent 分析失败');
          return ok(makeMediaPointer(task.id, task.contextId, media.filename) + (answer ? `\n首个问题回答：${answer}` : ''));
        } catch (err: any) { return fail(`媒体上传失败：${err?.message ?? err}`); }
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_ask',
      label: 'MAFW 媒体追问',
      description: '分析或追问图片/视频/音频。会话里有 [媒体附件 taskID: xxx] 指针时传 taskID；只有本地文件路径时传 mediaPath（自动上传后追问）。返回分析文本 + 新 taskID（追问用新 ID，媒体不重传）。',
      parameters: {
        type: 'object',
        properties: {
          taskID: { type: 'string', description: '从 [媒体附件 taskID: xxx] 指针提取（与 mediaPath 二选一）' },
          mediaPath: { type: 'string', description: '本地媒体文件绝对路径（与 taskID 二选一）' },
          question: { type: 'string', description: '要问这个媒体的具体问题' },
        },
        required: ['question'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        try {
          let activeTaskID = params.taskID;
          let activeContextId: string | undefined;
          if (activeTaskID) {
            const task = await a2aRequest(f, base, 'GetTask', { id: activeTaskID }, signal);
            activeContextId = task?.task?.contextId ?? task?.contextId;
            if (!activeContextId) return fail(`任务 ${activeTaskID} 不存在或已被清理，请重新上传媒体。`);
          } else if (params.mediaPath) {
            const media = mediaDataFromSource(params.mediaPath);
            if (!media) return fail(`不支持的媒体格式或文件不存在：${params.mediaPath}`);
            const created = await a2aRequest(f, base, 'SendMessage', {
              message: {
                messageId: `ask-${randomUUID()}`,
                role: 1,
                parts: [{ raw: media.data, mediaType: media.mediaType, filename: media.filename }, { text: params.question }],
              },
            }, signal);
            const t = created?.task;
            if (!t?.id) return fail('gateway 未返回任务');
            activeTaskID = t.id;
            activeContextId = t.contextId;
            if (t?.status?.state === 'TASK_STATE_COMPLETED') {
              const answer = taskAnswer(t);
              if (answer) return ok(`${answer}\n（新任务 taskID: ${t.id}，继续追问请用新 taskID）`);
            }
          } else {
            return fail('缺少参数：请提供 taskID（媒体附件指针）或 mediaPath（媒体文件路径）。');
          }
          const result = await a2aRequest(f, base, 'SendMessage', {
            message: {
              messageId: `ask-${randomUUID()}`,
              role: 1,
              contextId: activeContextId,
              referenceTaskIds: [activeTaskID],
              parts: [{ text: params.question }],
            },
          }, signal);
          const t = result?.task;
          const answer = taskAnswer(t);
          if (t?.status?.state === 'TASK_STATE_FAILED') return fail(answer || 'Media Agent 分析失败');
          if (!answer) return fail('Media Agent 未返回描述，请稍后重试。');
          return ok(`${answer}\n（新任务 taskID: ${t?.id}，继续追问请用新 taskID）`);
        } catch (err: any) { return fail(`Media Agent 调用失败：${err?.message ?? err}`); }
      };
    },
  {
    spec: {
      name: 'mafw_submit_result',
      label: 'MAFW 结构化交卷',
      description: '结构化输出交卷。只有 prompt 中出现 [MAFW STRUCTURED OUTPUT] 时调用：把最终结果作为 data 对象提交，gateway 按当前 JSON Schema 校验；失败时按返回的路径错误修正后再次调用。',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: '符合当前回合 JSON Schema 的结构化结果对象' },
        },
        required: ['data'],
      },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/structured/submit', {
          sessionID: sid,
          data: params.data,
        }, 10_000, signal);
        if (!r.ok || r.body?.ok === false) {
          const errors = Array.isArray(r.body?.errors)
            ? r.body.errors
            : [r.text ?? 'validation failed'];
          return fail(`结构化结果未通过校验：\n${errors.join('\n')}`);
        }
        return ok('结构化结果已提交');
      };
    },
  },
];

export const MAFW_TOOL_SPECS: MafwToolSpec[] = TOOL_DEFS.map((d) => d.spec);

export function buildMafwToolFactory(opts: { baseUrl: string; fetchImpl?: typeof fetch }): (sessionId: string) => MafwToolRegistration[] {
  const f = (opts.fetchImpl ?? fetch) as typeof fetch;
  const base = opts.baseUrl;
  // 注解物化（spec §5.5）：单源 = MAFW_TOOL_ANNOTATIONS 表；spec 自带 annotations 走声明覆盖级。
  // pi stash 透传携带（typebox 通道今日只消费 parameters，fail-open 忽略——将来支持零改动）。
  return (sessionId: string) => TOOL_DEFS.map((d) => ({
    ...d.spec,
    annotations: annotationsForTool(d.spec.name, d.spec.annotations),
    execute: d.makeExecute({ sessionId, f, base }),
  }));
}

/**
 * 激活期工具接线（index.ts createRuntime 三分支调用）：推送六件套 factory +
 * nativeTools 声明进 tool-classes overlay。fail-open——任一步失败不阻断激活
 * （registerTools 失败 = 该 runtime 工具面缺失但不换 runtime；nativeTools
 * 失败 = overlay 清空回落并集表）。
 */
export async function activateRuntimeTools(
  rt: AgentRuntime,
  source: string,
  opts: { baseUrl: string },
  logger: { info(m: string): void; warn(m: string): void } = log,
): Promise<void> {
  try {
    await rt.tools.registerTools(buildMafwToolFactory({ baseUrl: opts.baseUrl }));
  } catch (err: any) {
    logger.warn(`[RuntimeTools] '${rt.name}' registerTools failed (non-fatal): ${err?.message ?? err}`);
  }
  try {
    const decls = rt.tools.nativeTools();
    const { applied, invalid } = setToolClassOverlay(Array.isArray(decls) ? decls : []);
    if (invalid.length) logger.warn(`[RuntimeTools] ${source}: nativeTools invalid entries skipped: ${invalid.join(', ')}`);
    if (applied > 0) logger.info(`[RuntimeTools] ${source}: tool-class overlay applied (${applied} entries)`);
  } catch (err: any) {
    clearToolClassOverlay();
    logger.warn(`[RuntimeTools] ${source}: nativeTools failed (overlay cleared): ${err?.message ?? err}`);
  }
}

// ─── 显示链：合成 tool part 事件（spec 2026-10-20；调研 2026-10-20 §4） ────────

export interface ToolPartEventFrame {
  type: 'part.updated';
  properties: {
    sessionID: string;
    part: {
      id: string;
      type: 'tool';
      tool: string;
      state: { status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string };
    };
  };
}

export function buildToolPartEvent(args: {
  sessionID: string; partId: string; tool: string;
  status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string;
}): ToolPartEventFrame {
  const state: ToolPartEventFrame['properties']['part']['state'] = { status: args.status, input: args.input };
  if (args.output !== undefined) state.output = args.output;
  if (args.error !== undefined) state.error = args.error;
  return {
    type: 'part.updated',
    properties: {
      sessionID: args.sessionID,
      part: { id: args.partId, type: 'tool', tool: args.tool, state },
    },
  };
}

/**
 * 单源执行核（D8）：emit running → execute → emit 终态（isError → error 态，D5）。
 * emission fail-open（D6）——渲染增强不得破坏工具执行；execute 抛错发 error 帧后重抛。
 */
export async function executeWithToolFrames(
  reg: MafwToolRegistration,
  params: any,
  sessionId: string,
  emit: (evt: ToolPartEventFrame) => void,
  signal?: AbortSignal,
): Promise<{ text: string; isError?: boolean }> {
  const partId = `toolpart_${randomUUID()}`;
  const fire = (frame: ToolPartEventFrame) => { try { emit(frame); } catch { /* fail-open */ } };
  fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'running', input: params }));
  let out: { text: string; isError?: boolean };
  try {
    out = await reg.execute(params, signal);
  } catch (err: any) {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'error', input: params, error: err?.message ?? String(err) }));
    throw err;
  }
  if (out?.isError) {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'error', input: params, error: out.text }));
  } else {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'completed', input: params, output: out?.text ?? '' }));
  }
  return out;
}

/** opt-in 包装：无事件映射的 in-process runtime 用——emit 指向其 global.event() 流（进 wrapGlobalEventStream 同管线）。 */
export function wrapRegistrationsWithEvents(
  regs: MafwToolRegistration[],
  sessionId: string,
  emit: (evt: unknown) => void,
): MafwToolRegistration[] {
  return regs.map((reg) => ({
    ...reg,
    async execute(params: any, signal?: AbortSignal) {
      return executeWithToolFrames(reg, params, sessionId, emit, signal);
    },
  }));
}
