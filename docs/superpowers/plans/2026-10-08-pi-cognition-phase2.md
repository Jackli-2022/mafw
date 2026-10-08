# Phase 2: pi 认知面补齐（mafw-host extension + approval 旁路修复）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 pi runtime 达到与 v1 插件同等的认知面（obs 捕获/边界 recall/系统注入/六工具），并修复 pi autoApprove 静态旁路（对齐 gateway 三档审批政策）——HostAdapter 契约的第二个实现。

**Architecture:** 新增单一扩展文件 `gateway/src/runtime/pi/pi-mafw-host-extension.ts`，factory 注入模式与现有三个 pi 扩展一致（`PiSessionRegistry.create()/fork()` 的 `extensionFactories`）。**全部经 loopback HTTP 调 gateway 自身**（与 v1 插件同出口：ACT-R 结算 / FOK 采样 / 内部会话过滤口径零漂移，同时验证 HostAdapter 契约）。approval 修复删除隐式静态表，注入 `ApprovalPolicyService.evaluate`（同步）直评 + ask→政策环兜底。

**Tech Stack:** TypeScript (gateway CJS)、pi ExtensionAPI（`message_end`/`tool_result`/`context`/`before_agent_start`/`registerTool`）、typebox（经 ESM 桥取 pi 同实例）、jest。

## Global Constraints

- TDD：每任务先写失败测试再实现。
- `git add` 路径 repo 根相对；中文内容只经 write/edit 工具。
- **jest 不 typecheck index.ts**——改 index.ts 后必须 `cd gateway && npm run build` 验证。
- 发版流程：root `npm run build` → `cd gateway && npx jest --runInBand` → `npm pack` → `mafw stop` → `npm install -g jack200714-mafw-<ver>.tgz` → `mafw daemon` → health。
- 基线：233 suites / 1512 tests（v4.17.0）；本计划新增 ~20 测试。
- 不改 v1 插件（root src/）任何文件。

## 背景事实（执行者必读）

1. **pi 事件形状**（pi-coding-agent 0.84.1 docs 实测）：
   - `message_end`：`event.message`，role ∈ user/assistant/toolResult；user `content: string|(Text|Image)[]`；assistant `content: (Text|Thinking|ToolCall)[]`
   - `tool_result`：`{toolName, toolCallId, input, content, details, isError, usage}`，content 为块数组
   - `context`：每次 LLM 调用，`event.messages` 深拷贝，**返回 `{messages}` 替换**
   - `before_agent_start`：返回 `{systemPrompt}` 链式追加（还有 `{message}` 持久注入，本计划不用）
   - `registerTool`：`{name, label, description, parameters: TSchema, async execute(toolCallId, params, signal, onUpdate, ctx) → {content:[{type:'text',text}], details:{}}}`
2. **typebox 同实例**：`parameters` 必须是 typebox `TSchema` 实例。pi 不 re-export；gateway 顶层无 typebox。**经 ESM 桥 import `@earendil-works/pi-coding-agent/node_modules/typebox`**（同进程同解析文件 → 同模块实例 → symbol 同一性）。
3. **gateway 端点**（全部 loopback）：
   - obs：`POST /api/obs/capture` `{sessionID, source: user_input|assistant_reply|tool_result|reasoning, content: string, failure?: 1|0}`
   - recall：`GET /api/recall/context?sessionID=&query=` → `{pointers: string|null}`（100ms 契约）
   - pinned：`GET /api/recall/pinned` → `{profile?: string}`（150ms fail-open）
   - add memory：`POST /api/memory/add` `{content, memoryType, cueAnchors, primaryAbstraction, importance, sessionID}`
   - python：`POST /api/python/execute` `{sessionID, code}`；`POST /api/python/restart` `{sessionID}` → `{ok}`
   - tts：`POST /api/tts` `{text, voice, style}` → `{artifactId, voice, url}`
   - a2a：`POST /a2a` JSON-RPC `{jsonrpc:'2.0', id:1, method, params}`，头 `A2A-Version: 1.0`
4. **approval 政策环已通**：pi 的 `permission.asked` → normalize.ts:148 提取 approval facet（requestId/toolName）→ index.ts:988 `applyApprovalPolicy` → `evaluate` → 非 human 则 `void runtime.session.permissionReply(...)` 自动回。`ApprovalPolicyService.evaluate(sessionID, {toolName, patterns, metadata})` **同步**，返回 `{action: 'auto-approve'|'auto-deny'|'human', reason}`。
5. **runtime 注入点**：index.ts 三处 `this.runtime = runtime`（468 启动 / 757 热切换 / 1379）。pi-runtime 返回的 AgentRuntime 带 `registry`（PiSessionRegistry）。
6. **指针格式**：`[媒体附件 taskID: ${id} contextID: ${contextId}（媒体: ${filename}）]`；speak 标记 `[语音回复 art:${artifactId} 音色:${voice} h:${djb2}]`。

---

### Task 1: 扩展骨架 + observe（obs 捕获）

**Files:**
- Create: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`
- Test: `gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`

**Interfaces:**
- Produces: `createMafwHostExtension(deps: MafwHostDeps)` → `{ name: 'mafw-host', on(pi) }`；`MafwHostDeps = { sessionId, baseUrl, fetchImpl?, getType? }`

- [ ] **Step 1: 写失败测试（骨架 + observe）**

```typescript
// gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
import { createMafwHostExtension } from '../../../src/runtime/pi/pi-mafw-host-extension';

type Req = { url: string; method: string; body?: any };
type Res = { ok: boolean; json?: any };

function makeFakeFetch(routes: Array<{ match: (r: Req) => boolean; res: Res }>) {
  const calls: Req[] = [];
  const fetchImpl: any = async (url: string, init?: any) => {
    const req: Req = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    const hit = routes.find((r) => r.match(req));
    if (!hit) throw new Error(`no route for ${req.method} ${req.url}`);
    return { ok: hit.res.ok, json: async () => hit.res.json };
  };
  return { calls, fetchImpl };
}

function makeFakePi() {
  const handlers = new Map<string, Function[]>();
  const tools: any[] = [];
  const pi: any = {
    on: (ev: string, fn: Function) => { (handlers.get(ev) ?? handlers.set(ev, []).get(ev)!).push(fn); },
    registerTool: (t: any) => tools.push(t),
  };
  return { pi, handlers, tools, fire: async (ev: string, event: any) => { for (const fn of handlers.get(ev) ?? []) await fn(event, {}); } };
}

describe('pi-mafw-host-extension observe', () => {
  it('user message_end → POST obs user_input', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'user', content: 'hello world' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ sessionID: 'pi_s1', source: 'user_input', content: 'hello world' });
  });

  it('assistant message_end → assistant_reply + reasoning 两条', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'let me think' },
      { type: 'text', text: 'the answer' },
    ] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.map((c) => c.body.source)).toEqual(['assistant_reply', 'reasoning']);
    expect(calls[0].body.content).toBe('the answer');
    expect(calls[1].body.content).toBe('let me think');
  });

  it('tool_result → tool_result with failure flag', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('tool_result', { toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].body).toMatchObject({ source: 'tool_result', failure: true });
    expect(calls[0].body.content).toContain('bash');
    expect(calls[0].body.content).toContain('boom');
  });

  it('空内容不 POST', async () => {
    const { calls, fetchImpl } = makeFakeFetch([{ match: (r) => r.url.includes('/api/obs/capture'), res: { ok: true, json: {} } }]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('message_end', { message: { role: 'user', content: '   ' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现骨架 + observe**

```typescript
// gateway/src/runtime/pi/pi-mafw-host-extension.ts
import { randomUUID } from 'crypto';

/**
 * mafw-host — pi 认知面宿主扩展（HostAdapter 的 pi 实现，Phase 2）。
 *
 * 事件映射：observe→message_end/tool_result；injectContext→context；
 * injectSystem→before_agent_start；tools→registerTool ×6。
 * ingestMedia 不在此（pi 原生 ImageContent + mafw-media wire 注入）；
 * commands 不在此（gateway 命令注册表已 host-neutral，§5.13c）。
 * 全部 loopback HTTP → gateway 自身（与 v1 插件同出口，结算口径零漂移）。
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
      // injectContext / injectSystem / tools 由后续 Task 追加
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```powershell
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "feat(pi): mafw-host extension skeleton + observe (obs capture via loopback)"
```

---

### Task 2: injectContext（边界 recall，双模游标）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`
- Test: `gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `postJson/getJson/contentToText`
- Produces: `context` 事件处理器（`{ messages }` 返回）；导出 `buildRecallQuery(real, increment)` 供测试

- [ ] **Step 1: 追加失败测试**

```typescript
import { createMafwHostExtension, buildRecallQuery } from '../../../src/runtime/pi/pi-mafw-host-extension';

describe('pi-mafw-host injectContext', () => {
  it('首次 context：全量建 query，注入到 last user 的 content（string→array 转换）', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: '<recall>#mem-abc123 test</recall>' } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const messages = [
      { id: 'm1', role: 'user', content: '关于 laya 判官' },
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '判官已部署观察模式' }] },
      { id: 'm3', role: 'user', content: '继续' },
    ];
    const ret = await fire('context', { messages });
    const get = calls.find((c) => c.method === 'GET');
    expect(get.url).toContain('/api/recall/context');
    expect(decodeURIComponent(get.url)).toContain('laya');
    expect(ret[0]).toEqual({ messages });
    const lastUser = messages[messages.length - 1];
    expect(Array.isArray(lastUser.content)).toBe(true);
    expect(JSON.stringify(lastUser.content)).toContain('<recall>');
    expect((lastUser.content as any[]).some((c) => c.synthetic === true)).toBe(true);
  });

  it('游标增量：第二次同会话只对新增消息建 query', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/context'), res: { ok: true, json: { pointers: null } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    await fire('context', { messages: [{ id: 'm1', role: 'user', content: 'first question about alpha' }] });
    await fire('context', { messages: [
      { id: 'm1', role: 'user', content: 'first question about alpha' },
      { id: 'm2', role: 'user', content: 'now about beta' },
    ] });
    const urls = calls.map((c) => decodeURIComponent(c.url));
    expect(urls[1]).toContain('beta');
    expect(urls[1]).not.toContain('alpha');
  });

  it('短增量回退：increment 过短时并入 assistant 尾部', () => {
    const real = [
      { id: 'a', role: 'user', content: '长问题' + 'x'.repeat(100) },
      { id: 'b', role: 'assistant', content: [{ type: 'text', text: '答案尾部上下文' + 'y'.repeat(300) }] },
    ];
    const increment = [real[1]];
    const q = buildRecallQuery(real, increment);
    // increment 是 assistant 长文本 → 直接用（>=50 字符）
    expect(q).toContain('y');
  });

  it('recall 超时/失败 → 不注入不抛错', async () => {
    const fetchImpl: any = async () => { throw new Error('timeout'); };
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const messages = [{ id: 'm1', role: 'user', content: 'query text' }];
    const ret = await fire('context', { messages });
    expect(ret[0]).toEqual({ messages });
    expect(messages[0].content).toBe('query text'); // 未被改写
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 injectContext**

在 `createMafwHostExtension` 内、`on(pi)` 前追加：

```typescript
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
```

模块级导出（供测试）：

```typescript
/** 查询构造（v1 session-recall 同构）：增量优先，短增量并入 assistant 尾部。 */
export function buildRecallQuery(real: any[], increment: any[]): string {
  const base = increment.map((m: any) => contentToText(m.content)).join('\n');
  if (base.trim().length >= SHORT_INCREMENT_MIN) return base.slice(0, 500);
  const lastAssistant = [...real].reverse().find((m: any) => m?.role === 'assistant');
  const tail = lastAssistant ? contentToText(lastAssistant.content).trim().slice(-ASSISTANT_TAIL_MAX) : '';
  return [base, tail].filter((s) => s.trim()).join('\n').slice(0, 500);
}
```

`on(pi)` 内追加：

```typescript
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
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**

```powershell
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "feat(pi): boundary recall injection in context event (dual-mode cursor, 100ms fail-open)"
```

---

### Task 3: injectSystem（memory-guide + pinned profile）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`
- Test: 同测试文件（追加）

- [ ] **Step 1: 追加失败测试**

```typescript
describe('pi-mafw-host injectSystem', () => {
  it('before_agent_start 返回原 prompt + memory-guide + pinned', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/recall/pinned'), res: { ok: true, json: { profile: '<user-profile>- 偏好 TDD</user-profile>' } } },
    ]);
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const ret = await fire('before_agent_start', { systemPrompt: 'BASE' });
    expect(ret[0].systemPrompt).toContain('BASE');
    expect(ret[0].systemPrompt).toContain('<memory-guide>');
    expect(ret[0].systemPrompt).toContain('<user-profile>');
  });

  it('pinned 超时 → 只有 guide（fail-open）', async () => {
    const fetchImpl: any = async () => { throw new Error('timeout'); };
    const { pi, fire } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl }).on(pi);
    const ret = await fire('before_agent_start', { systemPrompt: 'BASE' });
    expect(ret[0].systemPrompt).toContain('<memory-guide>');
    expect(ret[0].systemPrompt).not.toContain('<user-profile>');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（`on(pi)` 内追加）

```typescript
      // === injectSystem：memory-guide（静态）+ pinned profile（150ms fail-open） ===
      pi.on('before_agent_start', async (event: any) => {
        let extra = MEMORY_GUIDE;
        try {
          const j = await getJson('/api/recall/pinned', PINNED_TIMEOUT_MS);
          if (typeof j?.profile === 'string' && j.profile.trim()) extra += '\n\n' + j.profile;
        } catch { /* fail-open */ }
        return { systemPrompt: `${event?.systemPrompt ?? ''}\n\n${extra}` };
      });
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**

```powershell
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "feat(pi): system injection - memory guide + pinned profile via before_agent_start"
```

---

### Task 4: 六工具 registerTool

**Files:**
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`
- Test: 同测试文件（追加）

**Interfaces:**
- Consumes: `deps.getType`（测试传 fake）
- Produces: `registerMafwTools(pi, deps, f)`（模块内部函数）；fake typebox 形状 `{Object, String, Optional, Number, Array, Union, Literal}`

- [ ] **Step 1: 追加失败测试**

```typescript
const FakeType: any = {
  Object: (o: any) => ({ type: 'object', properties: o }),
  String: (d: any) => ({ type: 'string', ...(d || {}) }),
  Optional: (s: any) => s,
  Number: (d: any) => ({ type: 'number', ...(d || {}) }),
  Array: (s: any) => ({ type: 'array', items: s }),
  Union: (a: any[]) => ({ anyOf: a }),
  Literal: (v: any) => ({ const: v }),
};

function typeboxFetchFake(routes: Array<{ match: (r: Req) => boolean; res: Res }>) {
  return makeFakeFetch(routes);
}

describe('pi-mafw-host tools', () => {
  it('注册 6 个工具', async () => {
    const { fetchImpl } = typeboxFetchFake([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_python', 'mafw_python_restart',
    ]);
  });

  it('getType 失败 → 不注册不抛错（fail-open）', async () => {
    const { fetchImpl } = typeboxFetchFake([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => { throw new Error('no typebox'); } }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools).toHaveLength(0);
  });

  it('mafw_add_memory → POST /api/memory/add 带正确 body', async () => {
    const { calls, fetchImpl } = typeboxFetchFake([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: true, json: { success: true, id: 'mem_1' } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_add_memory');
    const out = await tool.execute('call1', { content: '测试记忆', cueAnchors: ['a', 'b'] }, undefined as any, undefined as any, {} as any);
    expect(calls[0].body).toMatchObject({ content: '测试记忆', sessionID: 'pi_s1', cueAnchors: ['a', 'b'] });
    expect(out.content[0].text).toContain('mem_1');
  });

  it('mafw_media_speak → 返回带 djb2 hash 的标记', async () => {
    const { fetchImpl } = typeboxFetchFake([
      { match: (r) => r.url.includes('/api/tts'), res: { ok: true, json: { artifactId: 'art_9', voice: '茉莉', url: '/x.wav' } } },
    ]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const tool = tools.find((t: any) => t.name === 'mafw_media_speak');
    const out = await tool.execute('c', { text: '你好' }, undefined as any, undefined as any, {} as any);
    expect(out.content[0].text).toBe(`[语音回复 art:art_9 音色:茉莉 h:${hashText('你好')}]`);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 registerMafwTools**（模块级函数 + `on(pi)` 末尾调用 `void registerMafwTools(pi, deps, f).catch(() => {})`）

```typescript
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
function mediaDataFromSource(mediaPath: string): { data: string; mediaType: string; filename: string } | null {
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
    description: '将文本合成为语音。用户通过语音消息输入时必须调用本工具以语音回复。返回 [语音回复 art:... 音色:... h:...] 标记，必须原样包含在回复文本中。',
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
```

`on(pi)` 末尾追加：

```typescript
      // === tools：六件套（typebox 经 ESM 桥；fail-open） ===
      void registerMafwTools(pi, deps, f).catch(() => { /* 工具面缺失不阻塞会话 */ });
```

- [ ] **Step 4: 跑测试确认通过**（`cd gateway && npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts`，预期 ~13 PASS）
- [ ] **Step 5: Commit**

```powershell
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "feat(pi): six mafw tools registered natively (loopback HTTP, typebox via ESM bridge)"
```

---

### Task 5: approval 旁路修复

**Files:**
- Modify: `gateway/src/runtime/pi/pi-approval-extension.ts`
- Modify: `gateway/src/runtime/pi/pi-session.ts`（registry 选项 + 扩展传参）
- Modify: `gateway/src/index.ts`（三处注入点）
- Test: `gateway/tests/unit/runtime/pi-approval-extension.test.ts`（更新）

**Interfaces:**
- Produces: `createMafwApprovalExtension(bridge, emitEvent, policy, gatewaySessionId, evaluatePermission?)`；`ApprovalPolicy.autoApprove` 语义变为"会话动态 allowlist + config 显式预置"（**不再有隐式默认五件套**）；`PiSessionRegistryOptions.evaluatePermission?: (sessionID, candidate) => { action, reason } | null`

- [ ] **Step 1: 更新测试（先失败）**

`pi-approval-extension.test.ts` 修改：

1. **删除** `'should auto-approve read-only tools'`（旧行为断言），替换为：

```typescript
  it('read 工具不再隐式旁路：无评估器时走 human 问询（gateway 政策环兜底）', async () => {
    const event = { toolName: 'read', input: { path: '/tmp/file' } };
    const promise = toolCallHandler(event, { sessionId: 'session-1' });
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].payload!.type).toBe('permission.asked');
    bridge.reply(emittedEvents[0].payload!.properties.requestId, true);
    await promise;
  });

  it('评估器 auto-approve → 直接放行不 emit（无卡片闪烁）', async () => {
    const evalExt = createMafwApprovalExtension(
      bridge, (event) => emittedEvents.push(event),
      { autoApprove: [], autoDeny: [] },
      'gw-ses-1',
      (sid: string, c: any) => c.toolName === 'read' ? { action: 'auto-approve', reason: 'read-only mode' } : { action: 'human', reason: '' },
    );
    const em = { on: jest.fn() };
    evalExt.on(em);
    const handler = em.on.mock.calls.find((c: any) => c[0] === 'tool_call')![1];
    const result = await handler({ toolName: 'read', input: {} }, { sessionId: 'pi-native' });
    expect(result).toBeUndefined();
    expect(emittedEvents).toHaveLength(0);
  });

  it('评估器 auto-deny → block', async () => {
    const evalExt = createMafwApprovalExtension(
      bridge, (event) => emittedEvents.push(event),
      { autoApprove: [], autoDeny: [] },
      'gw-ses-1',
      () => ({ action: 'auto-deny', reason: 'internal session fail-safe' }),
    );
    const em = { on: jest.fn() };
    evalExt.on(em);
    const handler = em.on.mock.calls.find((c: any) => c[0] === 'tool_call')![1];
    const result = await handler({ toolName: 'read', input: {} }, { sessionId: 'pi-native' });
    expect(result).toEqual({ block: true, reason: 'internal session fail-safe' });
  });
```

2. 其余既有用例（autoDeny 配置、ask+bridge、always 动态表、reject message、replied decision、metadata）保持——它们与新政语义兼容。

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 修改 pi-approval-extension.ts**

```typescript
export interface ApprovalPolicy {
  /** 会话级动态 allowlist（'always' 决定 + config 显式预置；2026-10-08 起无隐式默认五件套） */
  autoApprove: string[];
  /** 显式配置的拒绝表（默认空） */
  autoDeny: string[];
}

const DEFAULT_POLICY: ApprovalPolicy = { autoApprove: [], autoDeny: [] };

export type PermissionEvaluator = (
  sessionID: string,
  candidate: { toolName: string; patterns?: string[]; metadata?: Record<string, unknown> },
) => { action: 'auto-approve' | 'auto-deny' | 'human'; reason: string } | null;

export function createMafwApprovalExtension(
  bridge: ApprovalBridge,
  emitEvent: (event: RawRuntimeEvent) => void,
  policy: ApprovalPolicy = DEFAULT_POLICY,
  gatewaySessionId: string,
  evaluatePermission?: PermissionEvaluator,
) {
```

`tool_call` handler 顺序改为：

```typescript
        // 1. 会话 allowlist（用户 'always' / config 显式预置）
        if (policy.autoApprove.includes(toolName)) return;
        // 2. 显式 autoDeny
        if (policy.autoDeny.includes(toolName)) {
          return { block: true, reason: 'auto-denied by policy' };
        }
        // 3. gateway 三档政策（同步直评——auto 路径不 emit，避免卡片闪烁）
        if (evaluatePermission) {
          try {
            const decision = evaluatePermission(gatewaySessionId, {
              toolName,
              patterns: [],
              metadata: { args: event.input },
            });
            if (decision?.action === 'auto-approve') return;
            if (decision?.action === 'auto-deny') {
              return { block: true, reason: decision.reason || 'auto-denied by gateway policy' };
            }
          } catch { /* 评估器异常 → human 兜底（宁多问不误放行） */ }
        }
        // 4. human：emit permission.asked + await bridge
        //    （ask→normalize facet→applyApprovalPolicy 政策环仍是兜底路径）
```

（第 4 步起的现有代码不变。）

- [ ] **Step 4: pi-session.ts 传递评估器**

`PiSessionRegistryOptions` 加：

```typescript
  evaluatePermission?: (sessionID: string, candidate: { toolName: string; patterns?: string[]; metadata?: Record<string, unknown> }) => { action: 'auto-approve' | 'auto-deny' | 'human'; reason: string } | null;
```

`create()` 与 `fork()` 里 `createMafwApprovalExtension(bridge, this.emitEvent, sessionPolicy as any, id)` 改为第 5 参传 `this.opts.evaluatePermission`。

- [ ] **Step 5: index.ts 三处注入**

模块级 helper（`applyApprovalPolicy` import 旁）：

```typescript
function wirePiPermissionEvaluator(runtime: AgentRuntime, policy: ApprovalPolicyService): void {
  const registry = (runtime as any).registry;
  if (typeof registry?.setPermissionEvaluator === 'function') {
    registry.setPermissionEvaluator((sessionID: string, candidate: any) => {
      try { return policy.evaluate(sessionID, candidate); } catch { return null; }
    });
  }
}
```

`PiSessionRegistry` 加方法：

```typescript
  setPermissionEvaluator(fn: NonNullable<PiSessionRegistryOptions['evaluatePermission']>): void {
    this.opts.evaluatePermission = fn;
  }
```

index.ts 三处 `this.runtime = ...` 之后各加一行：

```typescript
        wirePiPermissionEvaluator(runtime, this.approvalPolicy);
```

（468 处变量名 `runtime`；757 处 `runtime`；1379 处 `rt`——按实际变量名。）

- [ ] **Step 6: 跑测试 + gateway build（index.ts 不被 jest typecheck）**

```powershell
cd gateway; npx jest tests/unit/runtime/pi-approval-extension.test.ts tests/unit/runtime/pi-session.test.ts; npm run build
```

- [ ] **Step 7: Commit**

```powershell
git add gateway/src/runtime/pi/pi-approval-extension.ts gateway/src/runtime/pi/pi-session.ts gateway/src/index.ts gateway/tests/unit/runtime/pi-approval-extension.test.ts
git commit -m "fix(pi): route approvals through gateway policy (kill static read-only bypass, sync evaluator)"
```

---

### Task 6: 接线（pi-session create/fork + pi-runtime baseUrl）+ 全量回归

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`（hostExtension 注入）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（registry options）

- [ ] **Step 1: pi-session.ts 注入 hostExtension**

`PiSessionRegistryOptions` 加 `hostBaseUrl?: string`。`create()` 在 mediaExtension 之后：

```typescript
    const hostExtension = this.opts.hostBaseUrl
      ? createMafwHostExtension({ sessionId: id, baseUrl: this.opts.hostBaseUrl, getType: this.opts.getType })
      : null;
```

`allExtensions` 数组变为：

```typescript
    const allExtensions = [
      { name: 'mafw-approval', factory: (pi: any) => approvalExtension.on(pi) },
      compactionExtension,
      mediaExtension,
      ...(hostExtension ? [{ name: 'mafw-host', factory: (pi: any) => hostExtension.on(pi) }] : []),
      ...agentExtensions,
    ];
```

`fork()` 同样处理（newId 版本）。import 加：

```typescript
import { createMafwHostExtension } from './pi-mafw-host-extension';
```

`PiSessionRegistryOptions` 同时加：

```typescript
  /** ESM 桥取 pi 同实例 typebox（pi-runtime 注入；host 工具注册用） */
  getType?: () => Promise<any>;
```

- [ ] **Step 2: pi-runtime.ts 传 baseUrl 与 getType**

registry 构造 options 追加（142 行附近）：

```typescript
  }, {
    sessionTtlMs: cfg.sessionTtlMs,
    emitEvent: (evt) => eventStream.push(evt),
    policy: cfg.approvalPolicy,
    ...(cfg.hostExtension === false ? {} : {
      hostBaseUrl: `http://127.0.0.1:${ctx.gatewayPort ?? config.server.apiPort ?? 3000}`,
      getType: async () => {
        const mod = await imp('@earendil-works/pi-coding-agent/node_modules/typebox');
        return mod.Type;
      },
    }),
  });
```

- [ ] **Step 3: 全量测试 + build**

```powershell
cd gateway; npx jest --runInBand 2>&1 | Select-String "Suites:|Tests:"
npm run build
```
Expected: **233+1 suites / 1512+新增 全部 PASS**（新增 pi-mafw-host-extension.test.ts 套件）；build 零错误。

- [ ] **Step 4: Commit**

```powershell
git add gateway/src/runtime/pi/pi-session.ts gateway/src/runtime/plugins/pi-runtime.ts
git commit -m "feat(pi): wire mafw-host extension into session creation (config-gated, default on)"
```

---

### Task 7: 文档 + 发版 4.18.0

- [ ] **Step 1: AGENTS.md 更新**

§5.19 pi 段（"内置插件：pi-coding-agent runtime"小节）追加：

```markdown
**认知面宿主扩展 mafw-host（2026-10-08，Phase 2）**：`runtime/pi/pi-mafw-host-extension.ts`，随会话 factory 注入（create/fork 双路径，`runtime.pluginConfig.pi.hostExtension !== false` 默认开）。四动词：observe（message_end user/assistant+thinking + tool_result → loopback `/api/obs/capture`）、injectContext（context 事件，双模游标=id 优先/count 回退，短增量并入 assistant 尾部，100ms fail-open，synthetic part 标记防回流）、injectSystem（before_agent_start 链式追加 `<memory-guide>` + pinned `<user-profile>`）、tools（六件套 registerTool，typebox 经 ESM 桥 import `@earendil-works/pi-coding-agent/node_modules/typebox` 取同实例）。与 v1 插件完全同出口（loopback HTTP）——ACT-R 结算/FOK 采样/内部会话过滤零漂移。**approval 旁路已修**：静态 autoApprove 五件套删除，改为 `evaluatePermission`（ApprovalPolicyService.evaluate 同步直评，index.ts 三处 runtime 赋值点注入）+ ask→政策环（applyApprovalPolicy）兜底；`ApprovalPolicy.autoApprove` 语义 = 会话动态 allowlist + config 显式预置。
```

同时删除 §5.19 "已知边界"中"pi 扩展内置 autoApprove（read/grep/ls/find/glob）先于 gateway 放行的旁路未统一"整句。

- [ ] **Step 2: 版本 + 全量验证 + 发版**

```powershell
node scripts/bump-version.mjs 4.18.0; node scripts/bump-version.mjs --check
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build; npm test
npm pack; mafw stop; npm install -g jack200714-mafw-4.18.0.tgz; mafw daemon
```
Health check 至 `"status":"ok"`。

- [ ] **Step 3: 验证 pi 插件可用性（不切主 runtime）**

```powershell
$r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/runtime" -TimeoutSec 10 -UseBasicParsing; $r.Content
```
Expected: 响应含 pi 插件（available 列表）；active 仍为 opencode。

- [ ] **Step 4: Commit + 交付报告**

```powershell
git add AGENTS.md package.json packages/*/package.json
git commit -m "chore: bump version 4.18.0 (pi cognition host extension + approval policy fix)"
```

交付报告：commit 列表、新增测试数与全量通过数、**live pi 验证 deferred 说明**（切 `runtime.plugin: pi` 后实测四动词——生产默认 opencode 不动，待用户主动切换或下次 pi 会话时验证）。

---

## Self-Review 已完成项

- 覆盖：四动词 + approval 修复 + 接线 + 发版 ✓；ingestMedia/commands 的"不在本扩展"决策已注明理由（pi 原生载体 / gateway 注册表 host-neutral）✓
- 无占位符：全部代码完整给出 ✓
- 类型一致：`MafwHostDeps`/`PermissionEvaluator`/`PiSessionRegistryOptions` 新增字段在各任务间命名一致 ✓
- 已知风险：pi 消息无 `id` 时游标退化（buildIncrement 已覆盖）；typebox 嵌套路径 import 若 pi 升级改布局会断（fail-open 跳过工具注册，不崩会话）✓
