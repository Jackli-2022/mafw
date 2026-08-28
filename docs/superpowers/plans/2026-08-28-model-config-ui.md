# Config 页模型配置管理（Model Config UI）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Config 页新增"模型"卡片，下拉修改记忆 worker 模型与媒体每模态模型，保存即持久化（`~/.mafw/config.yaml`）并热生效（scanService 失效重建）。

**Architecture:** 新 gateway 路由 `gateway/src/routes/model-config.ts`（deps 注入，仿 `media-switch.ts`）提供 `GET/POST /api/model-config`；POST 严格校验 provider/model（列表不可用 fail-open）→ `config.persistOverrides` 落盘 → 仅 recall 变更时置空 `scanService` 单例。SDK 加 `models` 命名空间，preload 两行桥接，Config.tsx 加级联双 SelectV2 卡片。

**Tech Stack:** TypeScript (CJS gateway + ESM SDK)、SolidJS（desktop renderer）、Jest（gateway tests）、bun test（SDK）。

**Spec:** `docs/superpowers/specs/2026-08-28-model-config-ui-design.md`

## Global Constraints

- 路由 regex 必须用 `(?:\?|$)` 锚定（AGENTS.md §6.5）
- gateway 代码为 CJS；错误日志用 `err.message` 而非 `err`（AGENTS.md §6.2）
- 前端禁止裸 `<button>`/`<input>`/裸 `title` 属性（AGENTS.md §5.10）—— 用 `ButtonV2`/`TextInputV2`/`SelectV2`
- recall 用 `{providerID, modelID}`，media 用 `{provider, model}`（与 config.yaml 原生形状一致）
- POST 响应 `recall` 为 `{ workerModel: ModelRef }` 包装形状（与 GET 一致）
- 空字符串 provider/model = 清空 per-modality（回退默认），跳过严格校验
- gateway 测试：`cd gateway && npm test`（jest --runInBand）；SDK 测试：`cd opencode-dev/packages/gateway-sdk && bun test`；SDK 类型：`bun run typecheck`
- 提交信息用 conventional commits（`feat(gateway): ...` / `feat(sdk): ...` / `feat(desktop): ...`）

---

### Task 1: Gateway 路由 `model-config.ts`（TDD）

**Files:**
- Create: `gateway/src/routes/model-config.ts`
- Test: `gateway/tests/unit/model-config.test.ts`

**Interfaces:**
- Consumes: 无（独立模块；模仿 `gateway/src/routes/media-switch.ts` 的 readBody/deps 模式与 `gateway/tests/unit/runtime-switch.test.ts` 的真实 http server 测试模式）
- Produces: `handleModelConfigGet(req, res, deps)`, `handleModelConfigUpdate(req, res, deps)`, `ModelConfigDeps { persist, listProviders, currentConfig, invalidateScanService }`, 类型 `ModelRef`, `MediaModelRef`, `AvailableProvider`, `CurrentModelConfig`（Task 2 的 index.ts 接线依赖这些签名）

- [ ] **Step 1: 写失败测试**

创建 `gateway/tests/unit/model-config.test.ts`（结构仿 runtime-switch.test.ts：真实 http server + 端口 0）：

```typescript
import * as http from 'http';
import { handleModelConfigGet, handleModelConfigUpdate } from '../../src/routes/model-config';

const AVAILABLE = [
  { providerID: 'xiaomi', providerName: 'xiaomi', models: [{ id: 'mimo-v2.5', name: 'MiMo V2.5' }] },
  { providerID: 'alibaba-cn', providerName: 'alibaba-cn', models: [{ id: 'qwen3.7-max', name: 'Qwen3.7 Max' }] },
];

function makeDeps(overrides: any = {}) {
  return {
    persist: jest.fn().mockReturnValue({ changed: ['recall'] }),
    listProviders: jest.fn().mockResolvedValue(AVAILABLE),
    currentConfig: jest.fn(() => ({
      recall: { workerModel: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' } },
      media: { provider: 'xiaomi', model: 'mimo-v2.5', image: { provider: '', model: '' }, video: { provider: '', model: '' }, audio: { provider: '', model: '' } },
    })),
    invalidateScanService: jest.fn(),
    ...overrides,
  };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/model-config(?:\?|$)/);
    if (match && req.method === 'GET') { await handleModelConfigGet(req, res, deps); return; }
    if (match && req.method === 'POST') { await handleModelConfigUpdate(req, res, deps); return; }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function request(server: http.Server, method: string, body?: any): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: '/api/model-config?x=1', method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('GET /api/model-config', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('returns recall + media + available list', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'GET');
    expect(res.status).toBe(200);
    expect(res.body.recall).toEqual({ workerModel: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' } });
    expect(res.body.media.provider).toBe('xiaomi');
    expect(res.body.available).toEqual(AVAILABLE);
  });

  it('returns available:null when provider list unavailable (fail-open signal)', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'GET');
    expect(res.body.available).toBeNull();
  });
});

describe('POST /api/model-config', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('updates recall workerModel: persists wrapper shape, invalidates scan service, echoes new state', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recall).toEqual({ workerModel: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(deps.persist).toHaveBeenCalledWith({ recall: { workerModel: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } } });
    expect(deps.invalidateScanService).toHaveBeenCalledTimes(1);
  });

  it('updates media image model: persists {media:{image}}, does NOT invalidate scan service', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { image: { provider: 'xiaomi', model: 'mimo-v2.5' } } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith({ media: { image: { provider: 'xiaomi', model: 'mimo-v2.5' } } });
    expect(deps.invalidateScanService).not.toHaveBeenCalled();
  });

  it('rejects unknown model with 400 + available, no persist', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'no-such-model' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not found');
    expect(res.body.available).toEqual(AVAILABLE);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.invalidateScanService).not.toHaveBeenCalled();
  });

  it('rejects unknown provider for media modality with 400', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { video: { provider: 'nope', model: 'm' } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Provider 'nope' not found");
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('empty-string values bypass strict validation (clear path) and persist', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { image: { provider: '', model: '' } } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith({ media: { image: { provider: '', model: '' } } });
  });

  it('fail-open: accepts unvalidatable values when provider list is null', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'custom', modelID: 'custom-model' } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalled();
  });

  it('empty body returns 400 No model config specified', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No model config specified');
  });

  it('recall with missing modelID returns 400 even when list unavailable', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('providerID and modelID');
  });

  it('malformed JSON returns 400', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', undefined); // empty body string → JSON.parse fails
    expect(res.status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('invalidateScanService throw does not fail the request (fail-open)', async () => {
    const deps = makeDeps({ invalidateScanService: jest.fn(() => { throw new Error('boom'); }) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('persist throw returns 500', async () => {
    const deps = makeDeps({ persist: jest.fn(() => { throw new Error('disk full'); }) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('disk full');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd gateway; npx jest tests/unit/model-config.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../src/routes/model-config'`

- [ ] **Step 3: 实现 `gateway/src/routes/model-config.ts`**

```typescript
import * as http from 'http';
import { log } from '../core/utils/logger';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export interface ModelRef { providerID: string; modelID: string }
export interface MediaModelRef { provider?: string; model?: string }
export interface AvailableModel { id: string; name: string }
export interface AvailableProvider { providerID: string; providerName: string; models: AvailableModel[] }

export interface CurrentModelConfig {
  recall: { workerModel: ModelRef };
  media: {
    provider?: string;
    model?: string;
    image?: MediaModelRef;
    video?: MediaModelRef;
    audio?: MediaModelRef;
  };
}

export interface ModelConfigDeps {
  persist: (overrides: Record<string, any>) => { changed: string[] };
  /** null → provider list unavailable (fail-open). */
  listProviders: () => Promise<AvailableProvider[] | null>;
  currentConfig: () => CurrentModelConfig;
  invalidateScanService: () => void;
}

const MEDIA_MODALITIES = ['image', 'video', 'audio'] as const;

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** Empty-string provider+model = "follow default" clear path — skips strict validation. */
function isClearRef(ref: any): boolean {
  return (ref?.provider ?? '') === '' && (ref?.model ?? '') === '';
}

function findProvider(list: AvailableProvider[], providerID: string): AvailableProvider | undefined {
  return list.find(p => p.providerID === providerID);
}

function validateRecall(ref: any, available: AvailableProvider[]): string | null {
  const prov = findProvider(available, ref?.providerID ?? '');
  if (!prov) return `Provider '${ref?.providerID ?? ''}' not found`;
  if (!prov.models.some(m => m.id === ref.modelID)) {
    return `Model '${ref.modelID}' not found under provider '${ref.providerID}'`;
  }
  return null;
}

/** Validate a media ref; empty provider falls back to the current top-level provider. */
function validateMediaRef(
  ref: any,
  fallbackProvider: string | undefined,
  available: AvailableProvider[],
): string | null {
  const effProvider = ref?.provider || fallbackProvider || '';
  const prov = findProvider(available, effProvider);
  if (!prov) return `Provider '${effProvider}' not found`;
  if (ref?.model && !prov.models.some(m => m.id === ref.model)) {
    return `Model '${ref.model}' not found under provider '${effProvider}'`;
  }
  return null;
}

export async function handleModelConfigGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ModelConfigDeps,
): Promise<void> {
  try {
    const available = await deps.listProviders().catch(() => null);
    const cur = deps.currentConfig();
    json(res, 200, { recall: cur.recall, media: cur.media, available });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleModelConfigUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ModelConfigDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    json(res, 400, { error: err.message });
    return;
  }

  const recallUpdate = body?.recall ?? null;
  const mediaUpdate: Record<string, any> = {};
  for (const key of ['provider', 'model', ...MEDIA_MODALITIES]) {
    if (body?.media?.[key] !== undefined) mediaUpdate[key] = body.media[key];
  }

  if (!recallUpdate && Object.keys(mediaUpdate).length === 0) {
    json(res, 400, { error: 'No model config specified' });
    return;
  }

  // recall must always be a complete pair (no clear concept for the worker model).
  if (recallUpdate && (!recallUpdate.providerID || !recallUpdate.modelID)) {
    json(res, 400, { error: 'recall.workerModel requires both providerID and modelID' });
    return;
  }

  const available = await deps.listProviders().catch(() => null);

  if (available !== null) {
    if (recallUpdate) {
      const err = validateRecall(recallUpdate, available);
      if (err) { json(res, 400, { error: err, available }); return; }
    }
    // Top-level media pair: both empty = reset to built-in default (skip);
    // partial pair falls back to the current persisted provider for validation.
    const pairProvider = mediaUpdate.provider ?? '';
    const pairModel = mediaUpdate.model ?? '';
    if (pairProvider !== '' || pairModel !== '') {
      const pairErr = validateMediaRef(
        { provider: pairProvider, model: pairModel },
        deps.currentConfig().media.provider,
        available,
      );
      if (pairErr) { json(res, 400, { error: pairErr, available }); return; }
    }
    for (const modality of MEDIA_MODALITIES) {
      const ref = mediaUpdate[modality];
      if (ref && !isClearRef(ref)) {
        const err = validateMediaRef(ref, mediaUpdate.provider ?? deps.currentConfig().media.provider, available);
        if (err) { json(res, 400, { error: err, available }); return; }
      }
    }
  }

  try {
    const overrides: Record<string, any> = {};
    if (recallUpdate) overrides.recall = { workerModel: { providerID: recallUpdate.providerID, modelID: recallUpdate.modelID } };
    if (Object.keys(mediaUpdate).length > 0) overrides.media = mediaUpdate;
    deps.persist(overrides);
    if (recallUpdate) {
      try { deps.invalidateScanService(); } catch (err: any) {
        log.warn(`[ModelConfig] invalidateScanService failed: ${err.message}`);
      }
    }
    const cur = deps.currentConfig();
    json(res, 200, { success: true, recall: cur.recall, media: cur.media });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd gateway; npx jest tests/unit/model-config.test.ts --runInBand`
Expected: PASS（14 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/routes/model-config.ts gateway/tests/unit/model-config.test.ts
git commit -m "feat(gateway): add /api/model-config route with validation and fail-open"
```

---

### Task 2: index.ts 接线（GET/POST /api/model-config）

**Files:**
- Modify: `gateway/src/index.ts`（两处：import 区加一行；`POST /api/media/switch` 路由块之后 ~line 3816 加路由块；类内加 `modelConfigDeps()` 私有方法）

**Interfaces:**
- Consumes: Task 1 的 `handleModelConfigGet` / `handleModelConfigUpdate` / `ModelConfigDeps`
- Produces: HTTP 端点 `GET/POST /api/model-config`（Task 3 SDK 依赖）

- [ ] **Step 1: 加 import**

在 `gateway/src/index.ts` 现有 `handleMediaSwitch` import 旁（搜 `media-switch`）加：

```typescript
import { handleModelConfigGet, handleModelConfigUpdate } from './routes/model-config';
```

- [ ] **Step 2: 加路由块**

在 `POST /api/media/switch` 路由块的闭合 `}` 之后（index.ts ~3816，`GET /api/usage` 之前）插入：

```typescript
        // GET/POST /api/model-config — recall worker model + media models (hot-apply)
        if (req.url?.match(/^\/api\/model-config(?:\?|$)/) && req.method === 'GET') {
          await handleModelConfigGet(req, res, this.modelConfigDeps());
          return;
        }
        if (req.url?.match(/^\/api\/model-config(?:\?|$)/) && req.method === 'POST') {
          await handleModelConfigUpdate(req, res, this.modelConfigDeps());
          return;
        }
```

- [ ] **Step 3: 加 `modelConfigDeps()` 私有方法**

放在 `private getScanService()` 方法之前（index.ts ~1036）：

```typescript
  private modelConfigDeps(): ModelConfigDeps {
    return {
      persist: (o) => config.persistOverrides(o),
      listProviders: async () => {
        if (!this.opencodeClient) return null;
        const result: any = await this.opencodeClient.provider.list();
        const all = result?.all;
        if (!Array.isArray(all)) return null;
        return all.map((p: any) => ({
          providerID: p.id,
          providerName: p.name ?? p.id,
          models: Object.entries(p.models ?? {}).map(([id, m]: [string, any]) => ({ id, name: m?.name ?? id })),
        }));
      },
      currentConfig: () => ({
        recall: { workerModel: config.raw.recall.workerModel },
        media: {
          provider: config.raw.media.provider,
          model: config.raw.media.model,
          image: config.raw.media.image,
          video: config.raw.media.video,
          audio: config.raw.media.audio,
        },
      }),
      invalidateScanService: () => { this.scanService = null; },
    };
  }
```

并在文件顶部 import 处补充类型：

```typescript
import { handleModelConfigGet, handleModelConfigUpdate, ModelConfigDeps } from './routes/model-config';
```

- [ ] **Step 4: 构建 + 全量测试**

Run: `cd gateway; npm run build; if ($?) { npm test }`
Expected: build 成功；jest 全绿（含 Task 1 的新测试）

- [ ] **Step 5: 手动冒烟（可选但推荐）**

Run: `cd gateway; node -e "require('./dist/routes/model-config.js'); console.log('module loads ok')"`
Expected: `module loads ok`

- [ ] **Step 6: 提交**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): wire GET/POST /api/model-config with scanService invalidation"
```

---

### Task 3: SDK `models` 命名空间

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`（新接口 + MafwClient 注册 ~line 451）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`（新命名空间，放 `providers` 之后 ~line 696）
- Modify: `opencode-dev/packages/gateway-sdk/src/types.test.ts`（~line 103）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.test.ts`（~line 509）

**Interfaces:**
- Consumes: Task 2 的 HTTP 端点
- Produces: `MafwClient.models.{get,update}` + 类型 `ModelRef`/`MediaModelRef`/`ModelConfigState`/`ModelConfigUpdate`/`ModelConfigNamespace`（Task 4 preload 类型从 `@mafw/sdk` re-import）

- [ ] **Step 1: 写失败测试**

`types.test.ts` 在 `expect(typeof c.media.switch).toBe("function")` 之后加：

```typescript
  expect(typeof c.models.get).toBe("function")
  expect(typeof c.models.update).toBe("function")
```

`client.test.ts` 文件末尾追加：

```typescript
test("models.get + models.update hit their routes", async () => {
  const state = {
    recall: { workerModel: { providerID: "alibaba-cn", modelID: "qwen3.7-max" } },
    media: { provider: "xiaomi", model: "mimo-v2.5" },
    available: [{ providerID: "xiaomi", providerName: "xiaomi", models: [{ id: "mimo-v2.5", name: "MiMo V2.5" }] }],
  }
  fetchMock.mockResolvedValue(okJson(state))
  const c = new MafwClient()
  const st = await c.models.get()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/model-config")
  expect(st.recall.workerModel.modelID).toBe("qwen3.7-max")

  fetchMock.mockResolvedValue(okJson({ success: true, recall: state.recall, media: state.media }))
  await c.models.update({ recall: { providerID: "xiaomi", modelID: "mimo-v2.5" } })
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/model-config",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ recall: { providerID: "xiaomi", modelID: "mimo-v2.5" } })
})

test("models.update surfaces API error", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 400, statusText: "Bad Request",
    json: () => Promise.resolve({ error: "Model 'x' not found under provider 'y'" }),
  } as Response)
  const c = new MafwClient()
  await expect(c.models.update({ recall: { providerID: "y", modelID: "x" } })).rejects.toThrow("not found")
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd opencode-dev/packages/gateway-sdk; bun test`
Expected: FAIL — `c.models` undefined / TypeError

- [ ] **Step 3: types.ts 加接口**

在 `OpenCodeConfigNamespace` 接口（~line 361）之后插入：

```typescript
export interface ModelRef {
  providerID: string
  modelID: string
}

export interface MediaModelRef {
  provider?: string
  model?: string
}

export interface AvailableModel {
  id: string
  name: string
}

export interface AvailableProvider {
  providerID: string
  providerName: string
  models: AvailableModel[]
}

export interface ModelConfigState {
  recall: { workerModel: ModelRef }
  media: {
    provider?: string
    model?: string
    image?: MediaModelRef
    video?: MediaModelRef
    audio?: MediaModelRef
  }
  /** null → provider 列表不可用（前端回退文本输入）。 */
  available: AvailableProvider[] | null
}

export interface ModelConfigUpdate {
  recall?: ModelRef
  media?: {
    provider?: string
    model?: string
    image?: MediaModelRef
    video?: MediaModelRef
    audio?: MediaModelRef
  }
}

export interface ModelConfigNamespace {
  get(): Promise<ModelConfigState>
  update(opts: ModelConfigUpdate): Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media'] }>
}
```

`MafwClient` 接口中 `opencodeConfig: OpenCodeConfigNamespace` 之后加一行：

```typescript
  models: ModelConfigNamespace
```

- [ ] **Step 4: client.ts 加命名空间**

在 `providers = {...}` 块（~line 696）之后插入：

```typescript
  // ── Model config (recall worker + media models) ──

  models = {
    get: async (): Promise<ModelConfigState> => {
      return this.request<ModelConfigState>('/api/model-config')
    },

    update: async (opts: ModelConfigUpdate): Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media'] }> => {
      const res = await fetch(`${this.baseUrl}/api/model-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Model config update failed: ${res.status}`)
      }
      return res.json()
    },
  }
```

文件顶部 type import 加 `ModelConfigState, ModelConfigUpdate`（该文件已有 `import type { ... } from "./types"` 或类似结构，按现有模式加入）。

- [ ] **Step 5: 运行测试 + 类型检查确认通过**

Run: `cd opencode-dev/packages/gateway-sdk; bun test; if ($?) { bun run typecheck }`
Expected: 测试全绿；typecheck 无错误

- [ ] **Step 6: 提交**

```bash
git add opencode-dev/packages/gateway-sdk/src/types.ts opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/gateway-sdk/src/types.test.ts opencode-dev/packages/gateway-sdk/src/client.test.ts
git commit -m "feat(sdk): add models namespace for recall/media model config"
```

---

### Task 4: Preload 桥接

**Files:**
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`（`config` 块之后 ~line 139）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`（`config` 块之后 ~line 145）

**Interfaces:**
- Consumes: Task 3 的 `ModelConfigState` / `ModelConfigUpdate` 类型（`@mafw/sdk` re-import）；IPC 泛型派发（`mafw-ipc.ts:88` 按 namespace/method 名反射调用 MafwClient，无需改 main 进程）
- Produces: `window.api.mafw.models.{get,update}`（Task 5 UI 依赖）

- [ ] **Step 1: mafw-api.ts 加方法**

在 `config: { get, set }` 块之后（`runtime` 之前）插入：

```typescript
    models: {
      get: () => invoke("models", "get"),
      update: (opts) => invoke("models", "update", opts),
    },
```

- [ ] **Step 2: mafw-types.ts 加类型**

import 列表加 `ModelConfigState, ModelConfigUpdate`：

```typescript
import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, L5Heuristic,
  Approval, TriageItem, AutomationRule, GatewayStatus,
  QuestionRequest, PermissionRequest,
  ModelConfigState, ModelConfigUpdate,
} from "@mafw/sdk"
```

`config` 块之后插入：

```typescript
  models: {
    get: () => Promise<ModelConfigState>
    update: (opts: ModelConfigUpdate) => Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media'] }>
  }
```

- [ ] **Step 3: 验证**

Run: `cd opencode-dev/packages/desktop; bun run typecheck`
Expected: 无类型错误（若该包无 typecheck script，用 `npx tsc --noEmit -p tsconfig.json` 或跳过并在 Task 6 构建验证）

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): expose models get/update through preload bridge"
```

---

### Task 5: Config 页"模型"卡片

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`

**Interfaces:**
- Consumes: Task 4 的 `window.api.mafw.models.{get,update}`；现有 `SelectV2` / `TextInputV2` / `ButtonV2` / `LoaderV2` / `showToastV2`；CSS 类 `.mafw-plugin-row` / `.mafw-plugin-row-label`
- Produces: 用户可见的模型配置 UI（无下游依赖）

- [ ] **Step 1: 加状态与逻辑**

在 `// ── OpenCode config ──` 区块之前（Config.tsx ~line 191）插入：

```tsx
  // ── Models (recall worker + media models) ──
  const [modelState, setModelState] = createSignal<any>(null)
  const [modelAvailable, setModelAvailable] = createSignal<any[] | null>(null)
  const [modelError, setModelError] = createSignal("")
  const [modelSaving, setModelSaving] = createSignal<Record<string, boolean>>({})

  async function loadModelState() {
    setModelError("")
    try {
      const st = await window.api.mafw.models.get()
      setModelState(st)
      setModelAvailable(Array.isArray(st?.available) && st.available.length > 0 ? st.available : null)
    } catch (err: any) {
      setModelError(err.message)
    }
  }

  async function saveRecallModel(provider: string, model: string) {
    setModelSaving(prev => ({ ...prev, recall: true }))
    try {
      const res = await window.api.mafw.models.update({ recall: { providerID: provider, modelID: model } })
      setModelState(res)
      showToastV2({ description: `记忆 worker 模型已切换到 ${provider}/${model}`, duration: 2500 })
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 4000 })
      await loadModelState()
    }
    setModelSaving(prev => ({ ...prev, recall: false }))
  }

  async function saveMediaModel(kind: "default" | "image" | "video" | "audio", provider: string, model: string) {
    setModelSaving(prev => ({ ...prev, [kind]: true }))
    try {
      const mediaUpdate = kind === "default" ? { provider, model } : { [kind]: { provider, model } }
      const res = await window.api.mafw.models.update({ media: mediaUpdate })
      setModelState(res)
      showToastV2({ description: `Media ${kind} 模型已保存`, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 4000 })
      await loadModelState()
    }
    setModelSaving(prev => ({ ...prev, [kind]: false }))
  }
```

`onMount`（line 40）改为：

```tsx
  onMount(() => { loadConfig(); loadOpenCodeConfig(); loadPluginState(); loadModelState() })
```

- [ ] **Step 2: 加行组件（模块级，ConfigPage 之外）**

文件末尾（`ConfigPage` 函数之后）追加两个组件：

```tsx
function ModelSelectRow(props: {
  label: string
  allowClear?: boolean
  current: { provider: string; model: string }
  providers: any[]
  saving: boolean
  onSave: (provider: string, model: string) => void
}) {
  const [pendingProvider, setPendingProvider] = createSignal(props.current.provider)
  const modelsFor = (pid: string) => (props.providers ?? []).find(p => p.providerID === pid)?.models ?? []
  const modelLabel = (id: string) => modelsFor(pendingProvider()).find(m => m.id === id)?.name ?? id
  return (
    <div class="mafw-plugin-row">
      <span class="mafw-plugin-row-label">{props.label}</span>
      <div style={{ display: "flex", gap: 6, "align-items": "center" }}>
        <div style={{ width: 130 }}>
          <SelectV2
            options={(props.providers ?? []).map(p => p.providerID)}
            current={pendingProvider()}
            value={(x: string) => x}
            onSelect={(v) => { if (v != null) setPendingProvider(v) }}
            disabled={props.saving}
            placeholder="provider"
          />
        </div>
        <div style={{ width: 160 }}>
          <SelectV2
            options={props.allowClear ? ["", ...modelsFor(pendingProvider()).map(m => m.id)] : modelsFor(pendingProvider()).map(m => m.id)}
            current={props.current.model}
            value={(x: string) => x}
            label={(x: string) => (x === "" ? "（跟随默认）" : modelLabel(x))}
            onSelect={(v) => { if (v != null && v !== props.current.model) props.onSave(pendingProvider(), v) }}
            disabled={props.saving || !pendingProvider()}
            placeholder={props.allowClear ? "（跟随默认）" : "model"}
          />
        </div>
        {props.saving && <LoaderV2 width={14} height={14} />}
      </div>
    </div>
  )
}

function ModelTextRow(props: {
  label: string
  current: { provider: string; model: string }
  saving: boolean
  onSave: (provider: string, model: string) => void
}) {
  const [prov, setProv] = createSignal(props.current.provider)
  const [model, setModel] = createSignal(props.current.model)
  return (
    <div class="mafw-plugin-row">
      <span class="mafw-plugin-row-label">{props.label}</span>
      <div style={{ display: "flex", gap: 6, "align-items": "center" }}>
        <div style={{ width: 120 }}>
          <TextInputV2 value={prov()} onInput={e => setProv(e.currentTarget.value)} placeholder="providerID" disabled={props.saving} />
        </div>
        <div style={{ width: 150 }}>
          <TextInputV2 value={model()} onInput={e => setModel(e.currentTarget.value)} placeholder="modelID" disabled={props.saving} />
        </div>
        <ButtonV2 variant="outline" size="small" disabled={props.saving || !prov() || !model()} onClick={() => props.onSave(prov(), model())}>
          {props.saving ? "…" : "保存"}
        </ButtonV2>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 加卡片 JSX**

在"插件 Plugins"卡的闭合 `</div>` 之后、"opencode 配置"卡之前（~line 357）插入：

```tsx
      {/* Models */}
      <div class="mafw-config-ops" style={{ "margin-bottom": 16 }}>
        <div class="mafw-config-ops-title">模型 Models</div>
        {modelError() ? (
          <div>
            <div style={{ "font-size": 12, color: "var(--color-warning-text, #856404)", "margin-bottom": 8 }}>
              加载失败: {modelError()}
            </div>
            <ButtonV2 variant="outline" size="small" onClick={loadModelState}>重试</ButtonV2>
          </div>
        ) : !modelState() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "8px 0" }}>
            <LoaderV2 width={14} height={14} />
            <span style={{ "font-size": 12 }}>加载中…</span>
          </div>
        ) : (
          <div>
            {!modelAvailable() && (
              <div style={{ "font-size": 11, color: "var(--text-base)", "margin-bottom": 8 }}>
                provider 列表不可用，请手动输入 providerID / modelID
              </div>
            )}
            {modelAvailable() ? (
              <ModelSelectRow
                label="记忆 worker"
                current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                providers={modelAvailable() ?? []}
                saving={!!modelSaving().recall}
                onSave={(p, m) => saveRecallModel(p, m)}
              />
            ) : (
              <ModelTextRow
                label="记忆 worker"
                current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                saving={!!modelSaving().recall}
                onSave={(p, m) => saveRecallModel(p, m)}
              />
            )}
            {([
              { kind: "default", label: "媒体默认" },
              { kind: "image", label: "媒体 image" },
              { kind: "video", label: "媒体 video" },
              { kind: "audio", label: "媒体 audio" },
            ] as const).map(({ kind, label }) => {
              const cur = kind === "default"
                ? { provider: modelState()?.media?.provider ?? "", model: modelState()?.media?.model ?? "" }
                : { provider: modelState()?.media?.[kind]?.provider ?? "", model: modelState()?.media?.[kind]?.model ?? "" }
              const save = (p: string, m: string) => saveMediaModel(kind, p, m)
              return modelAvailable() ? (
                <ModelSelectRow label={label} allowClear={kind !== "default"} current={cur} providers={modelAvailable() ?? []} saving={!!modelSaving()[kind]} onSave={save} />
              ) : (
                <ModelTextRow label={label} current={cur} saving={!!modelSaving()[kind]} onSave={save} />
              )
            })}
          </div>
        )}
      </div>
```

- [ ] **Step 4: 验证**

Run: `cd opencode-dev/packages/desktop; bun run typecheck`（或包内等价命令）
Expected: 无错误。手动验证（需桌面环境）：Config 页出现"模型"卡，改记忆 worker 模型 → toast + `~/.mafw/config.yaml` 中 `recall.workerModel` 更新；gateway 日志无 scanService 报错。

- [ ] **Step 5: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx
git commit -m "feat(desktop): add Models card with cascading model dropdowns to Config page"
```

---

### Task 6: 全量构建验证 + 文档更新

**Files:**
- Modify: `AGENTS.md`（§5.19 切换端点清单补一行；§5.11 workerModel 默认值勘误）
- Build: 全仓库

**Interfaces:**
- Consumes: Task 1-5 全部完成
- Produces: 可发布状态

- [ ] **Step 1: AGENTS.md §5.19 插件切换端点小节补文档**

在 `POST /api/media/switch` 描述之后补：

```markdown
- `GET /api/model-config` / `POST /api/model-config` — 记忆 worker 模型 + 媒体
  每模态模型（`recall.workerModel`、`media.provider/model`、`media.{image,video,audio}`）：
  provider 列表来自 `GET /api/provider`（不可用 fail-open）；POST 严格校验
  （空字符串=清空回退，跳过校验）→ `config.persistOverrides` 落盘 → 仅 recall
  变更时置空 `scanService` 单例（TurnPipeline/ReflectionPipeline 每次新建本就
  热生效；媒体 per-request 读 config 天然实时）；路由 `routes/model-config.ts`，
  deps 注入可单测；SDK `models` 命名空间 + 桌面 Config 页「模型 Models」卡片
```

- [ ] **Step 2: AGENTS.md §5.11 勘误**

`config.recall.workerModel 固定（默认 xiaomi/mimo-v2.5）`改为
`config.recall.workerModel 固定（代码默认 alibaba-cn/qwen3.7-max，Config 页可改）`
（以 `gateway/src/config.ts:311` 代码为准）。

- [ ] **Step 3: 全量构建 + 全量测试**

Run: `npm run build; if ($?) { cd gateway; npm test }`
Run: `cd opencode-dev/packages/gateway-sdk; bun test; bun run typecheck`
Expected: 构建成功；所有测试绿

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md
git commit -m "docs: document /api/model-config endpoint and workerModel default"
```
