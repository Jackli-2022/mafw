import { randomUUID } from 'crypto';

/**
 * mafw-host — pi 认知面宿主扩展（HostAdapter 的 pi 实现，Phase 2）。
 *
 * 事件映射：observe→message_end/tool_result；injectContext→context；
 * injectSystem→before_agent_start；tools→registerTool ×6。
 * ingestMedia 不在此（pi 原生 ImageContent + mafw-media wire 注入，§5.14）；
 * commands 不在此（gateway 命令注册表已 host-neutral，§5.13c）。
 * 全部 loopback HTTP → gateway 自身（与 v1 插件同出口：ACT-R 结算 /
 * FOK 采样 / 内部会话过滤口径零漂移）。
 */

export interface MafwHostDeps {
  sessionId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** ESM 桥取 pi 同实例 typebox 的 Type（registerTool 需要 TSchema 实例） */
  getType?: () => Promise<any>;
}

const OBS_TIMEOUT_MS = 5_000;
const RECALL_TIMEOUT_MS = 100;
const PINNED_TIMEOUT_MS = 150;
const SHORT_INCREMENT_MIN = 50;
const ASSISTANT_TAIL_MAX = 300;

export const MEMORY_GUIDE = `<memory-guide>
## 记忆

你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。
不主动记录，你将无法记得过去的决定、偏好与教训。

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的坑
  → 调用 mafw_add_memory（按内容选择 semantic / episodic / procedural，附 cueAnchors 关键词，每条一句话）
- 内容已被 repo 文件承载（代码/文档/ADR/issue）→ 记指针（路径 + 一句话 gist），不复述全文：文件是真相源，记忆只是索引
- **逐字保留标识符**：函数名 / 文件名 / 路径 / 命令 / 错误码 / 配置键原样写进 cueAnchors（或 primaryAbstraction），不翻译、不缩写——检索只匹配字面 token（实测：只在正文里出现的标识符 98% 查不到，收割后可达 98%）
- procedural 记忆结尾带"→ 下次用：<skill/工具/命令>"：记忆即路标，不只存档
- 不写冗余记忆

### 需要旧记忆：主动检索与取回
- 新任务开始、或不确定此事是否已知 → 调用 mafw_search_hybrid 检索
- <recall> 指针（#mem-xxxxxx）要依据其内容行动前 → 调用 mafw_get_memory(id 用 #mem- 后 6 位) 取全文

### 披露层（pinned）
- 用户身份/画像、长期偏好与约束 → mafw_add_memory 时 pinned: true（每轮保证注入）；任务相关、易变内容不要 pin
- 偏好/事实变了 → 新写一条并带 supersedes: 旧id（旧版自动失效，历史保留）
- 需要 pin/unpin 已有记忆 → mafw_pin_memory

### 便签板（sticky）
- 用户说"记下来 / 记住 / 别忘了" → mafw_add_memory 时带 sticky: true（默认 7 天，stickyDays 可调）
  → 便签板上每轮必见，到期自动下架（记忆本体保留可检索）
- 事已办完 → mafw_pin_memory { id, sticky: false } 下架；需要延期 → sticky: true + stickyDays 续期

### 子代理
子代理不得调用 mafw_add_memory / mafw_search_hybrid（防止重复写入），由父会话统一管理
</memory-guide>`;

/** 文本提取：跳过 synthetic 标记部件（本扩展注入的 <recall> 不回流进查询）。 */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as any[])
    .filter((c) => c?.type === 'text' && !c?.synthetic)
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('\n');
}

/** djb2（与桌面端 ChatPane.hashText / v1 media-speak 同实现）：speak 标记文本指纹。 */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export const MEDIA_EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.opus': 'audio/ogg',
};

const MAX_BYTES: Record<string, number> = {
  'image/': 20 * 1024 * 1024,
  'video/': 50 * 1024 * 1024,
  'audio/': 25 * 1024 * 1024,
};

/** 查询构造（v1 session-recall 同构）：增量优先，短增量并入 assistant 尾部。 */
export function buildRecallQuery(real: any[], increment: any[]): string {
  const base = increment.map((m: any) => contentToText(m.content)).join('\n');
  if (base.trim().length >= SHORT_INCREMENT_MIN) return base.slice(0, 500);
  const lastAssistant = [...real].reverse().find((m: any) => m?.role === 'assistant');
  const tail = lastAssistant ? contentToText(lastAssistant.content).trim().slice(-ASSISTANT_TAIL_MAX) : '';
  return [base, tail].filter((s) => s.trim()).join('\n').slice(0, 500);
}

export function createMafwHostExtension(deps: MafwHostDeps) {
  const f = (deps.fetchImpl ?? fetch) as typeof fetch;
  const sessionId = deps.sessionId;
  // 双模游标：优先消息 id；消息无 id 时退化为 real 计数（compaction 骤降自动回尾部窗口）
  let lastRealId: string | undefined;
  let lastRealCount = 0;

  async function postJson(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; body?: any; text?: string } | null> {
    try {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const res = await f(`${deps.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: sig,
      });
      let parsed: any;
      try { parsed = await res.json(); } catch { /* ignore */ }
      if (!res.ok || parsed?.success === false) {
        return { ok: false, body: parsed, text: `HTTP ${res.status}` };
      }
      return { ok: true, body: parsed };
    } catch (err: any) {
      return { ok: false, text: err?.message ?? String(err) };
    }
  }

  async function getJson(path: string, timeoutMs: number): Promise<any | null> {
    try {
      const res = await f(`${deps.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function postObs(source: string, content: string, failure = false): void {
    if (!content.trim()) return;
    void postJson('/api/obs/capture', { sessionID: sessionId, source, content, failure: failure ? 1 : 0 }, OBS_TIMEOUT_MS);
  }

  function buildIncrement(real: any[]): any[] {
    if (lastRealId) {
      const idx = real.findIndex((m: any) => m?.id === lastRealId);
      if (idx >= 0) return real.slice(idx + 1);
    }
    if (real.length >= lastRealCount && lastRealCount > 0) return real.slice(lastRealCount);
    return real.slice(-8);
  }

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

  return {
    name: 'mafw-host' as const,
    on: (pi: any) => {
      // === observe：user/assistant 文本 + thinking ===
      pi.on('message_end', async (event: any) => {
        const msg = event?.message;
        if (!msg) return;
        if (msg.role === 'user') {
          postObs('user_input', contentToText(msg.content));
        } else if (msg.role === 'assistant') {
          const arr = Array.isArray(msg.content) ? msg.content : [];
          const text = arr.filter((c: any) => c?.type === 'text').map((c: any) => c?.text || '').join('\n');
          const thinking = arr.filter((c: any) => c?.type === 'thinking').map((c: any) => c?.thinking || c?.text || '').join('\n');
          postObs('assistant_reply', text);
          if (thinking.trim()) postObs('reasoning', thinking);
        }
      });
      // === observe：工具结果（含 isError） ===
      pi.on('tool_result', async (event: any) => {
        const raw = event?.content;
        const text = Array.isArray(raw)
          ? raw.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          : String(raw ?? '');
        postObs('tool_result', `[${event?.toolName}]\n${text}`, Boolean(event?.isError));
      });
      // === injectContext：边界 recall（100ms 契约，fail-open） ===
      pi.on('context', async (event: any) => {
        const messages: any[] = Array.isArray(event?.messages) ? event.messages : [];
        if (messages.length === 0) return undefined;
        const real = messages.filter((m: any) => m && typeof m.role === 'string');
        if (real.length === 0) return undefined;
        const query = buildRecallQuery(real, buildIncrement(real));
        if (query.trim()) {
          const j = await getJson(`/api/recall/context?sessionID=${encodeURIComponent(sessionId)}&query=${encodeURIComponent(query)}`, RECALL_TIMEOUT_MS);
          const pointers = j?.pointers;
          if (pointers) {
            const lastUser = [...real].reverse().find((m: any) => m.role === 'user');
            if (lastUser) appendRecall(lastUser, pointers);
          }
        }
        const lastReal = real[real.length - 1];
        if (lastReal?.id) lastRealId = lastReal.id;
        lastRealCount = real.length;
        return { messages };
      });
      // === injectSystem：memory-guide（静态）+ pinned profile（150ms fail-open） ===
      pi.on('before_agent_start', async (event: any) => {
        let extra = MEMORY_GUIDE;
        const j = await getJson('/api/recall/pinned', PINNED_TIMEOUT_MS);
        if (typeof j?.profile === 'string' && j.profile.trim()) extra += '\n\n' + j.profile;
        return { systemPrompt: `${event?.systemPrompt ?? ''}\n\n${extra}` };
      });
      // === tools：六件套（typebox 经 ESM 桥；fail-open） ===
      void registerMafwTools(pi, deps, f).catch(() => { /* 工具面缺失不阻塞会话 */ });
    },
  };
}

async function a2aRequest(f: typeof fetch, baseUrl: string, method: string, params: unknown, signal?: AbortSignal): Promise<any> {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
  const res = await f(`${baseUrl}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: sig,
  });
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  const parsed: any = await res.json();
  if (parsed?.error) throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
  return parsed?.result;
}

function taskAnswer(task: any): string {
  const parts = task?.status?.message?.parts ?? [];
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

function makeMediaPointer(id: string, contextId: string, filename: string): string {
  return `[媒体附件 taskID: ${id} contextID: ${contextId}（媒体: ${filename}）]`;
}

/** 读取媒体（本地路径 / file:// / data URL）为 A2A raw FilePart 载荷。 */
export function mediaDataFromSource(mediaPath: string): { data: string; mediaType: string; filename: string } | null {
  const fs = require('fs') as typeof import('fs');
  let mediaType: string | undefined;
  let data: string | undefined;
  let filename = 'media.bin';
  if (mediaPath.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(mediaPath);
    if (!m) return null;
    mediaType = m[1];
    data = m[3];
  } else {
    const path = mediaPath.startsWith('file://') ? decodeURIComponent(mediaPath.slice('file://'.length)) : mediaPath;
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    mediaType = MEDIA_EXT_MIME[ext];
    if (!mediaType) return null;
    filename = path.split(/[\\/]/).pop() || filename;
    const bytes = fs.readFileSync(path);
    const kindPrefix = mediaType.split('/')[0] + '/';
    const max = MAX_BYTES[kindPrefix] ?? Infinity;
    if (bytes.length > max) throw new Error(`媒体过大：${(bytes.length / 1048576).toFixed(1)}MB 超过上限 ${(max / 1048576).toFixed(0)}MB`);
    data = bytes.toString('base64');
  }
  if (!mediaType || !data) return null;
  return { data, mediaType, filename };
}

/** 工具执行里的 POST（带 signal 合并超时）。 */
async function postToolJson(f: typeof fetch, base: string, path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; body?: any; text?: string }> {
  try {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const res = await f(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: sig });
    let parsed: any;
    try { parsed = await res.json(); } catch { /* ignore */ }
    if (!res.ok || parsed?.success === false) return { ok: false, body: parsed, text: `HTTP ${res.status}` };
    return { ok: true, body: parsed };
  } catch (err: any) { return { ok: false, text: err?.message ?? String(err) }; }
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
