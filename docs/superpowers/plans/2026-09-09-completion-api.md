# completionApi（Runtime 契约无状态 LLM 通道）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 runtime 契约上新增 `completionApi` 可选能力，把 index-scan 的直连 HTTP 与 media 的 pi-adapter 两条私有无状态 LLM 传输收敛为契约级 `completion.complete()`，opencode/pi 两个内置 runtime 各自实现，消费方优先走契约、fail-open 回退旧传输。

**Architecture:** 契约（`contract.ts`）新增 `CompletionRequest/CompletionResult` 类型与 `RuntimeClient.completion` 可选字段；共享的直连 HTTP 传输抽为 `gateway/src/runtime/completion-http.ts`（opencode runtime 与 index-scan 回退路径共用）；pi runtime 包装 `ModelRuntime.complete`；IndexScanService 与 MediaRuntimeExecutor 经注入点优先消费契约。

**Tech Stack:** TypeScript（CJS 编译）、Jest（`gateway/jest.config.js`，测试在 `gateway/tests/unit/`）、无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-09-completion-api-design.md`

## Global Constraints

- 测试命令统一在 `gateway/` 目录执行：`npx jest <相对路径>`（如 `npx jest tests/unit/runtime/contract.test.ts`）
- 回归门槛：每个 Task 结束时 `npx jest tests/unit` 全绿；最后一个 Task 跑根目录 `npm run build` 验证编译
- 不新增 npm 依赖；不改动 scan 的 cooldown/snapshot 逻辑与 media 的 session 分支
- `completion` 通道必须是**无状态**的：请求不携带 sessionID，实现方不得跨调用保留对话状态
- `cacheable` 是提示非承诺：实现方映射不了就忽略（fail-open）
- 契约内只有 `image` 媒体 carrier；wire 格式改写（video_url/input_audio）留在实现方内部
- usage 记账留在消费侧；runtime 只返回 usage，取不到返回 `undefined`
- 编辑 AGENTS.md 时同步更新 §5.19 契约描述

---

### Task 1: 契约类型与能力声明

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Test: `gateway/tests/unit/runtime/contract.test.ts`

**Interfaces:**
- Produces（后续所有 Task 依赖）:
  - `CompletionRequest { model: { providerID: string; modelID: string }; system?: Array<{ text: string; cacheable?: boolean }>; user: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; maxTokens?: number; temperature?: number; timeoutMs?: number }`
  - `CompletionResult { text: string; usage?: { input: number; cached: number; output: number } }`
  - `CompletionChannel { complete(req: CompletionRequest): Promise<CompletionResult> }`
  - `RuntimeCapabilities.completionApi?: boolean`
  - `RuntimeClient.completion?: CompletionChannel`

- [ ] **Step 1: 写失败测试**

在 `gateway/tests/unit/runtime/contract.test.ts` 末尾追加（先看一眼该文件现有 describe 结构，放进合适的 describe 块）：

```ts
describe('completionApi capability', () => {
  it('RuntimeCapabilities supports optional completionApi flag', () => {
    const caps: RuntimeCapabilities = {
      sessionApi: true, promptWhileBusy: true, eventStream: false,
      nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false,
      completionApi: true,
    };
    expect(caps.completionApi).toBe(true);
  });

  it('CompletionRequest accepts text + image user parts and cacheable system blocks', () => {
    const req: CompletionRequest = {
      model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      system: [{ text: 'sys' }, { text: '# Memory Index', cacheable: true }],
      user: [
        { type: 'text', text: 'q' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
      maxTokens: 4096,
      temperature: 0,
      timeoutMs: 30_000,
    };
    expect(req.system?.[1].cacheable).toBe(true);
    expect(req.user[1].type).toBe('image');
  });

  it('CompletionResult usage is optional', () => {
    const withUsage: CompletionResult = { text: 'ok', usage: { input: 1, cached: 2, output: 3 } };
    const without: CompletionResult = { text: 'ok' };
    expect(withUsage.usage?.cached).toBe(2);
    expect(without.usage).toBeUndefined();
  });
});
```

文件顶部 import 补 `CompletionRequest, CompletionResult`（`RuntimeCapabilities` 应该已被引入）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/contract.test.ts`
Expected: 编译错误 / FAIL（`CompletionRequest` 等类型不存在）

- [ ] **Step 3: 实现契约扩展**

在 `gateway/src/runtime/contract.ts` 的 `RuntimeCapabilities` 接口中（`agentProcessApi?` 之后）加：

```ts
  /** runtime 提供无状态单次补全（completion.complete），供 scan/media 等无状态通道使用 */
  completionApi?: boolean;
```

在 `RuntimeCredentials` 接口之后、`RuntimeClient` 之前加：

```ts
// ─── 无状态补全通道（completionApi 能力） ──────────────────────────────────
// 契约语义：无状态——请求不携带 sessionID，实现方不得跨调用保留对话状态。
// cacheable 是提示非承诺：实现方映射到 provider 的 prompt-cache 机制
// （如 DashScope cache_control），映射不了则忽略（fail-open）。
// 媒体只有 image carrier；wire 格式改写（video_url/input_audio）是实现方内部细节。

export interface CompletionRequest {
  model: { providerID: string; modelID: string };
  system?: Array<{ text: string; cacheable?: boolean }>;
  user: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }   // data = base64（无 data: 前缀）
  >;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  /** undefined = provider 未回传 usage；消费方据此跳过记账 */
  usage?: { input: number; cached: number; output: number };
}

export interface CompletionChannel {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
```

在 `RuntimeClient` 接口中（`credentials?` 之前）加：

```ts
  /** 无状态补全通道（capabilities.completionApi = true 时必须提供） */
  completion?: CompletionChannel;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/runtime/contract.test.ts`
Expected: PASS（含新增 3 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/tests/unit/runtime/contract.test.ts
git commit -m "feat(runtime): completionApi capability + CompletionRequest/Result contract types"
```

---

### Task 2: 共享直连 HTTP 传输（completion-http.ts）

**Files:**
- Create: `gateway/src/runtime/completion-http.ts`
- Test: `gateway/tests/unit/runtime/completion-http.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CompletionRequest/CompletionResult`
- Produces:
  - `HttpCompletionDeps { fetchFn?: typeof fetch; baseUrl?: string; apiKey?: string; scanEndpoints?: Record<string, string>; resolveEndpoint?: (providerID: string) => Promise<string | null>; resolveApiKey?: (providerID: string) => Promise<string | null>; authPath?: string; credentials?: { getApiKey(provider: string): string | null } }`
  - `resolveCompletionBaseUrl(providerID?: string, endpoints?: Record<string, string>): string | undefined`
  - `httpComplete(req: CompletionRequest, deps: HttpCompletionDeps): Promise<CompletionResult>`（解析不到 endpoint/key 时抛 `Error('completion: no endpoint or API key for provider "..."')`）

- [ ] **Step 1: 写失败测试**

Create `gateway/tests/unit/runtime/completion-http.test.ts`:

```ts
import { httpComplete, resolveCompletionBaseUrl } from '../../../src/runtime/completion-http';

jest.mock('../../../src/runtime/auth', () => ({
  getProviderApiKey: () => null,
}));

function okBody(overrides: any = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
      ...overrides,
    }),
  };
}

describe('resolveCompletionBaseUrl', () => {
  it('maps alibaba/dashscope/qwen providers to dashscope compatible-mode', () => {
    expect(resolveCompletionBaseUrl('alibaba-cn')).toContain('dashscope.aliyuncs.com');
    expect(resolveCompletionBaseUrl('qwen')).toContain('dashscope.aliyuncs.com');
    expect(resolveCompletionBaseUrl('openai')).toBeUndefined();
  });

  it('config endpoints win over the hardcoded table', () => {
    expect(resolveCompletionBaseUrl('alibaba-cn', { 'alibaba-cn': 'https://x.example/v1/chat/completions' }))
      .toBe('https://x.example/v1/chat/completions');
  });
});

describe('httpComplete', () => {
  it('sends cacheable system blocks with cache_control and text-only user as string', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchFn = (async (url: string, init?: any) => { calls.push({ url, init }); return okBody(); }) as any;
    const res = await httpComplete(
      {
        model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
        system: [{ text: 'sys' }, { text: '# Memory Index', cacheable: true }],
        user: [{ type: 'text', text: 'my query' }],
        maxTokens: 4096,
        temperature: 0,
      },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.text).toBe('hello world');
    expect(res.usage).toEqual({ input: 20, cached: 80, output: 5 }); // input = prompt - cached
    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'my query' });
  });

  it('serializes image parts as OpenAI image_url data URIs', async () => {
    const calls: Array<{ init: any }> = [];
    const fetchFn = (async (_url: string, init?: any) => { calls.push({ init }); return okBody(); }) as any;
    await httpComplete(
      {
        model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
        user: [
          { type: 'text', text: 'describe' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
      },
      { fetchFn, apiKey: 'sk-test' },
    );
    const body = JSON.parse(calls[0].init.body);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ]);
  });

  it('returns undefined usage when provider omits it', async () => {
    const fetchFn = (async () => okBody({ usage: undefined })) as any;
    const res = await httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.usage).toBeUndefined();
  });

  it('falls back to reasoning_content when content is empty', async () => {
    const fetchFn = (async () => okBody({
      choices: [{ message: { content: '', reasoning_content: 'from reasoning' } }],
    })) as any;
    const res = await httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    );
    expect(res.text).toBe('from reasoning');
  });

  it('throws on non-ok HTTP status', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any;
    await expect(httpComplete(
      { model: { providerID: 'alibaba-cn', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { fetchFn, apiKey: 'sk-test' },
    )).rejects.toThrow('HTTP 500');
  });

  it('throws when endpoint and key are both unresolvable', async () => {
    await expect(httpComplete(
      { model: { providerID: 'unknown-prov', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      {},
    )).rejects.toThrow('no endpoint or API key');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/completion-http.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 completion-http.ts**

Create `gateway/src/runtime/completion-http.ts`:

```ts
/**
 * 共享的无状态直连 HTTP 补全传输（OpenAI-compatible chat completions）。
 * opencode runtime 的 completion.complete 与 index-scan 的回退路径共用本模块。
 */
import type { CompletionRequest, CompletionResult } from './contract';
import { getProviderApiKey } from './auth';

export interface HttpCompletionDeps {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  authPath?: string;
  credentials?: { getApiKey(provider: string): string | null };
  scanEndpoints?: Record<string, string>;
  resolveEndpoint?: (providerID: string) => Promise<string | null>;
  resolveApiKey?: (providerID: string) => Promise<string | null>;
}

/** providerID → chat-completions URL。config scanEndpoints 优先于硬编码表。 */
export function resolveCompletionBaseUrl(providerID?: string, endpoints?: Record<string, string>): string | undefined {
  if (!providerID) return undefined;
  const mapped = endpoints?.[providerID];
  if (mapped) return mapped;
  const p = providerID.toLowerCase();
  if (p.includes('alibaba') || p.includes('dashscope') || p.includes('qwen')) {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  }
  return undefined;
}

function buildUserContent(user: CompletionRequest['user']): string | any[] {
  if (user.length === 1 && user[0].type === 'text') return user[0].text;
  return user.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } },
  );
}

export async function httpComplete(req: CompletionRequest, deps: HttpCompletionDeps = {}): Promise<CompletionResult> {
  const providerID = req.model.providerID;
  const baseUrl = deps.baseUrl
    ?? (await deps.resolveEndpoint?.(providerID) ?? undefined)
    ?? resolveCompletionBaseUrl(providerID, deps.scanEndpoints);
  const apiKey = deps.apiKey
    ?? (await deps.resolveApiKey?.(providerID) ?? undefined)
    ?? getProviderApiKey(providerID, deps.authPath, deps.credentials);
  if (!baseUrl || !apiKey) {
    throw new Error(`completion: no endpoint or API key for provider "${providerID}"`);
  }

  const systemContent = (req.system ?? []).map((b) =>
    b.cacheable
      ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: b.text },
  );
  const messages: any[] = [];
  if (systemContent.length > 0) messages.push({ role: 'system', content: systemContent });
  messages.push({ role: 'user', content: buildUserContent(req.user) });

  const timeoutMs = req.timeoutMs ?? 30_000;
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const resp = await Promise.race([
    fetchFn(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model.modelID,
        messages,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 4096,
      }),
    }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('completion timeout')), timeoutMs);
      timer.unref?.();
    }),
  ]) as any;

  if (!resp?.ok) {
    const text = await resp?.text?.().catch(() => '') ?? '';
    throw new Error(`completion failed: HTTP ${resp?.status}: ${String(text).slice(0, 200)}`);
  }

  const json = await resp.json();
  const message = json?.choices?.[0]?.message;
  let text = typeof message?.content === 'string' ? message.content : '';
  // Reasoning models may put the answer in reasoning_content when content is empty.
  if (!text.trim() && typeof message?.reasoning_content === 'string') {
    text = message.reasoning_content;
  }

  const usage = json?.usage;
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  return {
    text,
    usage: usage
      ? {
          input: Math.max(0, (usage.prompt_tokens || 0) - (cached || 0)),
          cached: cached || 0,
          output: usage.completion_tokens || 0,
        }
      : undefined,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/runtime/completion-http.test.ts`
Expected: PASS（7 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/completion-http.ts gateway/tests/unit/runtime/completion-http.test.ts
git commit -m "feat(runtime): shared direct-HTTP completion transport (completion-http.ts)"
```

---

### Task 3: opencode runtime 接入 completion

**Files:**
- Modify: `gateway/src/runtime/opencode-runtime.ts`
- Test: `gateway/tests/unit/runtime/opencode-runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `httpComplete` / `HttpCompletionDeps`
- Produces: `createOpencodeRuntime()` 返回的 runtime 带 `capabilities.completionApi === true` 与 `completion.complete(req)`；endpoint/key 解析复用 client 的 `config.get()`（`provider[id].options.baseURL/apiKey`）与 `getProviderApiKey`

- [ ] **Step 1: 写失败测试**

先看 `gateway/tests/unit/runtime/opencode-runtime.test.ts` 现有结构（它如何构造 `createOpencodeRuntime`、如何 mock adapter）。在合适的 describe 中追加：

```ts
it('declares completionApi and exposes completion.complete', async () => {
  const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
  expect(rt.capabilities.completionApi).toBe(true);
  expect(typeof rt.completion?.complete).toBe('function');
});

it('complete resolves endpoint from opencode provider config baseURL', async () => {
  const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
  // 按该测试文件现有 mock 方式，让 client.config.get() 返回：
  // { provider: { 'my-prov': { options: { baseURL: 'https://p.example/v1', apiKey: 'sk-x' } } } }
  const calls: Array<{ url: string }> = [];
  (globalThis as any).fetch = (async (url: string) => {
    calls.push({ url });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  }) as any;
  const res = await rt.completion!.complete({
    model: { providerID: 'my-prov', modelID: 'm1' },
    user: [{ type: 'text', text: 'q' }],
  });
  expect(res.text).toBe('ok');
  expect(calls[0].url).toBe('https://p.example/v1/chat/completions');
});
```

> 注：第二例的 config.get mock 方式以该测试文件既有 mock 模式为准调整；若现有文件对 adapter 是整体 mock，则给 mock adapter 的 `config.get` 补返回值即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/opencode-runtime.test.ts`
Expected: FAIL（`completionApi` undefined）

- [ ] **Step 3: 实现**

`gateway/src/runtime/opencode-runtime.ts`：

顶部 import 补：

```ts
import { httpComplete } from './completion-http';
import type { CompletionRequest, CompletionResult } from './contract';
```

在 `createOpencodeRuntime` 内 `const caps = fullCapabilities();` 之后加 `caps.completionApi = true;`（注意：`fullCapabilities()` 返回对象不含 completionApi，需显式赋值）。

在 `rt.agents = {...}` 之后加：

```ts
  rt.completion = {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      return httpComplete(req, {
        scanEndpoints: (gatewayConfig.recall as any).scanEndpoints || undefined,
        resolveEndpoint: async (providerID) => {
          try {
            const cfg: any = await client.config.get();
            const base = cfg?.provider?.[providerID]?.options?.baseURL;
            if (typeof base === 'string' && base) return `${base.replace(/\/+$/, '')}/chat/completions`;
          } catch { /* fail-open */ }
          return null;
        },
        resolveApiKey: async (providerID) => {
          try {
            const viaCreds = getProviderApiKey(providerID);
            if (viaCreds) return viaCreds;
            const cfg: any = await client.config.get();
            const key = cfg?.provider?.[providerID]?.options?.apiKey;
            if (typeof key === 'string' && key) return key;
          } catch { /* fail-open */ }
          return null;
        },
      });
    },
  };
```

> 注意确认 `createOpencodeAdapter` 返回的 client 变量名（现为 `client`）与其 `config.get` 方法签名，按实际代码调整。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/runtime/opencode-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/opencode-runtime.ts gateway/tests/unit/runtime/opencode-runtime.test.ts
git commit -m "feat(runtime): opencode runtime implements completion.complete via shared HTTP transport"
```

---

### Task 4: pi runtime 接入 completion

**Files:**
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`
- Test: `gateway/tests/unit/runtime/pi-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CompletionRequest/CompletionResult`；`fixMediaPayload`（`gateway/src/media/pi-adapter.ts` 已导出）
- Produces: `PI_CAPABILITIES.completionApi = true`；pi runtime 的 `completion.complete(req)`——`ModelRuntime.getModel(providerID, modelID)` → `setRuntimeApiKey` → `mr.complete(model, { systemPrompt, messages }, { apiKey, onPayload: fixMediaPayload, signal })`；usage 字段名宽容映射（`prompt_tokens ?? promptTokens ?? input`，`completion_tokens ?? completionTokens ?? output`，cached 同理，取不到则 `usage: undefined`）

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/runtime/pi-runtime.test.ts` 的 `fakePi.ModelRuntime.create` 返回值补 `complete` 与 `getModel` 记录：

```ts
// fakePi.ModelRuntime.create 的返回对象补：
//   complete: async (model: any, ctx: any, opts: any) => {
//     (globalThis as any).__piCompleteCalls = [...((globalThis as any).__piCompleteCalls || []), { model, ctx, opts }];
//     return { stopReason: 'stop', content: [{ type: 'text', text: 'pi says hi' }],
//              usage: { promptTokens: 10, completionTokens: 2 } };
//   },
```

追加用例：

```ts
it('declares completionApi and complete() routes through ModelRuntime.complete', async () => {
  (globalThis as any).__piCompleteCalls = [];
  const rt = await createPiRuntime(
    { fetch, log: console, pluginConfig: () => ({}) } as any,
    { loadPi: async () => fakePi },
  );
  expect(rt.capabilities.completionApi).toBe(true);
  const res = await rt.completion!.complete({
    model: { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    system: [{ text: 'sys' }],
    user: [
      { type: 'text', text: 'describe' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'video/mp4' },
    ],
  });
  expect(res.text).toBe('pi says hi');
  expect(res.usage).toEqual({ input: 10, cached: 0, output: 2 });
  const call = (globalThis as any).__piCompleteCalls[0];
  expect(call.ctx.systemPrompt).toBe('sys');
  expect(call.ctx.messages[0].content).toEqual([
    { type: 'text', text: 'describe' },
    { type: 'image', data: 'aGVsbG8=', mimeType: 'video/mp4' },
  ]);
  expect(typeof call.opts.onPayload).toBe('function'); // fixMediaPayload 透传
});

it('complete() returns usage undefined when pi omits it', async () => {
  const noUsagePi = {
    ...fakePi,
    ModelRuntime: {
      create: async () => ({
        getModel: () => ({ id: 'm' }),
        setRuntimeApiKey: async () => {},
        complete: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'x' }] }),
      }),
    },
  };
  const rt = await createPiRuntime(
    { fetch, log: console, pluginConfig: () => ({}) } as any,
    { loadPi: async () => noUsagePi },
  );
  const res = await rt.completion!.complete({
    model: { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    user: [{ type: 'text', text: 'q' }],
  });
  expect(res.usage).toBeUndefined();
});

it('complete() throws when model is not in the pi registry', async () => {
  const rt = await createPiRuntime(
    { fetch, log: console, pluginConfig: () => ({}) } as any,
    { loadPi: async () => fakePi },
  );
  await expect(rt.completion!.complete({
    model: { providerID: 'nope', modelID: 'nope' },
    user: [{ type: 'text', text: 'q' }],
  })).rejects.toThrow('not found');
});
```

> 注：fakePi 的 `getModel` 现为永远返回对象，第三例需要给 fakePi 的 getModel 加"未知 provider 返回 undefined"的分支，或构造专用 fake；以实现后实际行为为准调整断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL（`completionApi` undefined / `rt.completion` undefined）

- [ ] **Step 3: 实现**

`gateway/src/runtime/plugins/pi-runtime.ts`：

顶部 import 补：

```ts
import type { CompletionRequest, CompletionResult } from '../contract';
import { fixMediaPayload } from '../../media/pi-adapter';
```

`PI_CAPABILITIES` 加 `completionApi: true,`。

在返回对象的 `credentials` 之后加：

```ts
    completion: {
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        const mr = await modelRuntime();
        const model = mr.getModel(req.model.providerID, req.model.modelID);
        if (!model) throw new Error(`Model ${req.model.providerID}/${req.model.modelID} not found in pi registry`);
        const apiKey = ctx.credentials?.getApiKey?.(req.model.providerID)
          ?? readOpencodeAuth(authPath)[req.model.providerID]?.key;
        if (!apiKey) throw new Error(`No API key for provider "${req.model.providerID}"`);
        await mr.setRuntimeApiKey(req.model.providerID, apiKey);

        const content: any[] = [];
        for (const p of req.user) {
          if (p.type === 'text' && p.text.trim()) content.push({ type: 'text', text: p.text });
          if (p.type === 'image') content.push({ type: 'image', data: p.data, mimeType: p.mimeType });
        }
        const response = await mr.complete(
          model,
          {
            systemPrompt: (req.system ?? []).map((b) => b.text).join('\n\n'),
            messages: [{ role: 'user', content, timestamp: Date.now() }],
          },
          {
            apiKey,
            onPayload: fixMediaPayload,
            signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
          },
        );
        if (response.stopReason === 'error' || response.stopReason === 'aborted') {
          throw new Error(response.errorMessage || `completion failed (${response.stopReason})`);
        }
        const text = (response.content || [])
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n')
          .trim();
        const u = response.usage;
        const input = u?.promptTokens ?? u?.prompt_tokens ?? u?.input;
        const output = u?.completionTokens ?? u?.completion_tokens ?? u?.output;
        const cached = u?.cachedTokens ?? u?.cached_tokens ?? 0;
        return {
          text,
          usage: typeof input === 'number' || typeof output === 'number'
            ? { input: input ?? 0, cached: cached ?? 0, output: output ?? 0 }
            : undefined,
        };
      },
    },
```

> 注意 `fixMediaPayload` 从 `media/pi-adapter` import 会引入 `../../config` 依赖——pi-runtime.test.ts 已 mock config，确认不破坏现有 mock；若 pi-adapter 顶层有副作用则把 `fixMediaPayload` 改为构造参数注入（deps.fixPayload ?? fixMediaPayload），单测传 stub。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS（含新增 3 例，既有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-runtime.test.ts
git commit -m "feat(runtime): pi runtime implements completion.complete via ModelRuntime.complete"
```

---

### Task 5: IndexScanService 优先走契约

**Files:**
- Modify: `gateway/src/recall/index-scan.ts`
- Test: `gateway/tests/unit/index-scan-http.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CompletionChannel`；Task 2 的 `httpComplete`
- Produces: `ScanHttpDeps.completion?: () => CompletionChannel | undefined`（thunk，热切换后现读）；`_doScan` 优先契约、契约抛错回退 `httpComplete` 直连；`resolveScanBaseUrl` 保留导出（兼容现有引用）

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/index-scan-http.test.ts` 末尾追加：

```ts
describe('IndexScanService completion channel', () => {
  const fakeIndex2: any = {
    getIndex: () => ({
      entries: [{ id: fullId, created_at: '2026-01-01', type: 'semantic', primary_abstraction: 'x', cue_anchors: [] }],
    }),
  };

  it('prefers the runtime completion channel over direct HTTP', async () => {
    let httpCalled = false;
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { httpCalled = true; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        completion: () => ({
          complete: async (req: any) => {
            expect(req.system?.some((b: any) => b.cacheable)).toBe(true);
            expect(req.user).toEqual([{ type: 'text', text: expect.stringContaining('find my preference') }]);
            return {
              text: '{"relevant_ids":["1_abc12345"],"confidence":0.9}',
              usage: { input: 100, cached: 24000, output: 5 },
            };
          },
        }),
      },
    );
    const res = await svc.scan('find my preference');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(httpCalled).toBe(false);
  });

  it('falls back to direct HTTP when the completion channel throws', async () => {
    let httpCalled = false;
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { httpCalled = true; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        completion: () => ({ complete: async () => { throw new Error('contract broken'); } }),
      },
    );
    const res = await svc.scan('q');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(httpCalled).toBe(true);
  });

  it('records usage from the completion channel when present', async () => {
    const usageRecords: any[] = [];
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        apiKey: 'sk-test',
        recordUsage: (u) => { usageRecords.push(u); },
        completion: () => ({
          complete: async () => ({
            text: '{"relevant_ids":["1_abc12345"],"confidence":0.9}',
            usage: { input: 100, cached: 24000, output: 5 },
          }),
        }),
      },
    );
    await svc.scan('q');
    expect(usageRecords.length).toBe(1);
    expect(usageRecords[0]).toMatchObject({ input: 100, cached: 24000, output: 5 });
  });
});
```

> 注：`fullId` / `okScanBody` 复用该文件顶部既有定义。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/index-scan-http.test.ts`
Expected: FAIL（`completion` dep 不被识别——仍走 HTTP，第一例 `httpCalled === true` 断言失败）

- [ ] **Step 3: 实现**

`gateway/src/recall/index-scan.ts`：

import 补：

```ts
import type { CompletionChannel, CompletionRequest, CompletionResult } from '../runtime/contract';
import { httpComplete } from '../runtime/completion-http';
```

`ScanHttpDeps` 加字段：

```ts
  /** Runtime 契约的无状态补全通道（thunk 现读，热切换安全）。提供时优先于直连 HTTP。 */
  completion?: () => CompletionChannel | undefined;
```

`_doScan` 重构——把现有"构造 body → fetch → 解析 usage/content"段替换为：

```ts
    const startedAt = Date.now();
    const indexText = this.getIndexText();
    const req: CompletionRequest = {
      model: { providerID: providerID ?? '', modelID: modelID ?? '' },
      system: [
        { text: SCAN_SYSTEM },
        { text: indexText, cacheable: true },
      ],
      user: [{ type: 'text', text: `User query: ${query}\n\nSelect the most relevant memory entries from the index above.` }],
      temperature: 0,
      maxTokens: 4096,
      timeoutMs,
    };

    let content: string;
    let usage: { input: number; cached: number; output: number } | undefined;
    const channel = this.deps.completion?.();
    try {
      if (!channel) throw new Error('no completion channel');
      const res: CompletionResult = await channel.complete(req);
      content = res.text;
      usage = res.usage;
    } catch (contractErr: any) {
      if (channel) log.warn(`[IndexScan] completion channel failed (${contractErr.message}), falling back to direct HTTP`);
      const res = await httpComplete(req, this.deps);
      content = res.text;
      usage = res.usage;
    }
```

随后保留既有的 `parseScanResponse(content)` / `recordUsage`（`usage` 有值才记，`input` 已是去缓存值，recordUsage 调用处改为直接传 `usage.input / usage.cached / usage.output`，不再现算 `prompt_tokens - cached`）/ 短 id 解析 / confidence 过滤逻辑。删除 `_doScan` 中原有的 endpoint/apiKey 解析与 fetch 构造段（已进 `httpComplete`）；保留"endpoint/key 解析不到 → warn-once + lastAttemptFailed"语义：`httpComplete` 抛 `no endpoint or API key` 时在 catch 中识别并走 warn-once 分支（保持现有日志文案）。

> 注意：`IndexScanService` 目前构造签名是 `(index, workerModel, deps)`——不动签名，只扩展 deps。`workerModel.providerID/modelID` 可能为 undefined 的场景保留现有行为。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/index-scan-http.test.ts tests/unit/index-scan-format.test.ts tests/unit/index-scan-cooldown.test.ts`
Expected: PASS（含新增 3 例；cooldown/format 既有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/index-scan.ts gateway/tests/unit/index-scan-http.test.ts
git commit -m "feat(recall): index-scan prefers runtime completion channel, direct HTTP as fallback"
```

---

### Task 6: MediaRuntimeExecutor 的 completeFn 优先走契约

**Files:**
- Modify: `gateway/src/media/media-runtime-executor.ts`
- Test: `gateway/tests/unit/media-runtime-executor.test.ts`（新建——该文件当前不存在）

**Interfaces:**
- Consumes: Task 1 的 `CompletionChannel`
- Produces: `createMediaRuntimeExecutor(rt, opts)` 的默认 `completeFn`：若 `rt.capabilities.completionApi && rt.completion` 则经契约调用（PromptPart file → image carrier），否则回退 `createPiPromptAdapter`；行为对外不变（仍是 `(parts, opts) => Promise<string>`）

- [ ] **Step 1: 写失败测试**

Create `gateway/tests/unit/media-runtime-executor.test.ts`:

```ts
import { createMediaRuntimeExecutor } from '../../src/media/media-runtime-executor';

jest.mock('../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const videoPart = { type: 'file', url: 'data:video/mp4;base64,AAAA', mime: 'video/mp4' };
const textPart = { type: 'text', text: 'what happens?' };

describe('MediaRuntimeExecutor default completeFn', () => {
  it('routes video/audio through rt.completion when completionApi is declared', async () => {
    const completeCalls: any[] = [];
    const fakeRt: any = {
      capabilities: { completionApi: true },
      completion: {
        complete: async (req: any) => {
          completeCalls.push(req);
          return { text: 'a cat jumps' };
        },
      },
      session: {}, // 不应被触碰
    };
    const executor = createMediaRuntimeExecutor(fakeRt);
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('a cat jumps');
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0].user).toEqual([
      { type: 'text', text: 'what happens?' },
      { type: 'image', data: 'AAAA', mimeType: 'video/mp4' },
    ]);
  });

  it('falls back to opts.completeFn when the runtime lacks completionApi', async () => {
    const fakeRt: any = { capabilities: {}, session: {} };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      completeFn: async () => 'legacy adapter result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('legacy adapter result');
  });

  it('falls back to opts.completeFn when rt.completion throws', async () => {
    const fakeRt: any = {
      capabilities: { completionApi: true },
      completion: { complete: async () => { throw new Error('boom'); } },
      session: {},
    };
    const executor = createMediaRuntimeExecutor(fakeRt, {
      completeFn: async () => 'fallback result',
    });
    const out = await executor.prompt([videoPart, textPart], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(out).toBe('fallback result');
  });
});
```

> 注：现有 `createMediaRuntimeExecutor(rt, opts)` 的默认 completeFn 是硬编码 pi-adapter——测试通过 `opts.completeFn` 显式注入来验证回退，无需改动 pi-adapter 本身。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/media-runtime-executor.test.ts`
Expected: FAIL（第一例——当前默认 completeFn 不走 rt.completion）

- [ ] **Step 3: 实现**

`gateway/src/media/media-runtime-executor.ts` 中 `createMediaRuntimeExecutor` 改为：

```ts
export function createMediaRuntimeExecutor(
  rt: AgentRuntime,
  opts: MediaRuntimeExecutorOptions = {},
): MediaRuntimeExecutor {
  const authPath = opts.authPath ?? DEFAULT_AUTH_PATH();
  const contractComplete = async (parts: PromptPart[], po: PromptOptions): Promise<string> => {
    const channel = rt.capabilities?.completionApi ? rt.completion : undefined;
    if (!channel) throw new Error('no completion channel');
    const filePart = parts.find((p) => p.type === 'file');
    const textPart = parts.find((p) => p.type === 'text');
    const dataUrl = String(filePart?.url ?? '');
    const mime = (filePart?.mime as string) || dataUrl.match(/^data:([^;]+);/)?.[1] || 'image/png';
    const data = dataUrl.includes(',') ? dataUrl.split(',')[1] || '' : '';
    const user: any[] = [];
    if (textPart && String(textPart.text ?? '').trim()) user.push({ type: 'text', text: String(textPart.text) });
    if (filePart && data) user.push({ type: 'image', data, mimeType: mime });
    const res = await channel.complete({
      model: { providerID: po.providerID, modelID: po.modelID },
      system: [{ text: 'You are a precise media analysis assistant. Answer the user\'s question about the attached media concisely and factually.' }],
      user,
      timeoutMs: 180_000,
    });
    return res.text;
  };
  const legacyComplete = opts.completeFn ?? (async (parts: PromptPart[], po: PromptOptions) => {
    const { createPiPromptAdapter } = await import('./pi-adapter.js');
    const adapter = createPiPromptAdapter({ fixPayload: fixMediaPayload, authPath });
    return adapter(parts, po);
  });
  const completeFn = opts.completeFn ?? (async (parts: PromptPart[], po: PromptOptions) => {
    try {
      return await contractComplete(parts, po);
    } catch {
      return legacyComplete(parts, po);
    }
  });
  return new MediaRuntimeExecutor(rt, opts, completeFn);
}
```

> 注：`opts.completeFn` 显式传入时完全优先（测试与未来的定制路径）；只有默认路径才做"契约优先 + 回退"。确认 `PromptOptions` 的字段名（`providerID/modelID`）与 `PromptPart` 形状以 `media-service.ts` 的实际导出为准。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/media-runtime-executor.test.ts`
Expected: PASS（3 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/media/media-runtime-executor.ts gateway/tests/unit/media-runtime-executor.test.ts
git commit -m "feat(media): default completeFn prefers runtime completion channel, pi-adapter fallback"
```

---

### Task 7: index.ts 接线 + 热切换安全

**Files:**
- Modify: `gateway/src/index.ts`（`getScanService` 与 `resolvePrompt` 两处）

**Interfaces:**
- Consumes: Task 5 的 `ScanHttpDeps.completion` thunk；Task 6 的 executor 行为
- Produces: scan 与 media 在运行时现读 `this.opencodeClient.completion`；runtime 热切换后 media executor 重建（不持有 stale runtime 引用）

- [ ] **Step 1: getScanService 注入 completion thunk**

`gateway/src/index.ts` `getScanService()` 中 `new IndexScanService(...)` 的 deps 对象加一行：

```ts
          completion: () => (this.opencodeClient?.capabilities?.completionApi ? this.opencodeClient.completion : undefined),
```

- [ ] **Step 2: media executor 热切换重建**

`resolvePrompt` 的 pi 分支（现 `if (!this.mediaRuntimeExecutor) { this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.opencodeClient); }`）改为：

```ts
        if (engineName === 'pi' && this.opencodeClient?.name === 'pi') {
          if (!this.mediaRuntimeExecutor || this.mediaRuntimeExecutorRt !== this.opencodeClient) {
            void this.mediaRuntimeExecutor?.dispose().catch(() => {});
            this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.opencodeClient);
            this.mediaRuntimeExecutorRt = this.opencodeClient;
          }
          return this.mediaRuntimeExecutor.prompt;
        }
```

类字段声明区（`private mediaRuntimeExecutor?: MediaRuntimeExecutor;` 旁）加：

```ts
  private mediaRuntimeExecutorRt?: unknown;
```

- [ ] **Step 3: 类型检查 + 相关测试**

Run: `npx tsc --noEmit -p .`（在 `gateway/` 下）
Expected: 无错误

Run: `npx jest tests/unit/index-scan-http.test.ts tests/unit/media-runtime-executor.test.ts tests/unit/runtime`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): wire completion channel into scan service + media executor with hot-switch safety"
```

---

### Task 8: 全量回归 + AGENTS.md 更新

**Files:**
- Modify: `AGENTS.md`（§5.19 契约能力清单 + §3.2 scan 描述各加一句）

- [ ] **Step 1: 全量单测**

Run: `npx jest tests/unit`（`gateway/` 下）
Expected: 全部 PASS

- [ ] **Step 2: 构建**

Run: `npm run build`（仓库根目录）
Expected: exit 0，dist 产物更新

- [ ] **Step 3: AGENTS.md 更新**

§5.19 "可选能力与接口扩展" 列表加一条：

```markdown
- `completionApi?: boolean` + `completion?: { complete(req) }` — 无状态单次补全通道（scan/media 的无状态路径优先走契约，fail-open 回退直连）；cacheable 是 prompt-cache 提示非承诺；usage 由消费侧记账
```

§3.2 检索段末尾或 index scan 相关处加一句：

```markdown
index scan 传输优先走 runtime 契约的 `completion.complete()`（completionApi 能力），缺能力/失败时回退直连 HTTP（`runtime/completion-http.ts` 共享实现）
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: completionApi capability in AGENTS.md (§5.19 contract, §3.2 scan transport)"
```

---

## Self-Review 记录

- **Spec 覆盖**：契约面（T1）/ opencode 实现（T3）/ pi 实现（T4）/ scan 接线（T5）/ media 接线（T6）/ 热切换与回退（T7）/ 错误语义（T5、T6 各含回退用例）/ 测试策略（每 Task TDD）——全覆盖。
- **占位符**：Task 3/4/5 含"以现有文件实际 mock 模式为准"的调整注记——这是既有测试文件结构依赖，属于执行期对齐，非占位符。
- **类型一致性**：`CompletionRequest/CompletionResult/CompletionChannel` 在 T1 定义，T2-T7 引用一致；`ScanHttpDeps.completion` 为 thunk（T5 定义，T7 注入）。
