# Agent 运行时重启能力（agentProcessApi）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 gateway 增加"重启 agent 运行时进程"的能力：runtime 契约新增 `agentProcessApi` 能力位与 `agentProcess.restart()` 原语，serve 进程动作下沉到 supervisor 模块，四入口暴露（HTTP / SDK / 桌面 / MCP）。

**Architecture:** 新建 `gateway/src/runtime/serve-supervisor.ts` 作为 serve 进程唯一所有者（kill/spawn/ready-wait/health，从 index.ts 下沉）；opencode 内置 runtime 的 `agentProcess.restart()` 由注入的 supervisor 承载；gateway `recoverServe()` 变纯编排（优先 runtime 原语 → 统一事件流重订 → watchdog/退避不变）。能力位可选（`agentProcessApi?: boolean`），pi/旧插件字面量不动即自动 false。

**Tech Stack:** TypeScript (CJS gateway, jest)、gateway-sdk (bun test)、SolidJS desktop。

**Spec:** `docs/superpowers/specs/2026-08-31-agent-process-restart-design.md`

## Global Constraints

- 路由 regex 用 `(?:\?|$)` 锚定（AGENTS.md §6.5）；错误日志用 `err.message`（§6.2）
- external runtime（`MAFW_SERVER_SERVE_URL` 设定）永不 kill/respawn 外部进程 —— 与 watchdog 语义一致（index.ts:1695）
- `agentProcessApi` 为**可选**能力位：pi 的 `PI_CAPABILITIES` 字面量与旧插件不改即自动 false
- HTTP：能力不为 true → `503 { error }`；restart 与 runtime-switch 互斥（进行中 → `409 { error }`）
- 不新增 `agentProcess.health()` —— 健康探测复用既有 `healthCheck?()`
- gateway 错误日志格式 `[Scheduler] ...`；测试放 `gateway/tests/unit/`（与 runtime-switch.test.ts 同目录）
- MCP 工具 handler 签名：`async (args, services: Services) => { content: [{type:'text', text}], isError? }`

---

### Task 1: 契约扩展（contract.ts）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Test: `gateway/tests/unit/runtime-contract.test.ts`（新建）

**Interfaces:**
- Produces: `RuntimeCapabilities.agentProcessApi?: boolean`；`AgentRuntime.agentProcess?: { restart(): Promise<void> }`；`minimalCapabilities()` 显式 `agentProcessApi: false`

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/runtime-contract.test.ts`

```typescript
import { fullCapabilities, minimalCapabilities } from '../../src/runtime/contract';

describe('runtime capability contract', () => {
  it('fullCapabilities owns the agent process', () => {
    const caps = fullCapabilities();
    expect(caps.agentProcessApi).toBe(true);
  });
  it('minimalCapabilities does not own the agent process', () => {
    const caps = minimalCapabilities();
    expect(caps.agentProcessApi).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/runtime-contract.test.ts --runInBand`
Expected: FAIL — `expect(caps.agentProcessApi).toBe(true)` 收到 undefined

- [ ] **Step 3: 实现**

contract.ts 三处修改：

```typescript
// RuntimeCapabilities 追加（agentConfigApi 之后）：
  /** runtime 拥有 agent 进程生命周期（可重启底层 agent 进程；external/进程内 runtime 为 false/缺省） */
  agentProcessApi?: boolean;

// fullCapabilities() 返回对象追加：
    agentProcessApi: true,

// minimalCapabilities() 返回对象追加：
    agentProcessApi: false,

// RuntimeClient 追加（agents?: 之后）：
  agentProcess?: {
    /** 原语：杀 + 重新拉起 agent 进程。不负责事件流重订（gateway 编排）。 */
    restart(): Promise<void>;
  };
```

文件头注释「可选接口扩展」清单补一行：`agentProcess — { restart() } agent 进程重启原语`。

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/runtime-contract.test.ts --runInBand`
Expected: PASS（2 用例）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/contract.ts gateway/tests/unit/runtime-contract.test.ts
git commit -m "feat(gateway): add agentProcessApi capability to runtime contract"
```

---

### Task 2: serve-supervisor 模块（动作下沉）

**Files:**
- Create: `gateway/src/runtime/serve-supervisor.ts`
- Modify: `gateway/src/index.ts:143`（`killProcessOnPort` 移出，Task 4 再删原体）
- Test: `gateway/tests/unit/serve-supervisor.test.ts`（新建）

**Interfaces:**
- Consumes: `startServeSidecar`（serve-sidecar.ts，注入以便测试）
- Produces: `createServeSupervisor(opts): ServeSupervisor`，接口：
  `{ ensureStarted(): Promise<string>; restart(): Promise<string>; health(): Promise<boolean>; close(): void; readonly owned: boolean }`
  （返回值为 serve url；`owned=false` 时 restart/ensureStarted 抛 `Error('external agent process is not managed by the gateway')`）

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/serve-supervisor.test.ts`

```typescript
import { createServeSupervisor } from '../../src/runtime/serve-supervisor';

function makeDeps(overrides: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      port: 4096,
      external: false,
      killPort: () => { calls.push('kill'); },
      spawn: async () => { calls.push('spawn'); return { url: 'http://127.0.0.1:4096', close: () => {} }; },
      probe: async () => { calls.push('probe'); return true; },
      probeIntervalMs: 1,
      probeTimeoutMs: 50,
      ...overrides,
    },
  };
}

describe('serve supervisor', () => {
  it('ensureStarted kills stale process, spawns, waits for health', async () => {
    const { deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(deps.calls).toEqual(['kill', 'spawn', 'probe']);
  });

  it('ensureStarted is idempotent while healthy', async () => {
    const { deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    const url = await sup.ensureStarted();
    expect(url).toBe('http://127.0.0.1:4096');
    expect(deps.calls).toEqual(['kill', 'spawn', 'probe']); // no second kill/spawn
  });

  it('restart always kills and respawns', async () => {
    const { deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    await sup.ensureStarted();
    await sup.restart();
    expect(deps.calls.filter(c => c === 'kill')).toHaveLength(2);
    expect(deps.calls.filter(c => c === 'spawn')).toHaveLength(2);
  });

  it('health() delegates to probe', async () => {
    const { deps } = makeDeps();
    const sup = createServeSupervisor(deps);
    expect(await sup.health()).toBe(true);
  });

  it('external supervisor refuses to manage the process', async () => {
    const { deps } = makeDeps({ external: true });
    const sup = createServeSupervisor(deps);
    await expect(sup.restart()).rejects.toThrow('not managed by the gateway');
    await expect(sup.ensureStarted()).rejects.toThrow('not managed by the gateway');
    expect(deps.calls).toEqual([]);
  });

  it('close() tears down the sidecar', async () => {
    let closed = false;
    const sup = createServeSupervisor({
      port: 4096, external: false, killPort: () => {},
      spawn: async () => ({ url: 'http://x', close: () => { closed = true; } }),
      probe: async () => true, probeIntervalMs: 1, probeTimeoutMs: 50,
    });
    await sup.ensureStarted();
    sup.close();
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/serve-supervisor.test.ts --runInBand`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 实现** `gateway/src/runtime/serve-supervisor.ts`

```typescript
/**
 * Serve 进程唯一所有者：kill / spawn / 就绪等待 / 健康探测。
 * 从 index.ts 下沉（原 killProcessOnPort + startServe + isServeHealthy 的动作段），
 * opencode runtime 的 agentProcess.restart() 与 gateway 编排共用此模块。
 * deps 全部注入以便单测；生产装配见 index.ts。
 */
import { startServeSidecar } from '../serve-sidecar';
import { log } from '../core/utils/logger';

export interface ServeSupervisorDeps {
  port: number;
  host?: string;
  external: boolean;
  killPort: (port: number) => void;
  spawn?: typeof startServeSidecar;
  probe?: (url: string) => Promise<boolean>;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  onOutput?: (chunk: string) => void;
}

export interface ServeSupervisor {
  readonly owned: boolean;
  ensureStarted(): Promise<string>;
  restart(): Promise<string>;
  health(): Promise<boolean>;
  close(): void;
}

export function createServeSupervisor(deps: ServeSupervisorDeps): ServeSupervisor {
  const host = deps.host ?? '127.0.0.1';
  const probeIntervalMs = deps.probeIntervalMs ?? 500;
  const probeTimeoutMs = deps.probeTimeoutMs ?? 60_000;
  const spawn = deps.spawn ?? ((o: any) => startServeSidecar(o));
  const probe = deps.probe ?? (async (url: string) => {
    try {
      const res = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(3000) } as any);
      return res.ok;
    } catch { return false; }
  });

  let instance: { url: string; close: () => void } | undefined;
  let starting: Promise<string> | undefined;

  const refused = () => new Error('external agent process is not managed by the gateway');

  const spawnAndWait = async (): Promise<string> => {
    instance = await spawn({ host, port: deps.port, timeoutMs: probeTimeoutMs, onOutput: deps.onOutput });
    const deadline = Date.now() + probeTimeoutMs;
    while (Date.now() < deadline) {
      if (await probe(instance.url)) return instance.url;
      await new Promise(r => setTimeout(r, probeIntervalMs));
    }
    throw new Error(`serve did not become healthy within ${probeTimeoutMs}ms`);
  };

  return {
    get owned() { return !deps.external; },
    async ensureStarted(): Promise<string> {
      if (deps.external) throw refused();
      if (instance && await probe(instance.url)) return instance.url;
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killPort(deps.port);
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async restart(): Promise<string> {
      if (deps.external) throw refused();
      if (starting) return starting;
      starting = (async () => {
        try {
          deps.killPort(deps.port);
          instance?.close();
          instance = undefined;
          return await spawnAndWait();
        } finally { starting = undefined; }
      })();
      return starting;
    },
    async health(): Promise<boolean> {
      if (!instance) return false;
      return probe(instance.url);
    },
    close() {
      try { instance?.close(); } catch { /* ignore */ }
      instance = undefined;
    },
  };
}
```

注意：实现里 `log` 导入若未用到可去掉（保留 import 会挂 lint——本仓库无 lint，可留可去；直接不导入）。

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/serve-supervisor.test.ts --runInBand`
Expected: PASS（6 用例）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/serve-supervisor.ts gateway/tests/unit/serve-supervisor.test.ts
git commit -m "feat(gateway): add serve supervisor owning kill/spawn/health actions"
```

---

### Task 3: opencode runtime 接线 agentProcess

**Files:**
- Modify: `gateway/src/runtime/opencode-runtime.ts`（~242-280）
- Test: `gateway/tests/unit/opencode-runtime-agentprocess.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `agentProcess` 接口；Task 2 的 `ServeSupervisor`（经 `OpencodeRuntimeConfig` 注入）
- Produces: owned runtime 携带 `agentProcess.restart()`；external runtime `capabilities.agentProcessApi === false` 且无 `agentProcess`

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/opencode-runtime-agentprocess.test.ts`

```typescript
import { createOpencodeRuntime } from '../../src/runtime/opencode-runtime';

// createOpencodeRuntime 需要 opencode client —— 通过注入假 adapter 观察
// capabilities/agentProcess 装配，不真连 serve。
jest.mock('../../src/runtime/opencode-adapter', () => ({
  createOpencodeAdapter: async () => ({
    session: {}, global: { event: async () => ({}) },
    provider: { list: async () => ({ all: [], connected: [] }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async () => ({}) },
  }),
}));

describe('opencode runtime agentProcess wiring', () => {
  it('owned runtime: agentProcessApi=true + restart delegates to supervisor', async () => {
    let restarted = 0;
    const rt = await createOpencodeRuntime({
      baseUrl: 'http://127.0.0.1:4096',
      supervisor: { restart: async () => { restarted++; } },
    } as any);
    expect(rt.capabilities.agentProcessApi).toBe(true);
    expect(rt.agentProcess).toBeDefined();
    await rt.agentProcess!.restart();
    expect(restarted).toBe(1);
  });

  it('external runtime: agentProcessApi=false and no agentProcess', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    try {
      const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999' } as any);
      expect(rt.external).toBe(true);
      expect(rt.capabilities.agentProcessApi).toBe(false);
      expect(rt.agentProcess).toBeUndefined();
    } finally {
      delete process.env.MAFW_SERVER_SERVE_URL;
    }
  });
});
```

（若 `OpencodeRuntimeConfig` 字段名与 `baseUrl`/`headers` 不同，以 `opencode-runtime.ts:242-266` 实际为准调整 mock；`supervisor` 为新增可选字段。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/opencode-runtime-agentprocess.test.ts --runInBand`
Expected: FAIL — `rt.capabilities.agentProcessApi` undefined / `rt.agentProcess` undefined

- [ ] **Step 3: 实现**

opencode-runtime.ts：

```typescript
// OpencodeRuntimeConfig 接口追加可选字段：
  supervisor?: { restart(): Promise<string> };

// createOpencodeRuntime 内（:246-247 替换）：
  const external = !!process.env.MAFW_SERVER_SERVE_URL;
  const rt: AgentRuntime = Object.assign(client, {
    name: 'opencode' as const,
    capabilities: { ...fullCapabilities(), agentProcessApi: !external },
    external,
    ...(external || !config.supervisor ? {} : {
      agentProcess: {
        restart: async (): Promise<void> => { await config.supervisor!.restart(); },
      },
    }),
    // credentials / getBaseUrl / healthCheck 保持不变
```

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npx jest tests/unit/opencode-runtime-agentprocess.test.ts tests/unit/runtime-contract.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/runtime/opencode-runtime.ts gateway/tests/unit/opencode-runtime-agentprocess.test.ts
git commit -m "feat(gateway): wire agentProcess primitive into opencode runtime"
```

---

### Task 4: gateway 编排重构 + HTTP 端点

**Files:**
- Modify: `gateway/src/index.ts`（~143, ~1608-1708 startServe/recoverServe/isServeHealthy/handleServeExit；~3196-3280 runtime 路由区）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts` 不改（PI_CAPABILITIES 无新字段 = false）
- Test: `gateway/tests/unit/restart-agent.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `ServeSupervisor`、Task 3 runtime `agentProcess`
- Produces: `POST /api/runtime/restart-agent`（200 `{success, mode:'owned-respawn'}` / 409 / 503）；runtime-switch 互斥

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/restart-agent.test.ts`

结构仿 `gateway/tests/unit/runtime-switch.test.ts`（真实 http server + postJson helper）：

```typescript
import * as http from 'http';
import { handleRestartAgent } from '../../src/routes/restart-agent';

function makeDeps(overrides: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      capabilities: () => ({ agentProcessApi: true }),
      isRecovering: () => false,
      isSwitching: () => false,
      begin: () => calls.push('begin'),
      end: () => calls.push('end'),
      restartAgent: async () => { calls.push('restart'); return { mode: 'owned-respawn' }; },
      ...overrides,
    },
  };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    if (req.url?.match(/^\/api\/runtime\/restart-agent(?:\?|$)/) && req.method === 'POST') {
      await handleRestartAgent(req, res, deps);
      return;
    }
    res.writeHead(404); res.end();
  });
}

async function post(server: http.Server): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: '/api/runtime/restart-agent', method: 'POST' }, (res) => {
      let c = ''; res.on('data', d => c += d);
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(c) }));
    });
    req.on('error', reject); req.end();
  });
}

describe('POST /api/runtime/restart-agent', () => {
  let server: http.Server;
  afterEach(done => { if (server?.listening) server.close(done); else done(); });

  it('200 owned: begin → restart → end, returns mode', async () => {
    const { deps } = makeDeps();
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mode: 'owned-respawn' });
    expect(deps.calls).toEqual(['begin', 'restart', 'end']);
  });

  it('503 when capability absent (external / in-process runtime)', async () => {
    const { deps } = makeDeps({ capabilities: () => ({ agentProcessApi: false }) });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/does not own the agent process/);
    expect(deps.calls).toEqual([]);
  });

  it('409 while recovering', async () => {
    const { deps } = makeDeps({ isRecovering: () => true });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(409);
  });

  it('409 while runtime switching', async () => {
    const { deps } = makeDeps({ isSwitching: () => true });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(409);
  });

  it('500 when restart throws; end() still runs', async () => {
    const { deps } = makeDeps({ restartAgent: async () => { throw new Error('spawn failed'); } });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(500);
    expect(deps.calls).toEqual(['begin', 'end']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/restart-agent.test.ts --runInBand`
Expected: FAIL — Cannot find module routes/restart-agent

- [ ] **Step 3: 实现** `gateway/src/routes/restart-agent.ts`（新文件，deps 注入仿 runtime-switch.ts）

```typescript
import * as http from 'http';

export interface RestartAgentDeps {
  capabilities: () => { agentProcessApi?: boolean };
  isRecovering: () => boolean;
  isSwitching: () => boolean;
  begin: () => void;
  end: () => void;
  restartAgent: () => Promise<{ mode: string }>;
}

export async function handleRestartAgent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RestartAgentDeps,
): Promise<void> {
  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (deps.capabilities().agentProcessApi !== true) {
    json(503, { error: 'runtime does not own the agent process (external or in-process runtime)' });
    return;
  }
  if (deps.isRecovering() || deps.isSwitching()) {
    json(409, { error: 'agent process recovery/runtime switch already in progress' });
    return;
  }
  deps.begin();
  try {
    const { mode } = await deps.restartAgent();
    json(200, { success: true, mode });
  } catch (err: any) {
    json(500, { error: err.message });
  } finally {
    deps.end();
  }
}
```

- [ ] **Step 4: index.ts 接线（编排重构）**

(a) 创建 supervisor 并注入 runtime（`createOpencodeRuntime` 调用处传 `supervisor`）：

```typescript
// import 区：
import { createServeSupervisor } from './runtime/serve-supervisor';
// 字段区（serveInstance 附近）：
private serveSupervisor = createServeSupervisor({
  port: config.server.servePort,
  external: !!process.env.MAFW_SERVER_SERVE_URL,
  killPort: (port) => killProcessOnPort(port),
  onOutput: () => {},
});
// runtime 创建处（opencode runtime）：
const rt = await createOpencodeRuntime({ ...config, supervisor: this.serveSupervisor });
```

（`killProcessOnPort` 函数体 :143 保留原位供 supervisor 注入引用；`startServe()`/`isServeHealthy()` 改为薄委托 `this.serveSupervisor.ensureStarted()` / `.health()`；`handleServeExit`/watchdog 编排不变。）

(b) 编排方法（新增，recoverServe 改为调用它）：

```typescript
private switchingRuntime = false;
private async restartAgentOrchestrated(): Promise<{ mode: string }> {
  const rt = this.opencodeClient;
  if (rt?.agentProcess) {
    await rt.agentProcess.restart();            // runtime 动作
  } else {
    await this.serveSupervisor.restart();       // 无新接口插件 → supervisor 兜底
  }
  await this.subscribeToEvents();               // gateway 编排：事件流重订
  this.startServeWatchdog();
  return { mode: 'owned-respawn' };
}
```

`recoverServe()` 内原「kill + startServe」两行替换为 `await this.restartAgentOrchestrated()`，其余（退避/streak/watchdog）不动。

(c) 路由接线（runtime 路由区，`POST /api/runtime/reload` 旁）：

```typescript
if (req.url?.match(/^\/api\/runtime\/restart-agent(?:\?|$)/) && req.method === 'POST') {
  await handleRestartAgent(req, res, {
    capabilities: () => this.opencodeClient?.capabilities ?? {},
    isRecovering: () => this.serveRecovering,
    isSwitching: () => this.switchingRuntime,
    begin: () => { this.serveRecovering = true; },
    end: () => { this.serveRecovering = false; },
    restartAgent: () => this.restartAgentOrchestrated(),
  });
  return;
}
```

(d) 互斥另一侧：`routes/runtime-switch.ts` 的 `handleRuntimeSwitch` 开头加守卫（deps 加 `isRecovering: () => boolean`，index.ts 接线传 `() => this.serveRecovering`）：

```typescript
if (deps.isRecovering?.()) {
  res.writeHead(409, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'agent process recovery in progress; retry shortly' }));
  return;
}
```

`RuntimeSwitchDeps` 加 `isRecovering?: () => boolean`；runtime-switch handler 内 `createRuntime()` 窗口置 `deps.setSwitching?.(true/false)`（deps 加可选 `setSwitching?: (v: boolean) => void`，index.ts 传 `(v) => { this.switchingRuntime = v; }`）——restart-agent 侧 `isSwitching()` 由此为真。

- [ ] **Step 5: 运行确认通过（全量 gateway 测试）**

Run: `cd gateway; npm run build; if ($?) { npm test }`
Expected: build 0；jest 全绿（含 restart-agent 5 用例 + 既有 runtime-switch 套件）

- [ ] **Step 6: 提交**

```bash
git add gateway/src/routes/restart-agent.ts gateway/src/routes/runtime-switch.ts gateway/src/index.ts gateway/tests/unit/restart-agent.test.ts
git commit -m "feat(gateway): restart-agent orchestration, HTTP endpoint, runtime-switch mutex"
```

---

### Task 5: SDK `restartAgent`

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`（RuntimeNamespace）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`（runtime namespace）
- Test: `opencode-dev/packages/gateway-sdk/src/client.test.ts`

- [ ] **Step 1: 写失败测试**（client.test.ts 末尾追加）

```typescript
test("runtime.restartAgent hits its route", async () => {
  fetchMock.mockResolvedValue(okJson({ success: true, mode: "owned-respawn" }))
  const c = new MafwClient()
  const r = await c.runtime.restartAgent()
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/runtime/restart-agent",
    expect.objectContaining({ method: "POST" }))
  expect(r.mode).toBe("owned-respawn")
})

test("runtime.restartAgent surfaces 503/409 errors", async () => {
  fetchMock.mockResolvedValue({
    ok: false, status: 503, statusText: "Service Unavailable",
    json: () => Promise.resolve({ error: "runtime does not own the agent process" }),
  } as Response)
  const c = new MafwClient()
  await expect(c.runtime.restartAgent()).rejects.toThrow("does not own the agent process")
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd opencode-dev/packages/gateway-sdk; bun test`
Expected: FAIL — restartAgent is not a function

- [ ] **Step 3: 实现**

types.ts `RuntimeNamespace` 追加：

```typescript
  /** 重启 runtime 拥有的 agent 进程（serve sidecar）。external/in-process runtime → 503。 */
  restartAgent(): Promise<{ success: boolean; mode: string }>
```

client.ts runtime namespace 追加（仿 switch 实现）：

```typescript
    restartAgent: async (): Promise<{ success: boolean; mode: string }> => {
      const res = await fetch(`${this.baseUrl}/api/runtime/restart-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Agent restart failed: ${res.status}`)
      }
      return res.json()
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd opencode-dev/packages/gateway-sdk; bun test; if ($?) { bun run typecheck }`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add opencode-dev/packages/gateway-sdk/src/types.ts opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/gateway-sdk/src/client.test.ts
git commit -m "feat(sdk): runtime.restartAgent for agent process restart"
```

---

### Task 6: MCP 工具 `mafw_restart_agent`

**Files:**
- Modify: `gateway/src/types.ts`（Services 加 `agentRestart?`）
- Modify: `gateway/src/mcp/tool-registry.ts`（DEFINITION + handler 映射）
- Create: `gateway/src/mcp/handlers/restart-agent.ts`
- Modify: `gateway/src/index.ts:1496`（services 装配）
- Test: `gateway/tests/unit/restart-agent.test.ts` 追加 handler 用例

- [ ] **Step 1: 写失败测试**（restart-agent.test.ts 追加）

```typescript
import { handleRestartAgentTool } from '../../src/mcp/handlers/restart-agent';

describe('mafw_restart_agent tool handler', () => {
  it('returns success payload', async () => {
    const res = await handleRestartAgentTool({}, { agentRestart: async () => ({ mode: 'owned-respawn' }) } as any);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual({ success: true, mode: 'owned-respawn' });
  });

  it('surfaces unsupported runtimes as error', async () => {
    const res = await handleRestartAgentTool({}, {} as any);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/does not support|not available/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway; npx jest tests/unit/restart-agent.test.ts --runInBand`
Expected: FAIL — Cannot find module handlers/restart-agent

- [ ] **Step 3: 实现**

types.ts `Services` 追加：`agentRestart?: () => Promise<{ mode: string }>;`

`gateway/src/mcp/handlers/restart-agent.ts`：

```typescript
import { ToolHandler } from '../../types';

export const handleRestartAgentTool: ToolHandler = async (_args, services) => {
  if (!services.agentRestart) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'current runtime does not support agent process restart' }) }], isError: true };
  }
  try {
    const { mode } = await services.agentRestart();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, mode, note: 'in-flight prompts were interrupted' }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

tool-registry.ts：DEFINITIONS 数组（`mafw_run_automation` 附近的 Tier 2 区）加：

```typescript
  {
    name: "mafw_restart_agent",
    description: "Restart the gateway-owned agent process (opencode serve sidecar). Interrupts in-flight prompts. Unavailable for external or in-process runtimes",
    inputSchema: { type: "object", properties: {} },
  },
```

handlers 映射加 `mafw_restart_agent: handleRestartAgentTool,`；文件头 import。

index.ts:1496 services 对象加：`agentRestart: () => this.restartAgentOrchestrated(),`

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway; npm test`
Expected: 全绿（工具总数 36→37，若存在工具计数断言同步 +1）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/types.ts gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/restart-agent.ts gateway/src/index.ts gateway/tests/unit/restart-agent.test.ts
git commit -m "feat(gateway): mafw_restart_agent MCP tool"
```

---

### Task 7: 桌面按钮 + preload

**Files:**
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`（runtime 块）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`（Gateway 分区卡）

- [ ] **Step 1: preload 桥接**（`runtime: { get, switch }` 块加一行）

```typescript
      restartAgent: () => invoke("runtime", "restartAgent"),
```

- [ ] **Step 2: Config 页按钮**（Gateway 分区卡，Restart Gateway 按钮旁；仿 restartGateway 函数）

```tsx
const [restartingAgent, setRestartingAgent] = createSignal(false)

const restartAgentProcess = async () => {
  setRestartingAgent(true)
  try {
    await window.api.mafw.runtime.restartAgent()
    showToastV2({ description: "Agent 运行时已重启", duration: 2500 })
  } catch (err: any) {
    showToastV2({ description: `重启失败: ${err.message}`, duration: 4000 })
  }
  setRestartingAgent(false)
}
```

```tsx
<ButtonV2 variant="outline" size="small" onClick={restartAgentProcess} disabled={restartingAgent()}>
  {restartingAgent() ? "重启中…" : "重启 Agent 运行时"}
</ButtonV2>
```

（放在现有 `Restart Gateway` ButtonV2 之后同一 actions 容器内；若 Gateway 卡无该容器则与 Copy Gateway URL 并列。）

- [ ] **Step 3: 验证**

Run: `cd opencode-dev/packages/desktop; bun run typecheck`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx
git commit -m "feat(desktop): restart agent runtime button in config page"
```

---

### Task 8: AGENTS.md 文档 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§4.1 表、§5.15、§5.18、§5.19）

- [ ] **Step 1: §4.1 工具表**加行（mafw_desktop_scroll 之后）：

```markdown
| `mafw_restart_agent` | 重启 gateway 拥有的 agent 进程（opencode serve sidecar）；external/进程内 runtime 不可用 |
```

工具计数 36→37、总 40→41 同步更新。

- [ ] **Step 2: §5.15** 末尾补一条：

```markdown
- **手动恢复入口**：`POST /api/runtime/restart-agent`（SDK `runtime.restartAgent()` / Config 页按钮 /
  MCP `mafw_restart_agent`）触发与 watchdog 相同的编排（kill+respawn+事件流重订）；external 模式 503
```

- [ ] **Step 3: §5.18** 白名单描述 35→37（`mafw_restart_agent` 与既有计数核对后更新）

- [ ] **Step 4: §5.19** Runtime 能力清单补 `agentProcessApi`；矩阵：opencode owned true / external false / pi false

- [ ] **Step 5: 全量验证**

Run: `cd gateway; npm test`
Run: `cd opencode-dev/packages/gateway-sdk; bun test; bun run typecheck`
Run: `cd opencode-dev/packages/desktop; bun run typecheck`
Expected: 全绿

- [ ] **Step 6: 手动验证（owned 模式，gateway 以 dist 运行时）**

```bash
# 找到 4096 监听进程并杀掉 → 调端点 → 确认 serve 重新拉起
curl.exe --noproxy '*' -s -X POST http://127.0.0.1:3000/api/runtime/restart-agent
# expected: {"success":true,"mode":"owned-respawn"}
netstat -ano | findstr :4096   # 确认新 PID
# external 模式（设 MAFW_SERVER_SERVE_URL 启动）→ 同端点应 503
```

- [ ] **Step 7: 提交**

```bash
git add AGENTS.md
git commit -m "docs: document agentProcessApi capability and restart-agent entries"
```
