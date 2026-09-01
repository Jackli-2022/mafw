# Rail 重设计（ChatGPT 式对话列表）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 ChatGPT 式扁平对话列表重写桌面端 Rail（session-store 统一数据层 + 日期分组 + 搜索 + 无限滚动 + Rename/Delete + Manager 沉底 + 折叠箭头右置），gateway 侧补 DELETE/PATCH 真转发。

**Architecture:** gateway 新增 `routes/session-mutations.ts`（deps 注入可单测）转发 serve 原生 DELETE/PATCH；gateway-sdk 补 `session.delete` URL 修正与 `session.rename`；desktop 新增单例 `session-store.ts`（Map 缓存 + invalidate），Rail 重写为纯展示 + 交互层，MafwShell 只做接线。

**Tech Stack:** TypeScript / SolidJS / Electron preload IPC / node http（gateway 路由）/ jest（gateway 测试）/ bun test（SDK 测试）。

**Spec:** `docs/superpowers/specs/2026-09-01-rail-redesign-design.md`

## Global Constraints

- 遵守 `opencode-dev/packages/desktop/AGENTS.md` §5.10：禁裸 `<button>`/`<input>`/裸 `title`；用 `ButtonV2`/`TextInputV2`/`TooltipV2`（`openDelay: 300`）/`ToastV2`
- gateway 路由正则必须带 `(?:\?|$)` 锚定（§6.5）
- gateway 测试基线 **340 全绿**（本计划新增 7 例 → 347）；SDK 测试基线 **81 全绿**（新增 1 → 82）
- 行内不渲染时间戳；时间走 TooltipV2
- Manager（`metadata.mafw.role === 'manager'`）永不进 History 列表
- 中文 UI 文案与现有一致（今天/昨天/过去 7 天/N月）
- 注意：PowerShell 5.1 下不要用 Get-Content/Set-Content 往返编辑含中文的源码文件（GBK 损坏坑），一律用 Edit 工具
- Rail 默认宽度 264px（`MafwShell.tsx:1554`，用户可拖拽，已落 localStorage）——处于业界共识 240-260 区间，**不改宽度**（spec 中"200→240"一项作废：200 是 AGENTS.md 过时描述）

## File Structure

```
gateway/src/routes/session-mutations.ts          # 新：DELETE/PATCH /api/sessions/:id 处理器（deps 注入）
gateway/tests/unit/session-mutations-route.test.ts  # 新：路由单测
gateway/src/opencode-adapter.ts                  # 改：session.update 透传
gateway/src/runtime/contract.ts                  # 改：RuntimeClient.session.update? 可选方法
gateway/src/index.ts                             # 改：接线 session-mutations
opencode-dev/packages/gateway-sdk/src/client.ts  # 改：delete URL 修正 + rename
opencode-dev/packages/gateway-sdk/src/types.ts   # 改：SessionNamespace.rename
opencode-dev/packages/gateway-sdk/src/client.test.ts # 改：delete URL 断言 + rename 测试
opencode-dev/packages/desktop/src/preload/mafw-api.ts    # 改：sessions.remove/rename
opencode-dev/packages/desktop/src/preload/mafw-types.ts  # 改：类型
opencode-dev/packages/desktop/src/renderer/mafw/session-store.ts  # 新：单例 store
opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx  # 重写
opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx        # 改：接线
opencode-dev/packages/desktop/src/renderer/mafw/mafw.css             # 改：rail 样式段重写
```

---

### Task 1: gateway — DELETE/PATCH /api/sessions/:id 真转发（TDD）

**Files:**
- Create: `gateway/src/routes/session-mutations.ts`
- Create: `gateway/tests/unit/session-mutations-route.test.ts`
- Modify: `gateway/src/opencode-adapter.ts`（delete 方法后，约 :2805）
- Modify: `gateway/src/runtime/contract.ts`（:123 delete 之后）
- Modify: `gateway/src/index.ts`（GET /api/sessions 块之前，约 :3754；顶部 import 区）

**Interfaces:**
- Produces: `handleSessionMutations(req: http.IncomingMessage, res: http.ServerResponse, deps: { getCapabilities(): { sessionApi?: boolean }; getClient(): SessionClientLike | null }): Promise<boolean>` — 命中路由返回 true（已写响应），未命中返回 false；`SessionClientLike = { session: { delete(o:{sessionID:string}):Promise<void>; update(o:{sessionID:string; title:string}):Promise<any> } }`（**扁平签名**：v2 SDK `session.update({ sessionID, title })` 无 `body` 包装）
- Produces: adapter `session.update(opts: { sessionID: string; title: string })`（unwrap serve 错误并 throw）；contract `session.update?`

- [ ] **Step 1: 写失败的路由测试**

创建 `gateway/tests/unit/session-mutations-route.test.ts`（镜像 `restart-agent-route.test.ts` 的 mock-server 模式）：

```typescript
import * as http from 'http';
import { handleSessionMutations } from '../../src/routes/session-mutations';

function createServer(deps: { getCapabilities: jest.Mock; getClient: jest.Mock }): http.Server {
  return http.createServer(async (req, res) => {
    const handled = await handleSessionMutations(req, res, {
      getCapabilities: deps.getCapabilities,
      getClient: deps.getClient,
    });
    if (!handled) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
}

function send(server: http.Server, method: string, path: string, body?: object): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
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

describe('handleSessionMutations', () => {
  let server: http.Server;

  const okDeps = () => ({
    getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }),
    getClient: jest.fn().mockReturnValue({ session: { delete: jest.fn(), update: jest.fn() } }),
  });

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('DELETE /api/sessions/:id calls session.delete and returns 200', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: del, update: jest.fn() } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1?x=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith({ sessionID: 'ses_1' });
  });

  it('PATCH /api/sessions/:id with title calls session.update with flat args and returns 200', async () => {
    const update = jest.fn().mockResolvedValue({});
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn(), update } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'PATCH', '/api/sessions/ses_1', { title: '  新标题  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ sessionID: 'ses_1', title: '新标题' });
  });

  it('PATCH with empty/missing title returns 400', async () => {
    const update = jest.fn();
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn(), update } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'PATCH', '/api/sessions/ses_1', {});
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 503 when sessionApi capability is missing', async () => {
    server = createServer({ getCapabilities: jest.fn().mockReturnValue({ sessionApi: false }), getClient: jest.fn() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(503);
  });

  it('returns 503 when client is unavailable', async () => {
    server = createServer({ getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }), getClient: jest.fn().mockReturnValue(null) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(503);
  });

  it('returns 500 when serve call rejects', async () => {
    server = createServer({
      getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }),
      getClient: jest.fn().mockReturnValue({
        session: { delete: jest.fn().mockRejectedValue(new Error('not found')), update: jest.fn() },
      }),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('not found');
  });

  it('returns false for unrelated routes', async () => {
    server = createServer({ getCapabilities: jest.fn(), getClient: jest.fn() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'GET', '/api/sessions');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/session-mutations-route.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/session-mutations'`

- [ ] **Step 3: 实现 `gateway/src/routes/session-mutations.ts`**

```typescript
import * as http from 'http';

export interface SessionClientLike {
  session: {
    delete(opts: { sessionID: string }): Promise<void>;
    // Flat signature — the v2 opencode SDK takes { sessionID, title }, no body wrapper.
    update(opts: { sessionID: string; title: string }): Promise<any>;
  };
}

export interface SessionMutationDeps {
  getCapabilities: () => { sessionApi?: boolean };
  getClient: () => SessionClientLike | null;
}

/**
 * DELETE /api/sessions/:id — true forward to serve's native session delete
 * (the legacy /api/session/:id path is an SPA-fallback that answers 200 without
 * deleting anything).
 * PATCH /api/sessions/:id { title } — forward to serve's session update.
 * Returns true when the request was handled (response already written).
 */
export async function handleSessionMutations(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionMutationDeps,
): Promise<boolean> {
  const isDelete = req.method === 'DELETE' && req.url?.match(/^\/api\/sessions\/([^/]+)(?:\?|$)/);
  const isPatch = req.method === 'PATCH' && req.url?.match(/^\/api\/sessions\/([^/]+)(?:\?|$)/);
  if (!isDelete && !isPatch) return false;

  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const sessionID = (isDelete || isPatch)![1];
  if (deps.getCapabilities().sessionApi !== true) {
    json(503, { error: 'runtime does not expose the session API (sessionStorageApi/sessionApi=false)' });
    return true;
  }
  const client = deps.getClient();
  if (!client) {
    json(503, { error: 'LLM client not available' });
    return true;
  }
  try {
    if (isDelete) {
      await client.session.delete({ sessionID });
      json(200, { ok: true });
      return true;
    }
    const raw = await new Promise<string>((resolve) => {
      let chunks = '';
      req.on('data', (c) => chunks += c);
      req.on('error', () => resolve(''));
      req.on('end', () => resolve(chunks));
    });
    let title = '';
    try { title = String(JSON.parse(raw || '{}').title ?? ''); } catch { /* invalid json → empty */ }
    if (!title.trim()) {
      json(400, { error: 'title is required' });
      return true;
    }
    await client.session.update({ sessionID, title: title.trim() });
    json(200, { ok: true });
  } catch (err: any) {
    json(500, { error: err.message });
  }
  return true;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/session-mutations-route.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: adapter 加 update 透传（unwrap 错误）+ contract 加可选方法**

`gateway/src/opencode-adapter.ts` 是 ~180 行的文件，`async delete(opts: { sessionID: string })` 在 **:103-107**。将 delete 改为 unwrap + 在其后插入 update（v2 SDK 不 throw，错误以 `{error}` 返回，必须显式抛出才能让路由给出 500）：

```typescript
      async delete(opts: { sessionID: string }) {
        const result = await client.session.delete({ sessionID: opts.sessionID });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async update(opts: { sessionID: string; title: string }) {
        // v2 SDK signature is flat: { sessionID, title }
        const result = await client.session.update({ sessionID: opts.sessionID, title: opts.title });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },
```

`gateway/src/runtime/contract.ts` :123 `delete(...)` 行之后插入：

```typescript
    /** Rename a session (flat { sessionID, title }); optional — opencode/pi implement it. */
    update?(opts: { sessionID: string; title: string }): Promise<any>;
```

- [ ] **Step 6: index.ts 接线**

`gateway/src/index.ts` 顶部 import 区（与其他 routes import 同处）加：

```typescript
import { handleSessionMutations } from './routes/session-mutations';
```

在 `GET /api/sessions` 注释块（**:3770** 附近，`// GET /api/sessions ... (optional ?projectID=xxx)`）**之前**插入：

```typescript
        // DELETE/PATCH /api/sessions/:id — true forwards (rename / delete)
        if (await handleSessionMutations(req, res, {
          getCapabilities: () => this.runtimeCaps,
          getClient: () => (this.opencodeClient ?? null) as any,
        })) {
          return;
        }
```

- [ ] **Step 7: 全量构建 + 测试**

Run: `cd gateway && npm run build && npm test`
Expected: build 0，**Tests: 347 passed, 347 total**（340 + 新增 7）

- [ ] **Step 8: Commit**

```bash
git add gateway/src/routes/session-mutations.ts gateway/tests/unit/session-mutations-route.test.ts gateway/src/opencode-adapter.ts gateway/src/runtime/contract.ts gateway/src/index.ts
git commit -m "feat(gateway): true DELETE/PATCH /api/sessions/:id forwards for rename and delete"
```

---

### Task 2: gateway-sdk — delete URL 修正 + rename

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`（sessions 命名空间 :65-70 delete、其后加 rename）
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`（SessionNamespace :256 之后）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.test.ts`（:74 delete 测试改 URL + 新增 rename 测试）

**Interfaces:**
- Produces: `session.delete(params: { path: { id } })` → `DELETE /api/sessions/:id`；`session.rename(params: { path: { id }; body: { title: string } })` → `PATCH /api/sessions/:id`

- [ ] **Step 1: 改失败测试**

`client.test.ts` :74 的 delete 测试改为（URL 断言 `/api/sessions/s1`）：

```typescript
test("session.delete sends DELETE /api/sessions/:id", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient("http://gw:3000")
  await c.session.delete({ path: { id: "s1" } })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/sessions/s1", expect.objectContaining({ method: "DELETE" }))
})

test("session.rename sends PATCH /api/sessions/:id with title body", async () => {
  fetchMock.mockResolvedValue(okJson({}))
  const c = new MafwClient("http://gw:3000")
  await c.session.rename({ path: { id: "s1" }, body: { title: "新名字" } })
  expect(fetchMock).toHaveBeenCalledWith(
    "http://gw:3000/api/sessions/s1",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ title: "新名字" }),
    }),
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd opencode-dev/packages/gateway-sdk && bun test client.test.ts`
Expected: FAIL — delete URL 断言不匹配（现打 `/api/session/s1`）；rename 方法不存在

- [ ] **Step 3: 实现 client.ts**

`client.ts` 的 `delete`（:65-70）整体替换 + 其后加 `rename`：

```typescript
    delete: async (params: { path: { id: string } }): Promise<void> => {
      // True delete: /api/sessions/:id forwards to serve's native DELETE
      // (the legacy /api/session/:id path is an SPA fallback, not a real route).
      await this.request(`/api/sessions/${params.path.id}`, { method: 'DELETE' })
    },

    rename: async (params: { path: { id: string }; body: { title: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: params.body.title }),
      })
    },
```

`types.ts` SessionNamespace :256 `delete(...)` 行后加：

```typescript
  rename(params: { path: { id: string }; body: { title: string } }): Promise<void>
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd opencode-dev/packages/gateway-sdk && bun test`
Expected: PASS（81 + 1 新增 = 82）

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/gateway-sdk/src/types.ts opencode-dev/packages/gateway-sdk/src/client.test.ts
git commit -m "feat(sdk): fix session delete URL and add session.rename"
```

---

### Task 3: preload 暴露 remove / rename

**Files:**
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`（:45-46 sessions 段）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`（:19-20 sessions 段）

**Interfaces:**
- Consumes: Task 2 的 `session.delete / session.rename`（经 `invoke("session", ...)` 透传）
- Produces: `window.api.mafw.sessions.remove(id: string): Promise<void>`；`window.api.mafw.sessions.rename(id: string, title: string): Promise<void>`

- [ ] **Step 1: mafw-api.ts sessions 段改为**

```typescript
    sessions: {
      list: (projectID?) => invoke("session", "list", projectID ? { query: { projectID } } : {}),
      remove: (id: string) => invoke("session", "delete", { path: { id } }),
      rename: (id: string, title: string) => invoke("session", "rename", { path: { id }, body: { title } }),
```

（`create` 等既有成员保持不动。）

- [ ] **Step 2: mafw-types.ts sessions 段加两个签名**

```typescript
  sessions: {
    list: (projectID?: string) => Promise<Session[]>
    remove: (id: string) => Promise<void>
    rename: (id: string, title: string) => Promise<void>
```

- [ ] **Step 3: typecheck**

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): expose sessions.remove/rename over preload IPC"
```

---

### Task 4: session-store.ts 单例数据层

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/session-store.ts`

**Interfaces:**
- Consumes: `window.api.mafw.sessions.list(projectID?)`、`window.api.mafw.gateway.info/onStateChange`
- Produces（Task 5/6 依赖，签名必须一字不差）:
  - `sessionStore.sessionsFor(projectID: string | null): any[]`（响应式读取；首次调用触发拉取）
  - `sessionStore.isLoading(): boolean`
  - `sessionStore.isOffline(projectID: string | null): boolean`（最近一次拉取失败 → true，Rail 据此渲染 "Gateway offline"）
  - `sessionStore.invalidate(projectID?: string | null): void` — 失效并重拉（无参 = 全部缓存失效）

- [ ] **Step 1: 创建完整文件（最终版，一步到位）**

```typescript
// Singleton session data layer shared by Rail and MafwShell. The gateway
// already hides memory-worker/subagent sessions; this store adds caching,
// unified ordering (last-activity desc), title fallback and offline tracking.
import { createSignal } from "solid-js"

type SessionInfo = {
  id: string
  directory?: string
  projectID?: string
  title?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
  parentID?: string
}

const cache = new Map<string, { list: SessionInfo[]; fetchedAt: number; failed: boolean }>()
const inflight = new Map<string, Promise<SessionInfo[]>>()
const [loading, setLoading] = createSignal(false)
// Bumped on every successful fetch so reactive readers re-evaluate.
const [version, setVersion] = createSignal(0)

const keyOf = (projectID: string | null) => projectID || "__all__"

const sortSessions = (list: SessionInfo[]): SessionInfo[] =>
  list.filter(Boolean).sort((a, b) => {
    const ta = a.time?.updated || a.time?.created || 0
    const tb = b.time?.updated || b.time?.created || 0
    return tb - ta
  })

const withFallbackTitle = (s: SessionInfo): SessionInfo =>
  s.title && s.title.trim() ? s : { ...s, title: "New conversation" }

async function fetchFor(projectID: string | null): Promise<SessionInfo[]> {
  const key = keyOf(projectID)
  const existing = inflight.get(key)
  if (existing) return existing
  const p = (async () => {
    setLoading(true)
    try {
      const list = await window.api.mafw.sessions.list(projectID ?? undefined)
      const sorted = sortSessions((Array.isArray(list) ? list : []) as SessionInfo[]).map(withFallbackTitle)
      cache.set(key, { list: sorted, fetchedAt: Date.now(), failed: false })
      setVersion(v => v + 1)
      return sorted
    } catch (e) {
      console.warn("[mafw] session-store fetch failed", e)
      cache.set(key, { list: [], fetchedAt: Date.now(), failed: true })
      setVersion(v => v + 1)
      return []
    } finally {
      inflight.delete(key)
      setLoading(false)
    }
  })()
  inflight.set(key, p)
  return p
}

export const sessionStore = {
  /** Reactive read; triggers a fetch on first access for the project. */
  sessionsFor(projectID: string | null): SessionInfo[] {
    version()
    const key = keyOf(projectID)
    const entry = cache.get(key)
    if (!entry) {
      void fetchFor(projectID)
      return []
    }
    return entry.list
  },

  isLoading,

  /** Reactive: last fetch for this project failed (gateway unreachable). */
  isOffline(projectID: string | null): boolean {
    version()
    return cache.get(keyOf(projectID))?.failed === true
  },

  /** Drop cache (optionally for one project) and refetch. */
  invalidate(projectID?: string | null): void {
    if (projectID === undefined || projectID === null) {
      const keys = Array.from(cache.keys())
      cache.clear()
      for (const key of keys) void fetchFor(key === "__all__" ? null : key)
      setVersion(v => v + 1)
      return
    }
    cache.delete(keyOf(projectID))
    void fetchFor(projectID)
  },
}
```

- [ ] **Step 2: typecheck**

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/session-store.ts
git commit -m "feat(desktop): singleton session store with cache, ordering and invalidate"
```

---

### Task 5: Rail.tsx 重写

**Files:**
- Rewrite: `opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx`

**Interfaces:**
- Consumes: `sessionStore`（Task 4 签名）、`window.api.mafw.sessions.remove/rename`（Task 3）、`window.api.mafw.projects.*`、`DropdownMenu`（`@opencode-ai/ui/dropdown-menu`）、`TextInputV2`（`@opencode-ai/ui/v2/text-input-v2`）、`TooltipV2`、`UsagePill`、`Icon`
- Produces: Props `{ activeSessionId: string | null; managerSessionId?: string | null; onSelectSession: (id: string, title?: string, manager?: boolean) => void; onSessionDeleted?: (id: string) => void; onSettings?: () => void; onToggleCollapsed?: () => void; onOpenUsage?: () => void }`（**移除** `sessionRefreshKey`）

- [ ] **Step 1: 整文件重写（最终版，含评审修订：Electron 无 window.prompt → 行内重命名；onMount 导入；Kobalte placement=bottom-start；离线态）**

```tsx
// @ts-nocheck
import { createSignal, createEffect, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { UsagePill } from "./UsagePill"
import { sessionStore } from "../session-store"

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToastV2({ description: "Copied", duration: 2000 })
  } catch (e) {
    console.warn("[mafw] clipboard failed", e)
  }
}

const DAY = 86400000
const dayStart = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Fixed date groups (industry consensus): 今天 / 昨天 / 过去 7 天 / 按月（跨年带年份）
const groupLabel = (ts: number): string => {
  const diffDays = Math.round((dayStart(Date.now()) - dayStart(ts)) / DAY)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays < 7) return "过去 7 天"
  const d = new Date(ts)
  const y = d.getFullYear()
  const nowY = new Date().getFullYear()
  return y === nowY ? `${d.getMonth() + 1}月` : `${y}年${d.getMonth() + 1}月`
}

const PAGE = 100
const SEARCH_CAP = 200

type Props = {
  activeSessionId: string | null
  managerSessionId?: string | null
  onSelectSession: (id: string, title?: string, manager?: boolean) => void
  onSessionDeleted?: (id: string) => void
  onSettings?: () => void
  onToggleCollapsed?: () => void
  onOpenUsage?: () => void
}

export function Rail(props: Props) {
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [gwStatus, setGwStatus] = createSignal<any>(null)
  const [query, setQuery] = createSignal("")
  const [limit, setLimit] = createSignal(PAGE)
  const [hi, setHi] = createSignal(-1)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  let searchRef: HTMLDivElement | undefined
  let scrollRef: HTMLDivElement | undefined

  const gwReady = createMemo(() => gwStatus()?.state === "ready")
  const projectID = createMemo(() => {
    const p = currentProject()
    return p ? (p.worktree || p.id || null) : null
  })

  onMount(() => {
    window.api.mafw.gateway.info().then(setGwStatus)
    onCleanup(window.api.mafw.gateway.onStateChange((s) => setGwStatus(s)))
  })

  createEffect(() => {
    if (!gwReady()) return
    window.api.mafw.projects.list().then(setProjects).catch(e => console.warn("[mafw] projects.list error:", e))
    window.api.mafw.projects.current().then((res: any) => { if (res) setCurrentProject(res) }).catch(e => console.warn("[mafw] projects.current error:", e))
  })

  // Store read: refetches on first access, reactive to invalidate().
  const allSessions = createMemo(() => sessionStore.sessionsFor(projectID()))
  const offline = createMemo(() => sessionStore.isOffline(projectID()))

  const managerRow = createMemo(() => {
    const id = props.managerSessionId
    if (!id) return null
    return allSessions().find(s => s.id === id && s.metadata?.mafw?.role === 'manager') || null
  })

  // History = everything except manager sessions.
  const history = createMemo(() => allSessions().filter(s => s.metadata?.mafw?.role !== 'manager'))

  const searching = createMemo(() => query().trim().length > 0)
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return history()
    return history().filter(s => (s.title || '').toLowerCase().includes(q))
  })

  // Date groups over the rendered slice.
  const groups = createMemo(() => {
    const slice = filtered().slice(0, searching() ? SEARCH_CAP : limit())
    const out: { label: string; items: any[] }[] = []
    for (const s of slice) {
      const label = groupLabel(s.time?.updated || s.time?.created || Date.now())
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(s)
      else out.push({ label, items: [s] })
    }
    return out
  })

  const flatResults = createMemo(() => groups().flatMap(g => g.items))

  // Search keyboard navigation: ↑↓ move highlight, Enter opens, Esc clears.
  const onSearchKeyDown = (e: KeyboardEvent) => {
    const list = flatResults()
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      const s = list[hi()]
      if (s) { props.onSelectSession(s.id, s.title, false); setQuery(""); setHi(-1) }
    } else if (e.key === "Escape") { setQuery(""); setHi(-1) }
  }

  // Ctrl/Cmd+K focuses search.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        searchRef?.querySelector("input")?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Infinite scroll: near-bottom → grow the rendered window.
  createEffect(() => {
    const el = scrollRef
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        setLimit(l => (l < filtered().length ? l + PAGE : l))
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => el.removeEventListener("scroll", onScroll))
  })

  // Inline rename (Electron has no window.prompt): row swaps to a TextInputV2.
  const startRename = (s: any) => { setRenamingId(s.id); setRenameDraft(sessionName(s)) }
  const commitRename = async (id: string) => {
    const title = renameDraft().trim()
    setRenamingId(null)
    if (!title) return
    try {
      await window.api.mafw.sessions.rename(id, title)
      sessionStore.invalidate(projectID())
    } catch (e: any) {
      showToastV2({ description: `重命名失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const deleteSession = async (id: string) => {
    try {
      if (!window.confirm("删除该会话？此操作不可恢复。")) return
      await window.api.mafw.sessions.remove(id)
      if (props.activeSessionId === id) props.onSessionDeleted?.(id)
      sessionStore.invalidate(projectID())
      showToastV2({ description: "已删除", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `删除失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const newSession = async () => {
    try {
      const dir = projectID() || "."
      const result = await window.api.mafw.sessions.create({ directory: dir }) as any
      props.onSelectSession(result.id || result.sessionID)
      sessionStore.invalidate(projectID())
    } catch (e) { console.warn("[mafw]", e) }
  }

  const selectProject = (p: any) => {
    setCurrentProject(p)
    try { window.api.mafw.projects.setCurrent(p.worktree) } catch (e) { console.warn("[mafw]", e) }
    // Cached projects can be stale — refetch per spec (切换即失效重拉).
    sessionStore.invalidate(p.worktree || p.id || null)
    setLimit(PAGE)
  }

  const sessionName = (s: any): string => s.title || (s.id || "").slice(0, 12)

  const renderSessionRow = (s: any) => (
    <Show
      when={renamingId() !== s.id}
      fallback={
        <div class="mafw-rail-session renaming">
          <TextInputV2
            value={renameDraft()}
            onInput={e => setRenameDraft(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(s.id) }
              else if (e.key === "Escape") setRenamingId(null)
            }}
            autoFocus
          />
        </div>
      }
    >
      <DropdownMenu placement="right">
        <DropdownMenu.Trigger
          as="div"
          class="mafw-rail-session"
          classList={{ active: props.activeSessionId === s.id }}
          data-hi={flatResults().indexOf(s) === hi() ? "1" : undefined}
          onClick={() => { props.onSelectSession(s.id, sessionName(s), false); setHi(-1) }}
        >
          <TooltipV2 value={new Date(s.time?.updated || s.time?.created || Date.now()).toLocaleString()} openDelay={300}>
            <span class="mafw-rail-session-title">{sessionName(s)}</span>
          </TooltipV2>
          <span class="mafw-rail-row-dots" onClick={e => e.stopPropagation()}>⋯</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => props.onSelectSession(s.id, sessionName(s), false)}>
              <DropdownMenu.ItemLabel>Open</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => startRename(s)}>
              <DropdownMenu.ItemLabel>Rename</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => deleteSession(s.id)}>
              <DropdownMenu.ItemLabel>Delete</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => copyText(s.id)}>
              <DropdownMenu.ItemLabel>Copy session ID</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )

  return (
    <div class="mafw-rail">
      {/* Header: project switcher (left) + collapse arrow (right) */}
      <div class="mafw-rail-head">
        <DropdownMenu placement="bottom-start">
          <DropdownMenu.Trigger as="div" class="mafw-rail-switcher">
            <span class="mafw-rail-switcher-caret">▾</span>
            <span class="mafw-rail-switcher-name">{currentProject()?.worktree?.split(/[/\\]/).pop() || "No project"}</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mafw-rail-switcher-menu">
              <For each={projects()}>
                {(p) => (
                  <DropdownMenu.Item onSelect={() => selectProject(p)}>
                    <DropdownMenu.ItemLabel>{p.worktree?.split(/[/\\]/).pop() || p.id}</DropdownMenu.ItemLabel>
                    {currentProject()?.worktree === p.worktree && <span class="mafw-rail-check">✓</span>}
                  </DropdownMenu.Item>
                )}
              </For>
              <DropdownMenu.Item onSelect={() => copyText(projectID() || "")}>
                <DropdownMenu.ItemLabel>Copy path</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <button class="mafw-rail-collapse" onClick={() => props.onToggleCollapsed?.()} aria-label="折叠侧边栏">◀</button>
      </div>

      <div class="mafw-rail-new">
        <button class="mafw-rail-new-btn" onClick={newSession}>+ New session</button>
      </div>

      <div class="mafw-rail-search" ref={searchRef}>
        <TextInputV2
          value={query()}
          onInput={e => { setQuery(e.currentTarget.value); setHi(-1) }}
          onKeyDown={onSearchKeyDown}
          placeholder="Search chats…"
        />
      </div>

      {/* Scroll area: fixed date groups, infinite scroll, search results */}
      <div class="mafw-rail-scroll" ref={scrollRef}>
        <Show when={offline()}>
          <div class="mafw-rail-empty">Gateway offline</div>
        </Show>
        <Show when={!offline() && !searching() && allSessions().length === 0 && !sessionStore.isLoading()}>
          <div class="mafw-rail-empty">No sessions yet</div>
        </Show>
        <Show when={searching() && filtered().length === 0}>
          <div class="mafw-rail-empty">No chats found</div>
        </Show>
        <For each={groups()}>
          {(g) => (
            <>
              <div class="mafw-rail-date-group">{g.label}</div>
              <For each={g.items}>{(s) => renderSessionRow(s)}</For>
            </>
          )}
        </For>
        <Show when={!searching() && filtered().length > limit()}>
          <div class="mafw-rail-load-more" onClick={() => setLimit(l => l + PAGE)}>加载更多</div>
        </Show>
        <Show when={searching() && filtered().length > SEARCH_CAP}>
          <div class="mafw-rail-load-more">仅显示前 {SEARCH_CAP} 条结果</div>
        </Show>
      </div>

      {/* Pinned bottom area — never scrolls with the list */}
      <div class="mafw-rail-fixed">
        <Show when={managerRow()}>
          <div
            class="mafw-rail-manager-row"
            classList={{ active: props.activeSessionId === managerRow()!.id }}
            onClick={() => props.onSelectSession(managerRow()!.id, "Manager", true)}
          >
            <span class="mafw-rail-manager-glyph">◆</span>
            <span class="mafw-rail-session-title">Manager</span>
            <span class="mafw-rail-manager-dot" />
          </div>
        </Show>
        <div class="mafw-rail-footer">
          <UsagePill onClick={() => props.onOpenUsage?.()} />
          <div class="mafw-rail-settings-bar" onClick={() => props.onSettings?.()}>
            <Icon name="settings-gear" size="small" />
            <span>Settings</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors（Rail 有 `@ts-nocheck`，但 import 路径错误仍会由 vite 编译暴露；typecheck 保险）

- [ ] **Step 3: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/Rail.tsx
git commit -m "feat(desktop): rewrite Rail as flat date-grouped searchable session list"
```

---

### Task 6: MafwShell 接线

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- Consumes: `sessionStore`（Task 4）、新 Rail Props（Task 5）、`window.api.mafw.sessions.remove/rename`（Task 3）
- Produces: SSE onopen → `sessionStore.invalidate()`；Rail 不再收 `sessionRefreshKey`

- [ ] **Step 1: import store**

文件顶部 import 区加：

```tsx
import { sessionStore } from "./session-store"
```

- [ ] **Step 2: historySessions 改走 store**

:129-138 的 effect 替换为：

```tsx
  const [historySessions, setHistorySessions] = createSignal<{ id: string; title?: string; time?: { updated?: number }; metadata?: { mafw?: { role?: string } } }[]>([])
  createEffect(() => {
    const pd = currentProject()
    if (gwStatus()?.state !== "ready") return
    setHistorySessions(sessionStore.sessionsFor(pd) as any)
  })
```

（`sessionStore.sessionsFor` 是响应式读取，effect 依赖其内部 version 信号。）

- [ ] **Step 3: SSE onopen 改为 invalidate**

:976-979 的 `es.onopen` 替换为：

```tsx
    es.onopen = () => {
      console.log("[mafw] SSE connected")
      // Gateway restarts keep the same port; reconnect is the only reliable
      // signal that the cached session list is stale.
      sessionStore.invalidate()
    }
```

- [ ] **Step 4: Rail props 更新**

:1728 的 `<Rail ...>` 调用：删除 `sessionRefreshKey={sessionRefreshKey()}`，追加 `onSessionDeleted={(id) => { if (activeSessionId() === id) { setActiveSessionId(null); setActiveViewId(null); setShowWelcome(true) } }}`：

```tsx
            <Rail activeSessionId={activeSessionId()} managerSessionId={managerSessionId()} onSelectSession={(id, title, manager) => {
```

（onSelectSession/onSettings/onToggleCollapsed/onOpenUsage 保持原样。）

- [ ] **Step 5: 清理 sessionRefreshKey（全部 5 处调用点）**

删除 :78 的 `const [sessionRefreshKey, setSessionRefreshKey] = createSignal(0)` 声明；**除 SSE onopen 外还有 4 处调用必须一并替换为 `sessionStore.invalidate()`**（新建/关闭会话后共享 store 必须刷新，否则 typecheck 也会失败）：

- :1346 与 :1356（`createSession` 流程内）→ `sessionStore.invalidate()`
- :1378 与 :1389（`closeSession` 流程内）→ `sessionStore.invalidate()`

执行时以 `grep -n "setSessionRefreshKey" MafwShell.tsx` 确认清零。

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "refactor(desktop): wire Rail and history to the shared session store"
```

---

### Task 7: CSS 重写 rail 段

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（:207-336 的 rail 段整体替换；:2350-2365 保留）

- [ ] **Step 1: 替换样式**

删除选择器：`.mafw-rail-section`、`.mafw-rail-section-count`、`.mafw-rail-tree`、`.mafw-rail-item-label`（rail 专用部分）、`.mafw-rail-tree-item`、`.mafw-rail-project-item`、`.mafw-agent-icon`、`.mafw-rail-manager-label`、`.mafw-rail-session-time`、`.mafw-rail-project-list`、`.mafw-rail-add`、`.mafw-rail-spacer`、`.mafw-rail-collapse-bar`（:2353-2358）。

写入新样式（13px 行字、无图标、无缩进）：

```css
.mafw-rail { width: 100%; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--bg-base); border-right: 1px solid var(--border-subtle); }
.mafw-rail-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 4px; flex-shrink: 0; }
.mafw-rail-switcher { flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0; height: 28px; padding: 0 6px; border-radius: 6px; cursor: pointer; color: var(--text-2); font-size: 13px; font-weight: 500; }
.mafw-rail-switcher:hover { background: var(--hover); color: var(--text-1); }
.mafw-rail-switcher-caret { font-size: 10px; opacity: .6; }
.mafw-rail-switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mafw-rail-check { margin-left: auto; opacity: .8; }
.mafw-rail-collapse { width: 24px; height: 24px; flex-shrink: 0; border: none; background: transparent; color: var(--text-3); border-radius: 6px; cursor: pointer; font-size: 12px; line-height: 1; }
.mafw-rail-collapse:hover { background: var(--hover); color: var(--text-1); }
.mafw-rail-new { padding: 2px 8px 6px; flex-shrink: 0; }
.mafw-rail-new-btn { width: 100%; height: 30px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-2); border-radius: 6px; font-size: 13px; cursor: pointer; }
.mafw-rail-new-btn:hover { background: var(--hover); color: var(--text-1); }
.mafw-rail-search { padding: 0 8px 8px; flex-shrink: 0; }
.mafw-rail-search input { width: 100%; }
.mafw-rail-scroll { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-bottom: 8px; }
.mafw-rail-date-group { position: sticky; top: 0; z-index: 1; padding: 8px 12px 4px; background: var(--bg-base); color: var(--text-5); font-size: 11px; font-weight: 500; letter-spacing: .06em; user-select: none; }
.mafw-rail-session { display: flex; align-items: center; gap: 6px; height: 32px; margin: 1px 6px; padding: 0 8px 0 12px; border-radius: 6px; cursor: pointer; color: var(--text-2); font-size: 13px; transition: background .12s, color .12s; }
.mafw-rail-session:hover { background: var(--hover); color: var(--text-1); }
.mafw-rail-session.active { background: var(--hover); color: var(--text-1); }
.mafw-rail-session[data-hi="1"] { background: var(--hover); color: var(--text-1); }
.mafw-rail-session-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mafw-rail-row-dots { opacity: 0; flex-shrink: 0; width: 18px; text-align: center; color: var(--text-4); border-radius: 4px; }
.mafw-rail-session:hover .mafw-rail-row-dots { opacity: 1; }
.mafw-rail-row-dots:hover { opacity: 1 !important; color: var(--text-1); background: var(--bg-overlay); }
.mafw-rail-load-more { margin: 8px auto; width: fit-content; padding: 4px 14px; border-radius: 999px; background: var(--bg-overlay); color: var(--text-3); font-size: 12px; cursor: pointer; user-select: none; }
.mafw-rail-load-more:hover { color: var(--text-1); }
.mafw-rail-empty { padding: 16px 12px; color: var(--text-5); font-style: italic; font-size: 13px; }
.mafw-rail-fixed { flex-shrink: 0; background: var(--bg-base); border-top: 1px solid var(--border-subtle); }
.mafw-rail-manager-row { display: flex; align-items: center; gap: 8px; height: 34px; margin: 2px 6px; padding: 0 10px; border-radius: 6px; cursor: pointer; color: var(--text-2); font-size: 13px; }
.mafw-rail-manager-row:hover { background: var(--hover); color: var(--text-1); }
.mafw-rail-manager-row.active { background: var(--hover); color: var(--text-1); }
.mafw-rail-manager-glyph { color: var(--text-4); font-size: 11px; }
.mafw-rail-manager-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--text-6, var(--text-5)); margin-left: auto; }
.mafw-rail-settings-bar { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; font-size: 13px; color: var(--text-3); border-top: 1px solid var(--border-subtle); background: var(--bg-base); cursor: pointer; flex-shrink: 0; transition: color .12s, background .12s; }
.mafw-rail-settings-bar:hover { color: var(--text-1); background: var(--bg-overlay); }
.mafw-rail-footer { display: flex; flex-direction: column; }
.mafw-rail-scroll::-webkit-scrollbar { width: 8px; }
.mafw-rail-scroll::-webkit-scrollbar-thumb { background: var(--bg-overlay); border-radius: 4px; }
```

保留 :2350-2365 的 wrap/collapsed/expand 样式，但删除 `.mafw-rail-collapse-bar` 相关三条（:2353-2358）；**同时删除 :2351 的 `.mafw-rail-scroll` 定义**（新块中已有，避免重复定义）。另外在 `.mafw-rail-switcher-menu`（下拉内容）加滚动上限：

```css
.mafw-rail-switcher-menu { max-height: 320px; overflow-y: auto; }
```

- [ ] **Step 2: typecheck**

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): rail styles for flat grouped session list"
```

---

### Task 8: 全量验证与部署

- [ ] **Step 1: gateway 构建测试**

Run: `cd gateway && npm run build && npm test`
Expected: 347 passed

- [ ] **Step 2: desktop typecheck**

Run: `cd opencode-dev/packages/desktop && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 部署 gateway（仓库既有流程）**

```bash
cd C:\work\work-loop\opencode-plugin-mafw
npm pack
# 先 taskkill 3000 端口 gateway PID，再：
npm install -g opencode-plugin-mafw-4.1.0.tgz --no-audit --no-fund
node C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw\gateway\dist\index.js  # 分离启动
```

验证：`curl http://127.0.0.1:3000/api/sessions?projectID=<urlencoded 主项目>` 返回 1996 条；`curl -X DELETE .../api/sessions/<测试会话id>` 返回 `{ok:true}` 且 serve 列表真删（用一个废弃测试会话验证）。

- [ ] **Step 4: 手动验证清单（桌面端 dev）**

- [ ] Rail：分组"今天/昨天/过去 7 天/N月"固定出现，updated 倒序（刚活跃的旧会话在最前）
- [ ] 滚到底自动加载；"加载更多"按钮兜底
- [ ] 搜索过滤、↑↓/Enter/Esc、Ctrl+K 聚焦、无结果空态、200 条上限提示
- [ ] Rename：菜单 → 行内编辑（无 window.prompt）→ Enter 提交 → 列表即时更新；Esc 取消
- [ ] Delete：二次确认 → 真删（serve 列表确认）→ active 会话被删时回 welcome
- [ ] Manager 沉底固定行，列表再长也不滚动；点击进入 manager 会话
- [ ] 项目 switcher 切换 → 列表随动；下拉有 Copy path
- [ ] 断开 gateway（taskkill 3000）→ Rail 显示 "Gateway offline"；重启 gateway + SSE 重连 → 自动恢复列表
- [ ] 折叠箭头右置生效；折叠后 ▶ 浮标恢复
- [ ] worker/子代理会话不出现（1996 条口径不变）

- [ ] **Step 5: 最终 Commit + spec 状态更新**

```bash
git add -A
git commit -m "chore: rail redesign verification pass"
```

Spec 头部状态行改为：`状态：已实施（2026-09-01）`，一并提交。

## Self-Review 记录

- Spec 覆盖：store（T4）、布局/行/分组/搜索/无限滚动（T5/T7）、Manager 沉底（T5/T7）、switcher+折叠（T5/T7）、gateway DELETE/PATCH（T1）、SDK/preload（T2/T3）、MafwShell 接线（T6）、验证（T8）——无缺口
- 宽度项：spec"200→240"修正为"默认 264 已达标，不改"（Global Constraints 已注明）
- 类型一致性：`sessionStore.sessionsFor/isOffline/invalidate`、`sessions.remove/rename`、Rail Props 在 T3/T4/T5/T6 间逐字核对一致
- 占位符：T5 为单份最终代码（无"替换为"式二次修正）；T1 测试残缺 `request` stub 已删除（send 为唯一 HTTP helper）
- **子代理评审（ses_fa4fd23f7ffeU7ihNE46JkJR61，FIX-FIRST）已全部落实**：B1 `window.prompt`→行内 TextInputV2 重命名；B2 `onMount` 导入；B3 `session.update` 扁平签名统一（路由/adapter/contract/测试）；B4 `setSessionRefreshKey` 全部 5 处调用点迁移（T6）；M5 placement `bottom-start`；M6 settings-bar 基础样式保留；M7 离线态（`isOffline` + "Gateway offline"）；M8 `sessionApi` 能力门 503；M9 switcher max-height 320 + Copy path；M10 adapter delete/update unwrap throw；M11 行号锚点修正（adapter :103-107、index :3770）；M12 spec 改为本次删除 refreshKey；N13 store 单份最终版；N14 `.mafw-rail-scroll` 重复定义删除；N15 `selectProject` 加 invalidate；N16 PATCH body promise 加 `req.on('error')`
