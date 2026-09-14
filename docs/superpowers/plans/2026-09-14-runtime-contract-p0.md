# Runtime 契约 P0 实施计划：分支原语、回合信封与预算、Compaction 切面

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 MAFW runtime 契约补上三块 P0 能力——session 分支原语（fork/revert/unrevert）、prompt 回合结果信封 + maxTurns/maxCostUsd 预算硬停、compaction 事件切面（触发 turnCompress flush）。

**Architecture:** 契约先行（contract.ts 能力位 + 类型），两个内置 runtime（opencode / pi）各自实现，gateway 侧薄消费（HTTP 代理端点 + BudgetGuard + compaction flush）。能力门 fail-open：未声明能力的 runtime 不受影响。

**Tech Stack:** TypeScript (CJS 编译)、Jest（`npm test --prefix gateway`，--runInBand）、@opencode-ai/sdk v2（扁平参数风格）、@earendil-works/pi-coding-agent（ESM 动态导入桥）。

**Spec:** `docs/superpowers/specs/2026-09-14-runtime-contract-branch-budget-compaction.md`

## Global Constraints

- gateway 编译为 **CJS**：import pi SDK 只能用 `new Function('spec','return import(spec)')` 桥，禁止顶层 `import` pi 包。
- **最小契约准绳**：只暴露消费方需要的面，不发明 runtime 尚未支撑的 RPC。
- **mock 直接风格**：mock SDK 返回值不要套 `{data: ...}` 信封层（adapter 的 `unwrap()` 处理真实信封；信封 mock 会让 `unwrap` 多剥一层）。
- opencode SDK v2 是**扁平参数**：`client.session.fork({ sessionID, messageID })`，不是 `{ path: { id }, body: {...} }`。
- 所有新能力位均为可选（`?: boolean`），`minimalCapabilities()` 里显式 false。
- HTTP 路由正则需兼容 query string：`/^\/api\/sessions\/([^/]+)\/fork(?:\?|$)/` 形态。
- 每个 Task 结束跑该任务测试 + commit；最后 Task 跑全量 `npm test --prefix gateway` 与 `npm run build`。
- pi 会话分支的文件语义差异（不回滚文件、revert 不可逆）必须写进契约注释。

---

### Task 1: 契约面扩展（contract.ts）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Test: `gateway/tests/unit/runtime/contract.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）：
  - `RuntimeCapabilities.sessionBranchApi?: boolean`、`turnBudgetApi?: boolean`
  - `RuntimeClient.session.fork(opts): Promise<{ id: string }>` / `revert(opts): Promise<void>` / `unrevert(opts): Promise<void>`（全部可选）
  - `SessionPromptOpts.maxTurns?: number`、`maxCostUsd?: number`
  - `PromptResultEnvelope { parts: any[]; finish?: string; usage?: { input: number; output: number; cached?: number; reasoning?: number; costUsd?: number }; error?: { name: string; message: string } }`

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/runtime/contract.test.ts` 追加（若文件已有 describe 块则合并进去）：

```ts
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

describe('runtime contract P0 capabilities', () => {
  it('fullCapabilities declares sessionBranchApi and turnBudgetApi', () => {
    const caps = fullCapabilities();
    expect(caps.sessionBranchApi).toBe(true);
    expect(caps.turnBudgetApi).toBe(true);
  });

  it('minimalCapabilities leaves both off', () => {
    const caps = minimalCapabilities();
    expect(caps.sessionBranchApi).toBe(false);
    expect(caps.turnBudgetApi).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- contract`
Expected: FAIL（`sessionBranchApi` undefined）

- [ ] **Step 3: 实现契约扩展**

`gateway/src/runtime/contract.ts`：

`RuntimeCapabilities` 接口内 `completionApi` 之后追加：

```ts
  /** runtime 提供会话分支原语（fork/revert；unrevert 视实现可选——pi 不提供） */
  sessionBranchApi?: boolean;
  /** runtime 原生强制执行 SessionPromptOpts.maxTurns/maxCostUsd（声明后 gateway 不再挂 BudgetGuard） */
  turnBudgetApi?: boolean;
```

`fullCapabilities()` 返回对象末尾追加 `sessionBranchApi: true, turnBudgetApi: true,`；`minimalCapabilities()` 追加 `sessionBranchApi: false, turnBudgetApi: false,`。

`SessionPromptOpts` 追加：

```ts
  /** 回合数上限（一次 prompt 内 agentic loop 步数）；超出即中止。原生支持见 turnBudgetApi。 */
  maxTurns?: number;
  /** 本次 prompt 的美元成本上限；超出即中止。原生支持见 turnBudgetApi。 */
  maxCostUsd?: number;
```

`SessionPromptOpts` 之后新增信封类型：

```ts
/**
 * 回合结果信封——session.prompt() 的返回超集。字段取不到 = undefined
 * （不是错误）；error 存在时 parts 原样返回（不抛异常，与现状一致）。
 */
export interface PromptResultEnvelope {
  parts: any[];
  /** runtime 原生 finish reason（opencode AssistantMessage.finish） */
  finish?: string;
  /** undefined = runtime 未回传；消费方据此跳过记账 */
  usage?: {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
    costUsd?: number;
  };
  error?: { name: string; message: string };
}
```

`RuntimeClient.session` 接口内 `permissionReply` 之后追加：

```ts
    /**
     * 分叉为新会话：原会话不动，新会话携带截至 messageID（缺省=当前末尾）的历史。
     * pi 实现经 SessionManager.createBranchedSession + 新 AgentSession。
     */
    fork?(opts: { sessionID: string; messageID?: string }): Promise<{ id: string }>;
    /**
     * 消息级回退。opencode：撤回该点之后的消息并回滚文件改动（可 unrevert 恢复）；
     * pi：映射为 SessionManager.branch() 原地移动 leaf——不回滚文件、不可逆，
     * 语义弱于 opencode，调用方不得假设文件回滚。
     */
    revert?(opts: { sessionID: string; messageID: string; partID?: string }): Promise<void>;
    /** 撤销 revert（仅 opencode；pi 不实现——方法缺席即能力缺失） */
    unrevert?(opts: { sessionID: string }): Promise<void>;
```

`prompt` 签名改为：

```ts
    prompt(opts: SessionPromptOpts): Promise<PromptResultEnvelope & { [k: string]: any }>;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- contract`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/tests/unit/runtime/contract.test.ts
git commit -m "feat(runtime): contract gains sessionBranchApi/turnBudgetApi, prompt envelope, fork/revert"
```

---

### Task 2: opencode runtime 实现（adapter + runtime）

**Files:**
- Modify: `gateway/src/opencode-adapter.ts`（session.fork/revert/unrevert + prompt 信封映射）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（能力位已由 fullCapabilities 覆盖，确认即可）
- Test: `gateway/tests/unit/runtime/opencode-branch.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `PromptResultEnvelope`、fork/revert/unrevert 签名
- Produces: `createOpencodeAdapter()` 返回的 client 带 `session.fork/revert/unrevert`；`prompt()` 返回信封超集

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/runtime/opencode-branch.test.ts`：

```ts
import { createOpencodeAdapter } from '../../../src/opencode-adapter';

const mockClient = {
  session: {
    fork: jest.fn(async (opts: any) => ({ id: 'ses_forked', ...opts })),
    revert: jest.fn(async () => ({})),
    unrevert: jest.fn(async () => ({})),
    prompt: jest.fn(async () => ({
      info: {
        id: 'msg_1', role: 'assistant', finish: 'stop', cost: 0.0042,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 80, write: 5 } },
      },
      parts: [{ type: 'text', text: 'done' }],
    })),
  },
};

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: () => mockClient,
}));

describe('opencode adapter branch + envelope', () => {
  it('fork maps flat params and returns new session id', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.fork!({ sessionID: 'ses_1', messageID: 'msg_9' });
    expect(mockClient.session.fork).toHaveBeenCalledWith({ sessionID: 'ses_1', messageID: 'msg_9' });
    expect(out).toEqual({ id: 'ses_forked' });
  });

  it('revert/unrevert pass through', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.session.revert!({ sessionID: 'ses_1', messageID: 'msg_9', partID: 'prt_1' });
    expect(mockClient.session.revert).toHaveBeenCalledWith({ sessionID: 'ses_1', messageID: 'msg_9', partID: 'prt_1' });
    await client.session.unrevert!({ sessionID: 'ses_1' });
    expect(mockClient.session.unrevert).toHaveBeenCalledWith({ sessionID: 'ses_1' });
  });

  it('prompt returns result envelope superset', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
    expect(res.parts).toEqual([{ type: 'text', text: 'done' }]);
    expect(res.finish).toBe('stop');
    expect(res.usage).toEqual({ input: 100, output: 50, cached: 80, reasoning: 10, costUsd: 0.0042 });
    expect(res.error).toBeUndefined();
  });

  it('prompt envelope maps assistant error', async () => {
    mockClient.session.prompt.mockResolvedValueOnce({
      info: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'aborted' } } },
      parts: [],
    });
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
    expect(res.error).toEqual({ name: 'MessageAbortedError', message: 'aborted' });
    expect(res.usage).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- opencode-branch`
Expected: FAIL（`client.session.fork is not a function`）

- [ ] **Step 3: 实现 adapter 扩展**

`gateway/src/opencode-adapter.ts` `session` 对象内 `summarize` 之后追加：

```ts
      async fork(opts: { sessionID: string; messageID?: string }) {
        const result = await client.session.fork({
          sessionID: opts.sessionID,
          messageID: opts.messageID,
        });
        const session = unwrap<any>(result);
        return { id: session?.id };
      },

      async revert(opts: { sessionID: string; messageID: string; partID?: string }) {
        const result = await client.session.revert({
          sessionID: opts.sessionID,
          messageID: opts.messageID,
          partID: opts.partID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },

      async unrevert(opts: { sessionID: string }) {
        const result = await client.session.unrevert({
          sessionID: opts.sessionID,
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
      },
```

`prompt()` 方法替换为信封映射（保留原有 `{info, parts}` 展开——超集非破坏）：

```ts
      async prompt(opts: SessionPromptOpts) {
        const parts = messageToParts(opts.message, opts.parts);
        const result = await client.session.prompt({
          sessionID: opts.sessionID,
          parts,
          agent: opts.agent,
          model: opts.model,
          variant: opts.variant,
          system: opts.system,
          noReply: opts.noReply,
        });
        const data = unwrap<any>(result);
        const info = data?.info;
        const t = info?.tokens;
        return {
          ...data,
          parts: data?.parts ?? [],
          finish: info?.finish,
          usage: t
            ? {
                input: t.input ?? 0,
                output: t.output ?? 0,
                cached: t.cache?.read ?? 0,
                reasoning: t.reasoning ?? 0,
                costUsd: typeof info?.cost === 'number' ? info.cost : undefined,
              }
            : undefined,
          error: info?.error
            ? {
                name: info.error.name ?? info.error.type ?? 'Error',
                message: info.error.data?.message ?? info.error.message ?? String(info.error),
              }
            : undefined,
        };
      },
```

`opencode-runtime.ts` 无需改动（`fullCapabilities()` 已含新能力位）。确认 `createOpencodeRuntime` 的 `Object.assign(client, ...)` 保留 adapter 的新方法——是（fork 等在 client 上）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- opencode-branch`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/opencode-adapter.ts gateway/tests/unit/runtime/opencode-branch.test.ts
git commit -m "feat(runtime): opencode adapter fork/revert/unrevert + prompt result envelope"
```

---

### Task 3: pi runtime 实现（fork/revert + 信封 + 能力位）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`（registry.fork/revert + prompt 信封）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（sessionAPI.fork/revert、createSession 支持 sessionManager 透传、`PI_CAPABILITIES.sessionBranchApi = true`）
- Test: `gateway/tests/unit/runtime/pi-branch.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 契约；pi `SessionManager.createBranchedSession(leafId): string | undefined`、`SessionManager.open(path)`、`branch(branchFromId)`、`AgentSession.sessionManager`
- Produces: `registry.fork(id, messageID?): Promise<{ id: string }>`、`registry.revert(id, messageID): Promise<void>`；`registry.prompt()` 返回 `{ parts, usage?, finish? }`

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/runtime/pi-branch.test.ts`（fake session 直造，不经 ESM 桥）：

```ts
import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';

function fakeSession(over: any = {}) {
  return {
    isStreaming: false,
    messages: [],
    sessionManager: {
      getLeafId: () => 'leaf_1',
      createBranchedSession: jest.fn((leaf: string) => `/tmp/pi-fork-${leaf}.jsonl`),
      branch: jest.fn(),
    },
    prompt: jest.fn(async () => {}),
    waitForIdle: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
    ...over,
  };
}

function makeRegistry(createSessionImpl?: (opts: any) => Promise<{ session: any }>) {
  return new PiSessionRegistry({
    createSession: createSessionImpl ?? (async () => ({ session: fakeSession() })),
  });
}

describe('PiSessionRegistry branch primitives', () => {
  it('fork creates a new session from the branched file', async () => {
    const src = fakeSession();
    const forked = fakeSession();
    const createSession = jest.fn(async (opts: any) => ({ session: opts.fromFile ? forked : src }));
    const registry = makeRegistry(createSession);
    const { id } = await registry.create('/cwd', {});
    const out = await registry.fork(id, 'entry_42');
    expect(src.sessionManager.createBranchedSession).toHaveBeenCalledWith('entry_42');
    expect(createSession).toHaveBeenLastCalledWith(expect.objectContaining({ fromFile: '/tmp/pi-fork-entry_42.jsonl' }));
    expect(out.id).not.toBe(id);
    expect(registry.sessionFor(out.id)).toBe(forked);
  });

  it('fork without messageID uses current leaf', async () => {
    const src = fakeSession();
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.fork(id);
    expect(src.sessionManager.createBranchedSession).toHaveBeenCalledWith('leaf_1');
  });

  it('revert maps to sessionManager.branch; rejects while streaming', async () => {
    const src = fakeSession();
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.revert(id, 'entry_7');
    expect(src.sessionManager.branch).toHaveBeenCalledWith('entry_7');
    src.isStreaming = true;
    await expect(registry.revert(id, 'entry_8')).rejects.toThrow(/busy|streaming/i);
  });

  it('prompt returns envelope with usage/finish from last assistant message', async () => {
    const src = fakeSession({
      messages: [],
      prompt: jest.fn(async function (this: any) {
        src.messages.push({ role: 'user', content: [{ type: 'text', text: 'q' }] });
        src.messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'a' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cacheRead: 3, totalCost: 0.001 },
        });
      }),
    });
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    const res: any = await registry.prompt(id, 'q');
    expect(res.parts).toEqual([{ type: 'text', text: 'a' }]);
    expect(res.finish).toBe('stop');
    expect(res.usage).toEqual({ input: 10, output: 5, cached: 3, reasoning: undefined, costUsd: 0.001 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- pi-branch`
Expected: FAIL（`registry.fork is not a function`）

- [ ] **Step 3: 实现 registry 扩展**

`gateway/src/runtime/pi/pi-session.ts`：

`PiSessionDeps.createSession` 注释更新（opts 现可携带 `fromFile?: string`）。类内 `abort()` 之后追加：

```ts
  /**
   * 分叉为新会话：SessionManager.createBranchedSession 写出截至 leaf 的新
   * 会话文件，再经 deps.createSession({ fromFile }) 加载为独立 AgentSession。
   * 原会话不动。busy 也允许（fork 只读文件，不动 live session）。
   */
  async fork(id: string, messageID?: string): Promise<{ id: string }> {
    const s = this.requireSession(id);
    const sm = s.sessionManager;
    if (!sm?.createBranchedSession) throw new Error('pi session does not expose sessionManager');
    const leafId = messageID ?? sm.getLeafId?.();
    if (!leafId) throw new Error(`pi fork failed: no leaf for session ${id}`);
    const file = sm.createBranchedSession(leafId);
    if (!file) throw new Error(`pi fork failed: createBranchedSession returned nothing for leaf ${leafId}`);
    const bridge = new ApprovalBridge();
    const approvalExtension = createMafwApprovalExtension(bridge, this.emitEvent, this.policy);
    const newId = `pi_${randomUUID().slice(0, 8)}`;
    try {
      const { session } = await this.deps.createSession({
        cwd: s.sessionManager.getCwd?.() ?? undefined,
        fromFile: file,
        extensionFactories: [{ name: 'mafw-approval', factory: (pi: any) => approvalExtension.on(pi) }],
      });
      this.sessions.set(newId, session);
      this.bySession.set(session, newId);
      this.lastUsed.set(newId, Date.now());
      this.approvalBridges.set(newId, bridge);
    } catch (err) {
      bridge.dispose();
      throw err;
    }
    return { id: newId };
  }

  /**
   * 消息级回退 = SessionManager.branch(branchFromId) 原地移动 leaf。
   * 不回滚文件、不可逆（entry 保留在文件，可凭 id 再 branch 回去）。
   * streaming 中拒绝——branch 移动 leaf 会与进行中的写入竞争。
   */
  async revert(id: string, messageID: string): Promise<void> {
    const s = this.requireSession(id);
    if (s.isStreaming) throw new Error(`pi session ${id} is busy (streaming) — abort before revert`);
    const sm = s.sessionManager;
    if (!sm?.branch) throw new Error('pi session does not expose sessionManager');
    sm.branch(messageID);
    this.touch(id);
  }
```

`prompt()` 返回值改为信封（替换方法末尾 return）：

```ts
    const after = s.messages || [];
    const assistant = after.slice(before).filter((m: any) => m?.role === 'assistant');
    const last = assistant[assistant.length - 1];
    const u = last?.usage;
    return {
      parts: (last?.content || []).map((c: any) => ({ type: 'text', text: c?.text || '' })),
      finish: last?.stopReason,
      usage: u
        ? {
            input: u.input ?? u.promptTokens ?? 0,
            output: u.output ?? u.completionTokens ?? 0,
            cached: u.cacheRead ?? u.cachedTokens ?? 0,
            reasoning: u.reasoning,
            costUsd: typeof u.totalCost === 'number' ? u.totalCost : undefined,
          }
        : undefined,
    };
```

`pi-runtime.ts`：
- `PI_CAPABILITIES` 加 `sessionBranchApi: true,`（turnBudgetApi 不加——pi 无原生预算强制）。
- `sessionAPI` 加：

```ts
    fork: async (opts: { sessionID: string; messageID?: string }) => registry.fork(opts.sessionID, opts.messageID),
    revert: async (opts: { sessionID: string; messageID: string; partID?: string }) => registry.revert(opts.sessionID, opts.messageID),
```

- `createSession` 实现支持 `fromFile`：`opts.fromFile` 存在时，`sessionOpts.sessionManager = pi.SessionManager.open(opts.fromFile)` 后再 `createAgentSession(sessionOpts)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- pi-branch`
Expected: PASS（4 例）；再跑 `npm test --prefix gateway -- pi-session` 确认既有用例不回归。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-session.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-branch.test.ts
git commit -m "feat(runtime): pi session fork/revert via SessionManager branching + prompt envelope"
```

---

### Task 4: normalize compaction 切面

**Files:**
- Modify: `gateway/src/runtime/normalize.ts`
- Test: `gateway/tests/unit/runtime/normalize.test.ts`

**Interfaces:**
- Produces: `EventFacets.compaction: 'start' | 'end' | null`；`'session.compacting'` → start、`'session.compacted'` → end（两个 runtime 共用这两个归一化事件类型名）

- [ ] **Step 1: 写失败测试**

`normalize.test.ts` 追加：

```ts
  it('maps session.compacted to compaction end facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.compacted', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBe('end');
    expect(f.sessionID).toBe('s1');
  });

  it('maps session.compacting to compaction start facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.compacting', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBe('start');
  });

  it('unrelated events have null compaction facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.idle', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBeNull();
  });
```

既有用例若断言整个 facets 对象（toEqual 全对象）需补 `compaction: null`——跑测试时按失败信息逐个修。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- normalize`
Expected: FAIL（`f.compaction` undefined）

- [ ] **Step 3: 实现**

`normalize.ts`：
- `EventFacets` 接口 `toolCommand` 前加：

```ts
  /** 会话压缩信号：'start'=压缩前（仅 pi 有），'end'=压缩完成；无事件恒 null */
  compaction: 'start' | 'end' | null;
```

- `normalizeOpencodeEvent` return 前加：

```ts
  const compaction: EventFacets['compaction'] =
    type === 'session.compacting' ? 'start' : type === 'session.compacted' ? 'end' : null;
```

return 对象加 `compaction,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- normalize`
Expected: PASS（含既有用例修复后）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/normalize.ts gateway/tests/unit/runtime/normalize.test.ts
git commit -m "feat(runtime): normalize compaction facet (session.compacting/compacted)"
```

---

### Task 5: pi compaction 事件接线（extension 注入）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`（registry.create 注入 compaction 监听 extension）
- Test: `gateway/tests/unit/runtime/pi-branch.test.ts`（追加）或并入既有 pi-session 测试文件

**Interfaces:**
- Consumes: registry 现有 `extensionFactories` 机制（`{ name, factory: (pi) => void }`）与 `emitEvent`
- Produces: pi 会话压缩时向 eventStream 推 `{ payload: { type: 'session.compacting' | 'session.compacted', properties: { sessionID } } }`

- [ ] **Step 1: 写失败测试**

`pi-branch.test.ts` 追加：

```ts
  it('registers a compaction extension that emits normalized events', async () => {
    const handlers: Record<string, Function> = {};
    const emitted: any[] = [];
    const fakePi = { on: (name: string, fn: Function) => { handlers[name] = fn; } };
    let capturedFactories: any[] = [];
    const registry = new PiSessionRegistry(
      {
        createSession: async (opts: any) => {
          capturedFactories = opts.extensionFactories ?? [];
          return { session: fakeSession() };
        },
      },
      { emitEvent: (e) => emitted.push(e) },
    );
    const { id } = await registry.create('/cwd', {});
    const ext = capturedFactories.find((f) => f.name === 'mafw-compaction');
    expect(ext).toBeDefined();
    ext.factory(fakePi);
    handlers['session_before_compact']();
    handlers['session_compact']();
    expect(emitted).toEqual([
      { payload: { type: 'session.compacting', properties: { sessionID: id } } },
      { payload: { type: 'session.compacted', properties: { sessionID: id } } },
    ]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- pi-branch`
Expected: FAIL（`ext` undefined）

- [ ] **Step 3: 实现**

`pi-session.ts` `create()` 中 `allExtensions` 数组改为（approval 之后追加 compaction 监听）：

```ts
    const compactionExtension = {
      name: 'mafw-compaction',
      factory: (pi: any) => {
        pi.on('session_before_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacting', properties: { sessionID: id } } });
        });
        pi.on('session_compact', () => {
          this.emitEvent({ payload: { type: 'session.compacted', properties: { sessionID: id } } });
        });
      },
    };
    const allExtensions = [
      { name: 'mafw-approval', factory: (pi: any) => approvalExtension.on(pi) },
      compactionExtension,
      ...agentExtensions,
    ];
```

注意 `id` 在 create() 作用域内可用（`const id = ...` 在 allExtensions 之前）。Task 3 的 `fork()` 里新建的 extensionFactories 数组同样补上 `mafw-compaction`（复用同一形状，sessionID 用 newId）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- pi-branch`
Expected: PASS（5 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/pi-branch.test.ts
git commit -m "feat(runtime): pi compaction events via injected extension"
```

---

### Task 6: TurnPipeline.runSession 重构 + gateway compaction flush 消费

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（抽 `runSession(sessionID)`）
- Modify: `gateway/src/index.ts`（handleOpencodeEvent 消费 compaction 切面）
- Test: `gateway/tests/unit/turn-pipeline-session.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 的 `f.compaction`
- Produces: `TurnPipeline.runSession(sessionID): Promise<{ turns: number; archived: number; noops: number; failed: number }>`（runOnce 内部改为按 session 分组调 runSession）

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/turn-pipeline-session.test.ts`：

```ts
import { TurnPipeline } from '../gateway/src/recall/turn-pipeline';

function makePipeline(turns: any[], observations: any[]) {
  const prompts: string[] = [];
  const archived: string[] = [];
  const pipeline = new TurnPipeline({
    t1db: {
      listTurns: () => turns,
      readTurn: () => observations,
      archiveTurn: (sid: string, tid: number) => archived.push(`${sid}:${tid}`),
      logNoop: () => {},
    } as any,
    index: { getIndex: () => ({ entries: [] }) } as any,
    workerFor: () => ({ prompt: async (p: string) => { prompts.push(p); return 'ok'; } }),
    staleMs: 0,
    workerModel: { providerID: 'p', modelID: 'm' },
  });
  return { pipeline, prompts, archived };
}

describe('TurnPipeline.runSession', () => {
  it('processes only the given session', async () => {
    const now = Date.now();
    const turns = [
      { session_id: 's1', turn_id: 1, state: 'complete', updated_at: now - 10000 },
      { session_id: 's2', turn_id: 2, state: 'complete', updated_at: now - 10000 },
    ];
    const { pipeline, prompts, archived } = makePipeline(turns, [{ role: 'user', content: 'hello' }]);
    const res = await pipeline.runSession('s1');
    expect(res.turns).toBe(1);
    expect(archived).toEqual(['s1:1']);
    expect(prompts).toHaveLength(1);
  });

  it('returns zeros when the session has no completed turns', async () => {
    const { pipeline } = makePipeline([], []);
    const res = await pipeline.runSession('nobody');
    expect(res).toEqual({ turns: 0, archived: 0, noops: 0, failed: 0 });
  });
});
```

注：`completeTurns` 的判定字段以 `turn-pipeline.ts` 现有实现为准——写测试时先读 `completeTurns` 源码对齐 turn 对象形状（state/时间戳字段名），上面形状若不匹配按实际调整。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- turn-pipeline-session`
Expected: FAIL（`pipeline.runSession is not a function`）

- [ ] **Step 3: 实现重构**

`turn-pipeline.ts`：把 `runOnce()` 的 per-session 循环体（126-170 行 for 循环内部）抽为：

```ts
  async runSession(sessionID: string): Promise<{ turns: number; archived: number; noops: number; failed: number }> {
    const result = { turns: 0, archived: 0, noops: 0, failed: 0 };
    const turns = this.opts.t1db.listTurns();
    const complete = completeTurns(turns, { staleMs: this.opts.staleMs })
      .filter((t) => t.session_id === sessionID);
    if (complete.length === 0) return result;
    result.turns = complete.length;
    // …原循环体（merge observations → worker prompt → archive），
    //   变量 sessionTurns 换成 complete，result 字段去掉 sessions
    return result;
  }
```

`runOnce()` 改为按 session 分组后循环 `await this.runSession(sid)` 并聚合（`result.sessions++` 保留在 runOnce）。行为等价：既有 turnCompress 用例必须不回归。

- [ ] **Step 4: gateway 消费 compaction 切面**

`index.ts` `handleOpencodeEvent` 中，`// Path 1: settled LLM step` 块之前插入：

```ts
    // Compaction flush: 会话压缩发生时把该 session 的 pending T1 回合
    // 立即喂给 turnCompress（fail-open；hourly cron 在飞则跳过本轮）。
    if (f.compaction && sessionID && !memoryWorker) {
      void this.runPipelineGuarded(`memory:turnCompress(compact-flush:${sessionID})`, async () => {
        try {
          const pipeline = this.getTurnPipeline();
          const res = await pipeline.runSession(sessionID);
          if (res.turns > 0) {
            log.info(`[TurnPipeline] compaction flush session=${sessionID} turns=${res.turns} archived=${res.archived}`);
            this.scanService?.refreshCache();
          }
        } catch (err: any) {
          log.warn(`[TurnPipeline] compaction flush failed (non-fatal): ${err.message}`);
        }
      });
    }
```

注意此处 `memoryWorker` 变量在上方已定义（复用）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test --prefix gateway -- turn-pipeline`
Expected: PASS（新 2 例 + 既有 pipeline 相关用例）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/index.ts gateway/tests/unit/turn-pipeline-session.test.ts
git commit -m "feat(recall): TurnPipeline.runSession + compaction-triggered flush"
```

---

### Task 7: BudgetGuard（core/budget-guard.ts + index.ts 接线）

**Files:**
- Create: `gateway/src/core/budget-guard.ts`
- Modify: `gateway/src/index.ts`（guard map + handleOpencodeEvent step 消费 + buildNodeOptions onSessionCreated 挂载）
- Test: `gateway/tests/unit/core/budget-guard.test.ts`（新建）

**Interfaces:**
- Consumes: `EventFacets.step`、`TrajectoryStore.getSessionTokenSummary(sessionID).totalCost`
- Produces:
  - `class BudgetGuard { constructor(opts: BudgetGuardOpts); onStep(): void; detach(): void; readonly triggered: boolean }`
  - `BudgetGuardOpts { sessionID: string; maxTurns?: number; maxCostUsd?: number; getCostUsd(sessionID: string): number; abort(sessionID: string): Promise<void>; notify(sessionID: string, text: string): Promise<void>; log?(msg: string): void }`

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/core/budget-guard.test.ts`：

```ts
import { BudgetGuard } from '../../../src/core/budget-guard';

function makeGuard(over: Partial<any> = {}) {
  const calls = { abort: [] as string[], notify: [] as string[] };
  const guard = new BudgetGuard({
    sessionID: 's1',
    maxTurns: 3,
    getCostUsd: () => 0,
    abort: async (sid: string) => { calls.abort.push(sid); },
    notify: async (sid: string, text: string) => { calls.notify.push(text); },
    ...over,
  });
  return { guard, calls };
}

describe('BudgetGuard', () => {
  it('aborts and notifies when maxTurns exceeded', async () => {
    const { guard, calls } = makeGuard();
    guard.onStep(); guard.onStep();
    expect(calls.abort).toHaveLength(0);
    guard.onStep(); // 第 3 步触发
    await new Promise((r) => setImmediate(r));
    expect(calls.abort).toEqual(['s1']);
    expect(calls.notify[0]).toMatch(/maxTurns/);
    expect(guard.triggered).toBe(true);
  });

  it('aborts when maxCostUsd exceeded', async () => {
    let cost = 0;
    const { guard, calls } = makeGuard({ maxTurns: undefined, maxCostUsd: 0.01, getCostUsd: () => cost });
    guard.onStep();
    cost = 0.02;
    guard.onStep();
    await new Promise((r) => setImmediate(r));
    expect(calls.abort).toEqual(['s1']);
  });

  it('no budget configured → never triggers', () => {
    const { guard, calls } = makeGuard({ maxTurns: undefined, maxCostUsd: undefined });
    for (let i = 0; i < 10; i++) guard.onStep();
    expect(calls.abort).toHaveLength(0);
  });

  it('fires at most once; detach stops counting', async () => {
    const { guard, calls } = makeGuard({ maxTurns: 1 });
    guard.onStep();
    await new Promise((r) => setImmediate(r));
    guard.onStep(); guard.onStep();
    await new Promise((r) => setImmediate(r));
    expect(calls.abort).toHaveLength(1);
  });

  it('abort failure only logs (idempotent)', async () => {
    const { guard } = makeGuard({ maxTurns: 1, abort: async () => { throw new Error('already idle'); } });
    guard.onStep();
    await new Promise((r) => setImmediate(r));
    expect(guard.triggered).toBe(true); // 不抛
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- budget-guard`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 BudgetGuard**

`gateway/src/core/budget-guard.ts`：

```ts
/**
 * BudgetGuard —— 回合预算硬停（turnBudgetApi 缺位 runtime 的 gateway 侧兜底）。
 * 由调用方在会话每个已结算 step（EventFacets.step）喂 onStep()；
 * 超限 → abort + noReply 通知，自动 detonate（最多触发一次）。
 */
export interface BudgetGuardOpts {
  sessionID: string;
  maxTurns?: number;
  maxCostUsd?: number;
  getCostUsd(sessionID: string): number;
  abort(sessionID: string): Promise<void>;
  notify(sessionID: string, text: string): Promise<void>;
  log?(msg: string): void;
}

export class BudgetGuard {
  private turns = 0;
  private fired = false;
  private detached = false;

  constructor(private opts: BudgetGuardOpts) {}

  get triggered(): boolean { return this.fired; }

  onStep(): void {
    if (this.fired || this.detached) return;
    this.turns++;
    const { maxTurns, maxCostUsd } = this.opts;
    let reason: string | null = null;
    if (typeof maxTurns === 'number' && maxTurns > 0 && this.turns >= maxTurns) {
      reason = `maxTurns=${maxTurns}`;
    } else if (typeof maxCostUsd === 'number' && maxCostUsd > 0) {
      try {
        if (this.opts.getCostUsd(this.opts.sessionID) >= maxCostUsd) reason = `maxCostUsd=${maxCostUsd}`;
      } catch { /* 成本查询失败不阻断 */ }
    }
    if (!reason) return;
    this.fired = true;
    const sid = this.opts.sessionID;
    const log = this.opts.log ?? (() => {});
    log(`[BudgetGuard] ${sid} budget exceeded (${reason}) — aborting`);
    void (async () => {
      try { await this.opts.abort(sid); } catch (err: any) { log(`[BudgetGuard] abort failed (non-fatal): ${err?.message ?? err}`); }
      try {
        await this.opts.notify(sid, `[MAFW] 预算上限已触发（${reason}），会话已中止。调整预算后可重新发起。`);
      } catch (err: any) { log(`[BudgetGuard] notify failed (non-fatal): ${err?.message ?? err}`); }
    })();
  }

  detach(): void { this.detached = true; }
}
```

- [ ] **Step 4: index.ts 接线**

`index.ts`：
- 顶部 import 区加 `import { BudgetGuard } from './core/budget-guard';`
- 类字段加 `private budgetGuards = new Map<string, BudgetGuard>();`
- `handleOpencodeEvent` 的 step 消费块（`if (f.step && shouldConsiderStep(f.step))`）之后加：

```ts
    if (f.step && sessionID) {
      const guard = this.budgetGuards.get(sessionID);
      if (guard) {
        guard.onStep();
        if (guard.triggered) this.budgetGuards.delete(sessionID);
      }
    }
```

- `stop()` 中 `this.kernels?.disposeAll();` 附近加 `this.budgetGuards.clear();`
- 新增两个方法（放在 `runPipelineGuarded` 附近）：

```ts
  /** Goal 会话预算挂载：读 state/<goalId>.json 的 policySnapshot.{maxTurns,maxCostUsd}；
   *  两者都缺或 runtime 原生支持 turnBudgetApi 时不挂。 */
  private attachBudgetGuardForGoal(goalId: string, sessionID: string, mafwDir: string): void {
    try {
      if (!this.opencodeClient || this.runtimeCaps.turnBudgetApi) return;
      const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
      if (!fs.existsSync(statePath)) return;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const maxTurns = state?.policySnapshot?.maxTurns;
      const maxCostUsd = state?.policySnapshot?.maxCostUsd;
      if (typeof maxTurns !== 'number' && typeof maxCostUsd !== 'number') return;
      this.budgetGuards.set(sessionID, new BudgetGuard({
        sessionID,
        maxTurns,
        maxCostUsd,
        getCostUsd: (sid) => this.trajectoryStore?.getSessionTokenSummary(sid).totalCost ?? 0,
        abort: (sid) => this.opencodeClient!.session.abort({ sessionID: sid }),
        notify: (sid, text) =>
          this.opencodeClient!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], noReply: true }),
        log: (msg) => log.info(msg),
      }));
    } catch (err: any) {
      log.warn(`[BudgetGuard] attach failed for ${sessionID} (non-fatal): ${err.message}`);
    }
  }
```

- `buildNodeOptions` 的 `onSessionCreated` 回调内 `recordSessionInDb(...)` 之后加：

```ts
      const info2 = info; // attach budget from the goal's policySnapshot (if any)
      this.attachBudgetGuardForGoal(info2.goalId, info2.sessionId, mafwDir);
```

（`mafwDir` 是 buildNodeOptions 的参数，闭包可用。）

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test --prefix gateway -- budget-guard`
Expected: PASS（5 例）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/budget-guard.ts gateway/src/index.ts gateway/tests/unit/core/budget-guard.test.ts
git commit -m "feat(core): BudgetGuard turn/cost hard-stop for goal sessions"
```

---

### Task 8: HTTP 路由 + SDK（session-branch）

**Files:**
- Create: `gateway/src/routes/session-branch.ts`
- Modify: `gateway/src/index.ts`（路由注册）
- Modify: `packages/gateway-sdk/src/client.ts`（session 命名空间 + 3 方法）
- Test: `gateway/tests/unit/session-branch-route.test.ts`（新建）、`packages/gateway-sdk/src/client.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 契约、index.ts 现有 `capGuard(res, cap)` 模式
- Produces:
  - `POST /api/sessions/:id/fork {messageID?}` → 200 `{ session }` | 503
  - `POST /api/sessions/:id/revert {messageID, partID?}` → 200 `{}` | 503 | 400（缺 messageID）
  - `POST /api/sessions/:id/unrevert {}` → 200 `{}` | 503 | 404（runtime 无 unrevert）
  - SDK：`client.session.fork({ path: { id }, body?: { messageID? } })` / `revert` / `unrevert`

- [ ] **Step 1: 写失败测试（路由）**

`gateway/tests/unit/session-branch-route.test.ts`：

```ts
import { handleSessionBranch } from '../gateway/src/routes/session-branch';
import * as http from 'http';

function mockRes() {
  const res: any = {
    status: 0, body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req;
}

function depsWith(runtime: any) {
  return { getRuntime: () => runtime };
}

describe('session-branch routes', () => {
  it('503 when capability missing', async () => {
    const res = mockRes();
    const handled = await handleSessionBranch(mockReq('POST', {}), res, '/api/sessions/s1/fork', depsWith(null));
    expect(handled).toBe(true);
    expect((res as any).status).toBe(503);
  });

  it('fork proxies to runtime and returns session', async () => {
    const fork = jest.fn(async () => ({ id: 'ses_new' }));
    const res = mockRes();
    await handleSessionBranch(mockReq('POST', { messageID: 'm1' }), res, '/api/sessions/s1/fork',
      depsWith({ capabilities: { sessionBranchApi: true }, session: { fork } }));
    expect(fork).toHaveBeenCalledWith({ sessionID: 's1', messageID: 'm1' });
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ session: { id: 'ses_new' } });
  });

  it('revert requires messageID (400) and unrevert 404s when runtime lacks it', async () => {
    const rt = { capabilities: { sessionBranchApi: true }, session: { revert: jest.fn(async () => {}) } };
    const res400 = mockRes();
    await handleSessionBranch(mockReq('POST', {}), res400, '/api/sessions/s1/revert', depsWith(rt));
    expect((res400 as any).status).toBe(400);
    const res404 = mockRes();
    await handleSessionBranch(mockReq('POST', {}), res404, '/api/sessions/s1/unrevert', depsWith(rt));
    expect((res404 as any).status).toBe(404);
  });

  it('non-matching paths return handled=false', async () => {
    const res = mockRes();
    const handled = await handleSessionBranch(mockReq('GET'), res, '/api/sessions/s1/messages', depsWith(null));
    expect(handled).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- session-branch-route`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现路由**

`gateway/src/routes/session-branch.ts`：

```ts
import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';

export interface SessionBranchDeps {
  getRuntime(): AgentRuntime | null;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * 分支原语薄代理。能力门：runtime 未声明 sessionBranchApi → 503；
 * unrevert 是 opencode-only（pi 方法缺席）→ 404。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleSessionBranch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionBranchDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/sessions\/([^/]+)\/(fork|revert|unrevert)(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;
  const [, sessionID, action] = m;

  const rt = deps.getRuntime();
  if (!rt?.capabilities?.sessionBranchApi) {
    json(res, 503, { error: `capability 'sessionBranchApi' not available on runtime '${rt?.name ?? 'none'}'` });
    return true;
  }
  const body = await readBody(req);
  try {
    if (action === 'fork') {
      const session = await rt.session.fork!({ sessionID, messageID: body?.messageID });
      json(res, 200, { session });
    } else if (action === 'revert') {
      if (typeof body?.messageID !== 'string' || !body.messageID) {
        json(res, 400, { error: 'messageID required' });
        return true;
      }
      await rt.session.revert!({ sessionID, messageID: body.messageID, partID: body?.partID });
      json(res, 200, {});
    } else {
      if (typeof rt.session.unrevert !== 'function') {
        json(res, 404, { error: `runtime '${rt.name}' does not implement unrevert` });
        return true;
      }
      await rt.session.unrevert({ sessionID });
      json(res, 200, {});
    }
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
```

`index.ts` HTTP 分发处（其他 `handleModelConfig*` 风格路由注册点附近）加：

```ts
    {
      const { handleSessionBranch } = await import('./routes/session-branch.js');
      // 注：若分发链是同步 if/else，改为顶层静态 import 后在链中插入：
      // if (await handleSessionBranch(req, res, req.url ?? '', { getRuntime: () => this.opencodeClient })) return;
    }
```

实施时按 index.ts 现有分发结构（同步 if 链 or handler 表）原样插入，勿改结构。

- [ ] **Step 4: SDK 方法**

`packages/gateway-sdk/src/client.ts` `session` 命名空间 `abort` 之后加：

```ts
    fork: async (params: { path: { id: string }; body?: { messageID?: string } }): Promise<{ session: Session }> => {
      return this.request(`/api/sessions/${params.path.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body ?? {}),
      })
    },

    revert: async (params: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body),
      })
    },

    unrevert: async (params: { path: { id: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}/unrevert`, { method: 'POST' })
    },
```

`packages/gateway-sdk/src/client.test.ts` 追加一例（mock fetch 断言 URL/body，风格仿照该文件既有用例）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test --prefix gateway -- session-branch-route`；`cd packages/gateway-sdk && npm test`（或该包既有测试命令）
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/session-branch.ts gateway/src/index.ts packages/gateway-sdk/src/client.ts gateway/tests/unit/session-branch-route.test.ts packages/gateway-sdk/src/client.test.ts
git commit -m "feat(api): session fork/revert/unrevert proxy routes + SDK methods"
```

---

### Task 9: AGENTS.md 更新 + 全量回归

**Files:**
- Modify: `AGENTS.md`（§5.19 契约面段落 + §4.1 附近如涉及）

- [ ] **Step 1: 更新 AGENTS.md §5.19**

在"可选能力与接口扩展"列表追加：

```markdown
- `sessionBranchApi?: boolean` + `session.fork/revert/unrevert` — 会话分支原语；pi 不实现 unrevert，
  且 pi revert 不回滚文件（语义弱于 opencode，契约注释为准）
- `turnBudgetApi?: boolean` + `SessionPromptOpts.maxTurns/maxCostUsd` — 回合预算；未声明时 gateway
  BudgetGuard（core/budget-guard.ts）按 step 事件计数 + TrajectoryStore 成本兜底硬停
- `PromptResultEnvelope` — `session.prompt()` 返回超集（parts + finish/usage/error；字段缺失=undefined）
- EventFacets 新增 `compaction: 'start'|'end'|null`（opencode session.compacted→end；
  pi 经注入扩展上报 before/compact）；gateway 收到后对会话触发 turnCompress flush
```

- [ ] **Step 2: 全量回归 + 构建**

```bash
npm test --prefix gateway
npm run build
```

Expected: 全部测试 PASS；构建 exit 0。汇报新增测试数与全量通过数（用户偏好）。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md runtime contract P0 capabilities (branch/envelope/budget/compaction)"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §1 分支原语 → Task 1/2/3/8；§2 信封+预算 → Task 1/2/3/7；§3 compaction → Task 4/5/6；§4 错误语义/能力门 → Task 2/3/8 步骤内；§5 测试策略 → 各 Task 测试步骤 + Task 9 全量回归。无遗漏。
- **类型一致性**：`registry.fork(id, messageID?)` ↔ `sessionAPI.fork({sessionID, messageID})` ↔ 路由 `{sessionID, messageID}` 三层一致；`PromptResultEnvelope.usage.costUsd` 命名全程一致；`f.compaction` 值域 `'start'|'end'|null` 一致。
- **已知探针**（实施时注意，非占位符）：①pi `SessionManager.open()` 在 `createAgentSession({sessionManager})` 中的行为以 pi SDK 实测为准（单测用 fakeSession，接线代码有 fail-open）；②Task 6 测试的 turn 对象形状以 `completeTurns` 实际实现为准（步骤中已注明先读源码）。
