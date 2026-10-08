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
      // tools 由后续任务追加
    },
  };
}
