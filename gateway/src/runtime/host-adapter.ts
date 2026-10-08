/**
 * HostAdapter —— 认知面契约（Phase 3 形式化，2026-10-08）。
 *
 * 编排面契约见 contract.ts（RuntimeClient：gateway→runtime 的 session/prompt/
 * event/approval/branch/completion）。本文件定义**认知面**：宿主适配器（跑在
 * runtime 进程/会话内）对 gateway 的四动词，协议 = loopback HTTP（宿主语言/
 * 进程无关）：
 *
 *   observe       事件 → POST /api/obs/capture {sessionID, source, content, failure}
 *                 source ∈ user_input | assistant_reply | tool_result | reasoning
 *   injectContext 每次 LLM 调用前 → GET /api/recall/context?sessionID=&query=
 *                 （100ms fail-open；游标增量 + 短增量并入 assistant 尾部；
 *                  注入物 = synthetic 部件标记，不回流查询）
 *   injectSystem  每回合 → GET /api/recall/pinned（150ms fail-open）+
 *                 静态 MEMORY_GUIDE，追加到 system 尾部
 *   tools         六件套（add_memory / python ×2 / media ×3）经
 *                 /api/memory/add、/api/python/*、/api/tts、/a2a
 *
 * 时序契约（COGNITION_CONTRACT）与一致性验证（S3/S4 场景，
 * POST /api/runtime/conformance）对全部宿主一致。
 *
 * 三实现：v1 opencode 插件（root src/plugin.ts，原生实现同语义、刻意不经本
 * 文件——生产宿主不重构，v2 迁移时以本核心为核）；pi extension
 * （runtime/pi/pi-mafw-host-extension.ts，消费本文件）；opencode v2 插件
 * （待迁移，spike 原型见 docs/research/2026-10-03-agent-runtime-sdk-survey.md §8）。
 */

export const COGNITION_CONTRACT = {
  obsTimeoutMs: 5_000,
  recallTimeoutMs: 100,
  pinnedTimeoutMs: 150,
  shortIncrementMin: 50,
  assistantTailMax: 300,
} as const;

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

/** 文本提取：跳过 synthetic 标记部件（宿主注入的 <recall> 不回流进查询）。 */
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
  if (base.trim().length >= COGNITION_CONTRACT.shortIncrementMin) return base.slice(0, 500);
  const lastAssistant = [...real].reverse().find((m: any) => m?.role === 'assistant');
  const tail = lastAssistant ? contentToText(lastAssistant.content).trim().slice(-COGNITION_CONTRACT.assistantTailMax) : '';
  return [base, tail].filter((s) => s.trim()).join('\n').slice(0, 500);
}

/** 会话级 recall 游标（双模：消息 id 优先；无 id 环境退化为计数；compaction 骤降回尾部窗口）。 */
export function createRecallCursor() {
  let lastRealId: string | undefined;
  let lastRealCount = 0;
  return {
    /** 本轮应建查询的增量消息（不推进游标——advance 单独调用）。 */
    next(real: any[]): any[] {
      if (lastRealId) {
        const idx = real.findIndex((m: any) => m?.id === lastRealId);
        if (idx >= 0) return real.slice(idx + 1);
      }
      if (real.length >= lastRealCount && lastRealCount > 0) return real.slice(lastRealCount);
      return real.slice(-8);
    },
    /** 处理完成后推进游标到 real 末尾。 */
    advance(real: any[]): void {
      const lastReal = real[real.length - 1];
      if (lastReal?.id) lastRealId = lastReal.id;
      lastRealCount = real.length;
    },
  };
}

export interface CognitionClientOptions {
  sessionId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface CognitionClient {
  /** observe 动词：fire-and-forget POST /api/obs/capture（空内容跳过，fail-open）。 */
  observe(source: 'user_input' | 'assistant_reply' | 'tool_result' | 'reasoning', content: string, failure?: boolean): void;
  /** injectContext 动词的取数：GET /api/recall/context（100ms fail-open）。 */
  fetchRecallPointers(query: string): Promise<string | null>;
  /** injectSystem 动词的取数：GET /api/recall/pinned（150ms fail-open）。 */
  fetchPinnedProfile(): Promise<string | null>;
  /** 工具执行用的通用 POST（fail-open 返回 {ok:false,text}）。 */
  postJson(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; body?: any; text?: string }>;
  /** 通用 GET（fail-open 返回 null）。 */
  getJson(path: string, timeoutMs: number): Promise<any | null>;
}

/** 认知面 loopback 客户端（参考实现；v2 适配器复用）。 */
export function createCognitionClient(opts: CognitionClientOptions): CognitionClient {
  const f = (opts.fetchImpl ?? fetch) as typeof fetch;
  const sessionId = opts.sessionId;

  async function postJson(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; body?: any; text?: string }> {
    try {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const res = await f(`${opts.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: sig,
      });
      let parsed: any;
      try { parsed = await res.json(); } catch { /* ignore */ }
      if (!res.ok || parsed?.success === false) return { ok: false, body: parsed, text: `HTTP ${res.status}` };
      return { ok: true, body: parsed };
    } catch (err: any) {
      return { ok: false, text: err?.message ?? String(err) };
    }
  }

  async function getJson(path: string, timeoutMs: number): Promise<any | null> {
    try {
      const res = await f(`${opts.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  return {
    observe(source, content, failure = false) {
      if (!content.trim()) return;
      void postJson('/api/obs/capture', { sessionID: sessionId, source, content, failure: failure ? 1 : 0 }, COGNITION_CONTRACT.obsTimeoutMs);
    },
    async fetchRecallPointers(query: string) {
      if (!query.trim()) return null;
      const j = await getJson(`/api/recall/context?sessionID=${encodeURIComponent(sessionId)}&query=${encodeURIComponent(query)}`, COGNITION_CONTRACT.recallTimeoutMs);
      return typeof j?.pointers === 'string' ? j.pointers : null;
    },
    async fetchPinnedProfile() {
      const j = await getJson('/api/recall/pinned', COGNITION_CONTRACT.pinnedTimeoutMs);
      return typeof j?.profile === 'string' && j.profile.trim() ? j.profile : null;
    },
    postJson,
    getJson,
  };
}

// ---------- 工具动词的 HTTP 核心（宿主 glue 各自包装 schema/execute 签名） ----------

/** A2A JSON-RPC 请求（media_ask / media_upload 共用）。 */
export async function a2aRequest(f: typeof fetch, baseUrl: string, method: string, params: unknown, signal?: AbortSignal): Promise<any> {
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

/** A2A 任务回答文本提取。 */
export function taskAnswer(task: any): string {
  const parts = task?.status?.message?.parts ?? [];
  return parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

/** 媒体指针格式（与 v1 插件/桌面端一致）。 */
export function makeMediaPointer(id: string, contextId: string, filename: string): string {
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

/** 工具执行里的 POST（带 signal 合并超时；fail-open 返回 {ok:false,text}）。 */
export async function postToolJson(f: typeof fetch, base: string, path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; body?: any; text?: string }> {
  try {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const res = await f(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: sig });
    let parsed: any;
    try { parsed = await res.json(); } catch { /* ignore */ }
    if (!res.ok || parsed?.success === false) return { ok: false, body: parsed, text: `HTTP ${res.status}` };
    return { ok: true, body: parsed };
  } catch (err: any) { return { ok: false, text: err?.message ?? String(err) }; }
}
