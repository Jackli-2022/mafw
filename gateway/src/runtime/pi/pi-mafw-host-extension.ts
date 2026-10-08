import { randomUUID } from 'crypto';
import {
  MEMORY_GUIDE, contentToText, hashText, buildRecallQuery,
  createCognitionClient, createRecallCursor,
  mediaDataFromSource, a2aRequest, taskAnswer, makeMediaPointer, postToolJson,
} from '../host-adapter';

/**
 * mafw-host —— pi 认知面宿主扩展（HostAdapter 的 pi 实现，Phase 2/3）。
 *
 * 本文件是**薄事件映射层**：pi 事件 → HostAdapter 四动词，认知逻辑全部在
 * `runtime/host-adapter.ts`（契约核心 + CognitionClient + 工具 HTTP 核心）。
 *
 * 事件映射：observe→message_end/tool_result；injectContext→context；
 * injectSystem→before_agent_start；tools→registerTool ×6。
 * ingestMedia 不在此（pi 原生 ImageContent + mafw-media wire 注入，§5.14）；
 * commands 不在此（gateway 命令注册表已 host-neutral，§5.13c）。
 */

export interface MafwHostDeps {
  sessionId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** ESM 桥取 pi 同实例 typebox 的 Type（registerTool 需要 TSchema 实例） */
  getType?: () => Promise<any>;
}

/** 注入到 pi user 消息的 content（string→array 转换是 pi 形状特有）。 */
function appendRecall(userMsg: any, pointers: string): void {
  const part = { type: 'text', text: pointers, synthetic: true };
  if (typeof userMsg.content === 'string') {
    userMsg.content = [{ type: 'text', text: userMsg.content }, part];
  } else if (Array.isArray(userMsg.content)) {
    userMsg.content.push(part);
  } else {
    userMsg.content = [part];
  }
}

export function createMafwHostExtension(deps: MafwHostDeps) {
  const f = (deps.fetchImpl ?? fetch) as typeof fetch;
  const client = createCognitionClient({ sessionId: deps.sessionId, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
  const cursor = createRecallCursor();

  return {
    name: 'mafw-host' as const,
    on: (pi: any) => {
      // === observe：user/assistant 文本 + thinking ===
      pi.on('message_end', async (event: any) => {
        const msg = event?.message;
        if (!msg) return;
        if (msg.role === 'user') {
          client.observe('user_input', contentToText(msg.content));
        } else if (msg.role === 'assistant') {
          const arr = Array.isArray(msg.content) ? msg.content : [];
          const text = arr.filter((c: any) => c?.type === 'text').map((c: any) => c?.text || '').join('\n');
          const thinking = arr.filter((c: any) => c?.type === 'thinking').map((c: any) => c?.thinking || c?.text || '').join('\n');
          client.observe('assistant_reply', text);
          if (thinking.trim()) client.observe('reasoning', thinking);
        }
      });
      // === observe：工具结果（含 isError） ===
      pi.on('tool_result', async (event: any) => {
        const raw = event?.content;
        const text = Array.isArray(raw)
          ? raw.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          : String(raw ?? '');
        client.observe('tool_result', `[${event?.toolName}]\n${text}`, Boolean(event?.isError));
      });
      // === injectContext：边界 recall（100ms 契约，fail-open） ===
      pi.on('context', async (event: any) => {
        const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];
        if (messages.length === 0) return undefined;
        const real = messages.filter((m: any) => m && typeof m.role === 'string');
        if (real.length === 0) return undefined;
        const query = buildRecallQuery(real, cursor.next(real));
        if (query.trim()) {
          const pointers = await client.fetchRecallPointers(query);
          if (pointers) {
            const lastUser = [...real].reverse().find((m: any) => m.role === 'user');
            if (lastUser) appendRecall(lastUser, pointers);
          }
        }
        cursor.advance(real);
        return { messages };
      });
      // === injectSystem：memory-guide（静态）+ pinned profile（150ms fail-open） ===
      pi.on('before_agent_start', async (event: any) => {
        let extra = MEMORY_GUIDE;
        const profile = await client.fetchPinnedProfile();
        if (profile) extra += '\n\n' + profile;
        return { systemPrompt: `${event?.systemPrompt ?? ''}\n\n${extra}` };
      });
      // === tools：六件套（typebox 经 ESM 桥；fail-open） ===
      void registerMafwTools(pi, deps, f).catch(() => { /* 工具面缺失不阻塞会话 */ });
    },
  };
}

async function registerMafwTools(pi: any, deps: MafwHostDeps, f: typeof fetch): Promise<void> {
  const T = await (deps.getType ? deps.getType() : Promise.resolve(null));
  if (!T) return; // typebox 不可达 → fail-open 跳过注册
  const sid = deps.sessionId;
  const base = deps.baseUrl;
  const ok = (text: string) => ({ content: [{ type: 'text', text }], details: {} });
  const fail = (text: string) => ({ content: [{ type: 'text', text }], details: {}, isError: true });

  pi.registerTool({
    name: 'mafw_add_memory',
    label: 'MAFW 记忆写入',
    description: '保存一条记忆到谐波记忆系统（跨会话存续的事实/决定/偏好/教训/模式）。一次一条，附 cueAnchors 检索关键词；memoryType: semantic=事实/偏好/约束, episodic=叙事, procedural=教训/模式, global=跨项目。逐字保留标识符进 cueAnchors。',
    parameters: T.Object({
      content: T.String({ description: '记忆内容（一句话）' }),
      memoryType: T.Optional(T.Union([T.Literal('semantic'), T.Literal('episodic'), T.Literal('procedural'), T.Literal('global')])),
      cueAnchors: T.Optional(T.Array(T.String({ description: '检索关键词（≤8）' }))),
      primaryAbstraction: T.Optional(T.String({ description: '6-8 词摘要（缺省自动生成）' })),
      importance: T.Optional(T.Number({ description: '重要性 1-10' })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal) {
      const r = await postToolJson(f, base, '/api/memory/add', {
        content: params.content,
        memoryType: params.memoryType || 'semantic',
        cueAnchors: params.cueAnchors || [],
        primaryAbstraction: params.primaryAbstraction,
        importance: params.importance,
        sessionID: sid,
      }, 10_000, signal);
      return r.ok ? ok(`记忆已保存：${r.body?.id ?? ''}`) : fail(`记忆写入失败：${r.text ?? ''} ${JSON.stringify(r.body ?? {})}`);
    },
  });

  pi.registerTool({
    name: 'mafw_python',
    label: 'MAFW Python 内核',
    description: '在会话的持久 Python 内核中执行代码（变量/导入跨调用保持）。数据分析/统计/科学计算/多步计算优先用本工具。matplotlib 图表作为图片附件返回（输出中标注数量）。',
    parameters: T.Object({ code: T.String({ description: '要执行的 Python 代码' }) }),
    async execute(_id: string, params: any, signal: AbortSignal) {
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
    },
  });

  pi.registerTool({
    name: 'mafw_python_restart',
    label: 'MAFW Python 内核重启',
    description: '重启会话的持久 Python 内核（内核崩溃或内存泄漏时调用；重启后变量丢失）。',
    parameters: T.Object({}),
    async execute(_id: string, _params: any, signal: AbortSignal) {
      const r = await postToolJson(f, base, '/api/python/restart', { sessionID: sid }, 60_000, signal);
      return r.ok ? ok('内核已重启') : fail(`重启失败：${r.text ?? ''}`);
    },
  });

  pi.registerTool({
    name: 'mafw_media_speak',
    label: 'MAFW 语音合成',
    description: '将文本合成为语音。用户通过语音消息输入时必须调用本工具以语音回复。返回 [语音回复 art:... 音色:... h:...] 标记，必须原样包含在回复文本中（h 为文本指纹，桌面端用于流式去重）。',
    parameters: T.Object({
      text: T.String({ description: '要合成的文本（≤2000 字符）' }),
      voice: T.Optional(T.String({ description: '音色：冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean（默认茉莉）' })),
      style: T.Optional(T.String({ description: '发音风格指令' })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal) {
      const r = await postToolJson(f, base, '/api/tts', { text: params.text, voice: params.voice, style: params.style }, 130_000, signal);
      if (!r.ok || !r.body?.artifactId) return fail(`语音合成失败：${r.text ?? ''}`);
      const voice = r.body.voice || params.voice || '默认';
      return ok(`[语音回复 art:${r.body.artifactId} 音色:${voice} h:${hashText(params.text)}]`);
    },
  });

  pi.registerTool({
    name: 'mafw_media_upload',
    label: 'MAFW 媒体上传',
    description: '上传本地图片/视频/音频到 Media Agent 并返回引用指针；之后用返回的 taskID 经 mafw_media_ask 多轮追问。mediaPath 为本地绝对路径。',
    parameters: T.Object({
      mediaPath: T.String({ description: '本地媒体文件绝对路径' }),
      question: T.Optional(T.String({ description: '可选的首个问题' })),
    }),
    async execute(_id: string, params: any, signal: AbortSignal) {
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
    },
  });

  pi.registerTool({
    name: 'mafw_media_ask',
    label: 'MAFW 媒体追问',
    description: '分析或追问图片/视频/音频。会话里有 [媒体附件 taskID: xxx] 指针时传 taskID；只有本地文件路径时传 mediaPath（自动上传后追问）。返回分析文本 + 新 taskID（追问用新 ID，媒体不重传）。',
    parameters: T.Object({
      taskID: T.Optional(T.String({ description: '从 [媒体附件 taskID: xxx] 指针提取（与 mediaPath 二选一）' })),
      mediaPath: T.Optional(T.String({ description: '本地媒体文件绝对路径（与 taskID 二选一）' })),
      question: T.String({ description: '要问这个媒体的具体问题' }),
    }),
    async execute(_id: string, params: any, signal: AbortSignal) {
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
    },
  });
}
