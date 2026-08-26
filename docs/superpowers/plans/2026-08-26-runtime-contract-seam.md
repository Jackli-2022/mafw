# Runtime 能力契约接缝（AgentRuntime Contract Seam）Implementation Plan

> **Status: COMPLETED** — 全部 7 个 Task 已完成（commits `e4af31b6`..`edc6acab`，2026-08-26）。
> 已知债务 1-4 已在 `2026-08-26-runtime-debt-remediation.md`（commit `5ca7d7df`）中清偿。
> 债务 5（pi-coding-agent runtime 插件）仍待实现。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 gateway 与 agent runtime 之间定义成"能力自声明契约 + 事件归一化层"，opencode 作为契约的恒等实现接进来——不接第二个 runtime，但所有接缝就位、行为完全不变。

**Architecture:** 新增 `gateway/src/runtime/` 模块：`contract.ts`（能力声明 + RuntimeClient 接口面）、`normalize.ts`（runtime 原生事件 → EventFacets 归一化）、`opencode-runtime.ts`（内置恒等实现）、`loader.ts`（`~/.mafw/runtime-plugins/` 插件加载器，模板复用 MediaPluginLoader）。`index.ts` 改为消费 EventFacets 和 capability 门；opencode 声明全能力（Tier 2），所以全部现有行为保留。

**Tech Stack:** TypeScript（gateway 编译为 CJS，tsc）、jest + ts-jest（测试根 `tests/`，moduleNameMapper 已剥离相对导入的 `.js` 后缀）。

## Global Constraints

- 本阶段**行为保持不变**：opencode 是唯一激活 runtime，所有既有测试必须通过；`npm run build`（根目录）为每个任务的门禁。
- 能力分级：Tier 0 = 协作协议 + per-turn 记忆；Tier 1 = + 自治执行 + per-step 记忆；Tier 2 = + 桌面完整（opencode 形状 DTO 归一化输出）。
- 不新增任何 npm 依赖。
- 测试文件放 `tests/unit/gateway/`，导入被测模块用 `../../../gateway/src/...`（**不带** `.js` 后缀）。
- gateway 源码静态导入**不带** `.js` 后缀（与 `import { config } from "./config"` 一致）；动态 `import()` 保持现有的 `.js` 后缀风格。
- **git commit 步骤默认挂起**：每个任务的 "Commit" 步骤需在执行前向用户确认后才执行（仓库策略：未经明确要求不做 git mutation）。
- 未来目标 runtime：pi-coding-agent（进程内嵌入，参照 `gateway/src/media/pi-adapter.ts` 的 ESM 动态导入桥）。本计划不含其实现。

---

### Task 1: Runtime 契约类型（contract.ts）

**Files:**
- Create: `gateway/src/runtime/contract.ts`
- Test: `tests/unit/gateway/runtime-contract.test.ts`

**Interfaces:**
- Consumes: 无（纯类型 + 两个工厂函数）
- Produces: `RuntimeCapabilities`、`fullCapabilities()`、`minimalCapabilities()`、`SessionCreateOpts`、`SessionPromptOpts`、`SessionMessagesOpts`、`SessionSummarizeOpts`、`RuntimeClient`、`AgentRuntime` —— Task 2/3/5/6 全部依赖这些名字。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/runtime-contract.test.ts
import { fullCapabilities, minimalCapabilities } from '../../../gateway/src/runtime/contract';

describe('runtime contract capabilities', () => {
  it('fullCapabilities enables every tier (opencode = Tier 2)', () => {
    expect(fullCapabilities()).toEqual({
      sessionApi: true,
      promptWhileBusy: true,
      eventStream: true,
      nativeApprovals: true,
      providerConfigApi: true,
      perLlmCallTransform: true,
    });
  });

  it('minimalCapabilities keeps only the Tier-0 session core', () => {
    expect(minimalCapabilities()).toEqual({
      sessionApi: true,
      promptWhileBusy: true,
      eventStream: false,
      nativeApprovals: false,
      providerConfigApi: false,
      perLlmCallTransform: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/runtime-contract.test.ts`
Expected: FAIL — `Cannot find module '../../../gateway/src/runtime/contract'`

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/runtime/contract.ts
/**
 * Runtime 能力契约 —— gateway 与 agent runtime（opencode / claude / pi ...）之间的接缝。
 *
 * 设计原则：能力自声明 + fail-open 降级。runtime 加载时声明 capabilities，
 * gateway 按能力集开关功能：
 *   Tier 0（sessionApi + promptWhileBusy）→ 协作协议（Goal/问答/反馈）+ per-turn 记忆
 *   Tier 1（+ eventStream）→ 自治执行（Goal plan/execute/review）+ per-step 记忆
 *   Tier 2（+ opencode 形状 DTO 归一化输出）→ 桌面聊天面完整
 * 降级是声明式的：缺能力的 runtime 只影响功能丰富度，永不阻塞 agent 基本工作。
 */

export interface RuntimeCapabilities {
  /** session.create/prompt/promptAsync/messages/... 全套会话 API */
  sessionApi: boolean;
  /** 可向会话追加消息（步进注入、wake 注入、Tier 0 的 recall 投递通道依赖） */
  promptWhileBusy: boolean;
  /** global.event() 全局事件流（步进注入/自动化触发器/桌面 SSE 依赖） */
  eventStream: boolean;
  /** runtime 原生 question/permission API（Approvals 透传依赖） */
  nativeApprovals: boolean;
  /** provider.list / app.agents / config.get|update（桌面设置页依赖） */
  providerConfigApi: boolean;
  /** 宿主插件提供 per-LLM-call messages transform（per-step recall；信息性声明，gateway 不直接消费） */
  perLlmCallTransform: boolean;
}

export function fullCapabilities(): RuntimeCapabilities {
  return {
    sessionApi: true,
    promptWhileBusy: true,
    eventStream: true,
    nativeApprovals: true,
    providerConfigApi: true,
    perLlmCallTransform: true,
  };
}

export function minimalCapabilities(): RuntimeCapabilities {
  return {
    sessionApi: true,
    promptWhileBusy: true,
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
  };
}

// ─── 会话接口面（与现 OpencodeAdapter 方法面 1:1 一致） ─────────────────────

export interface SessionCreateOpts {
  directory?: string;
}

export interface SessionPromptOpts {
  sessionID: string;
  parts?: Array<{ type: string; text: string; [k: string]: any }>;
  message?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  noReply?: boolean;
}

export interface SessionMessagesOpts {
  sessionID: string;
  limit?: number;
  before?: string;
}

export interface SessionSummarizeOpts {
  sessionID: string;
  providerID?: string;
  modelID?: string;
}

export interface RuntimeClient {
  session: {
    create(opts: SessionCreateOpts): Promise<{ id: string; [k: string]: any }>;
    promptAsync(opts: SessionPromptOpts): Promise<void>;
    prompt(opts: SessionPromptOpts): Promise<{ parts: any[]; [k: string]: any }>;
    messages(opts: SessionMessagesOpts): Promise<{ data: any[]; nextCursor?: string }>;
    get(opts: { sessionID: string }): Promise<any>;
    delete(opts: { sessionID: string }): Promise<void>;
    abort(opts: { sessionID: string }): Promise<void>;
    list(opts?: { directory?: string }): Promise<any[]>;
    todo(opts: { sessionID: string }): Promise<any[]>;
    children(opts: { sessionID: string }): Promise<any[]>;
    summarize(opts: SessionSummarizeOpts): Promise<any>;
  };
  global: {
    event(): Promise<any>;
  };
  provider: {
    list(): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }>;
  };
  app: {
    agents(): Promise<any[]>;
  };
  config: {
    get(): Promise<any>;
    update(config: any): Promise<any>;
  };
}

export interface AgentRuntime extends RuntimeClient {
  /** runtime 标识，如 'opencode' */
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;
  /** true = 外部托管（gateway 不 spawn/监管 serve 进程）。信息性字段，一期不接线。 */
  readonly external?: boolean;
  /** 健康探测（watchdog / adopt 判定用）；缺省时由调用方自管。 */
  healthCheck?(): Promise<boolean>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/runtime-contract.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add gateway/src/runtime/contract.ts tests/unit/gateway/runtime-contract.test.ts
git commit -m "feat(runtime): add AgentRuntime capability contract"
```

---

### Task 2: 事件归一化器（normalize.ts）

**Files:**
- Create: `gateway/src/runtime/normalize.ts`
- Test: `tests/unit/gateway/runtime-normalize.test.ts`

**Interfaces:**
- Consumes: `stepPropsFromPartUpdated`、`stepPropsFromMessageUpdated`、`StepEndedProps`（来自 `gateway/src/recall/step-inject.ts`，均已导出）
- Produces: `RawRuntimeEvent`、`EventFacets`、`normalizeOpencodeEvent(evt)` —— Task 4 的 `handleOpencodeEvent` 重写只消费这三个。

**背景（为什么 facets 不是互斥枚举）：** 现 `handleOpencodeEvent`（`index.ts:701-793`）对同一事件有多路消费——`message.updated` 既参与 step 归一化（`stepPropsFromMessageUpdated`）又触发 `chatSessions.pushComplete`；`message.part.updated` 既可能是 step-finish（step 归一化）又可能携带 text delta（chat 转发）。所以归一化输出是正交 facets 而非互斥 kind，保证行为逐点等价。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/runtime-normalize.test.ts
import { normalizeOpencodeEvent } from '../../../gateway/src/runtime/normalize';

describe('normalizeOpencodeEvent', () => {
  it('unwraps GlobalEvent envelope and classifies session.idle', () => {
    const f = normalizeOpencodeEvent({
      directory: '/proj',
      payload: { type: 'session.idle', properties: { sessionID: 's1' } },
    });
    expect(f.type).toBe('session.idle');
    expect(f.sessionID).toBe('s1');
    expect(f.directory).toBe('/proj');
    expect(f.broadcast).toBe('idle');
    expect(f.chatSignal).toBe('complete');
    expect(f.step).toBeNull();
    expect(f.toolCommand).toBeUndefined();
  });

  it('classifies step-finish part as settled step', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'message.part.updated',
        properties: { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } },
      },
    });
    expect(f.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
    expect(f.chatSignal).toBeNull();
  });

  it('classifies completed assistant message as settled step + complete signal', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { completed: 123 }, finish: 'stop' } },
      },
    });
    expect(f.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
    expect(f.chatSignal).toBe('complete');
  });

  it('ignores in-flight assistant message (no time.completed)', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: {} } } },
    });
    expect(f.step).toBeNull();
  });

  it('extracts delta text from text part updates', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } },
    });
    expect(f.chatSignal).toBe('delta');
    expect(f.deltaText).toBe('hello');
    expect(f.step).toBeNull();
  });

  it('classifies session.error', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.error', properties: { sessionID: 's1', error: { message: 'boom' } } },
    });
    expect(f.broadcast).toBe('error');
    expect(f.chatSignal).toBe('error');
    expect(f.chatError).toEqual({ message: 'boom' });
  });

  it('extracts tool command only from tool-type events', () => {
    const toolEvt = normalizeOpencodeEvent({
      payload: { type: 'session.next.tool.finished', properties: { sessionID: 's1', tool: 'bash', args: { command: 'echo hi' } } },
    });
    expect(toolEvt.toolCommand).toBe('echo hi');

    const idle = normalizeOpencodeEvent({
      payload: { type: 'session.idle', properties: { sessionID: 's1', args: { command: 'echo hi' } } },
    });
    expect(idle.toolCommand).toBeUndefined();
  });

  it('falls back to bare event shape (no payload envelope) and passthrough for unknown types', () => {
    const f = normalizeOpencodeEvent({ type: 'custom.thing', properties: { sessionID: 's9' } });
    expect(f.type).toBe('custom.thing');
    expect(f.sessionID).toBe('s9');
    expect(f.broadcast).toBe('passthrough');
    expect(f.chatSignal).toBeNull();
    expect(f.step).toBeNull();
  });

  it('sessionID falls back through part/info/payload paths', () => {
    const viaPart = normalizeOpencodeEvent({
      payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 'via-part' } } },
    });
    expect(viaPart.sessionID).toBe('via-part');
    const viaInfo = normalizeOpencodeEvent({
      payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 'via-info', time: {} } } },
    });
    expect(viaInfo.sessionID).toBe('via-info');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/runtime-normalize.test.ts`
Expected: FAIL — `Cannot find module '../../../gateway/src/runtime/normalize'`

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/runtime/normalize.ts
/**
 * 事件归一化器 —— 把 runtime 原生事件翻译成 EventFacets（正交切面）。
 *
 * 每个 runtime 一个 normalize 函数；index.ts 的调度逻辑只消费 facets，
 * 不再出现 runtime 事件类型字符串。opencode 版本知识（≥1.18 无
 * session.next.step.ended，step 以 step-finish part 结算）只存在于本文件
 * 和 step-inject.ts 的两个 helper 里。
 *
 * 注意：facets 是正交的（一个事件可同时有 step 与 chatSignal），这是为了
 * 与现 handleOpencodeEvent 的多路消费行为逐点等价。
 */
import {
  stepPropsFromPartUpdated,
  stepPropsFromMessageUpdated,
  StepEndedProps,
} from '../recall/step-inject';

/** GlobalEvent 信封或裸事件，两者都接受。 */
export interface RawRuntimeEvent {
  directory?: string;
  payload?: { type?: string; properties?: any; sessionID?: string };
  type?: string;
  properties?: any;
  sessionID?: string;
}

export interface EventFacets {
  /** 原始 runtime 事件类型（透传，用于 trajectory/broadcast） */
  type: string;
  /** 原始 properties（透传） */
  properties: any;
  sessionID?: string;
  directory?: string;
  /** 非 null = 此事件标志一个已结算的 LLM step（喂 step-inject） */
  step: StepEndedProps | null;
  /** chat 转发信号（per-session SSE Mode B） */
  chatSignal: 'delta' | 'complete' | 'error' | null;
  deltaText?: string;
  chatError?: unknown;
  /** 全局广播形态（Mode A，桌面 renderer） */
  broadcast: 'idle' | 'error' | 'passthrough';
  /** 工具事件携带的 shell command（自更新调用者定位用） */
  toolCommand?: string;
}

export function normalizeOpencodeEvent(evt: RawRuntimeEvent): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;

  // settled-step 归一化：legacy step.ended（保留兜底）→ step-finish part →
  // completed assistant message，与现 handleOpencodeEvent 的判定顺序一致。
  let step: StepEndedProps | null = null;
  if (type === 'session.next.step.ended' && sessionID) {
    step = { sessionID, assistantMessageID: props?.assistantMessageID, finish: props?.finish };
  } else if (type === 'message.part.updated') {
    step = stepPropsFromPartUpdated(props);
  } else if (type === 'message.updated') {
    step = stepPropsFromMessageUpdated(props);
  }

  let chatSignal: EventFacets['chatSignal'] = null;
  let deltaText: string | undefined;
  let chatError: unknown;
  if (type === 'message.part.updated') {
    const text = props?.part?.text || props?.delta || '';
    if (text) {
      deltaText = text;
      chatSignal = 'delta';
    }
  } else if (type === 'session.idle' || type === 'message.updated') {
    chatSignal = 'complete';
  } else if (type === 'session.error' || type === 'message.error') {
    chatSignal = 'error';
    chatError = props?.error || 'Unknown error';
  }

  const broadcast: EventFacets['broadcast'] =
    type === 'session.idle' ? 'idle' : type === 'session.error' ? 'error' : 'passthrough';

  // 自更新调用者定位：仅工具事件携带 command 时提取。
  // （'session.next.tool' 已包含 'tool' 子串，includes('tool') 一条即覆盖，
  //  与现 `(type.includes('tool') || type.includes('session.next.tool'))` 等价。）
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;

  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, broadcast, toolCommand };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/runtime-normalize.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add gateway/src/runtime/normalize.ts tests/unit/gateway/runtime-normalize.test.ts
git commit -m "feat(runtime): add event normalizer producing EventFacets"
```

---

### Task 3: opencode 恒等实现 + 类型单源化

**Files:**
- Create: `gateway/src/runtime/opencode-runtime.ts`
- Modify: `gateway/src/opencode-adapter.ts:11-67`（删除本地接口，单源到 contract）
- Test: `tests/unit/gateway/opencode-runtime.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime`、`RuntimeClient`、`fullCapabilities`（Task 1）；`createOpencodeAdapter`（现有）
- Produces: `createOpencodeRuntime(config): Promise<AgentRuntime>` —— Task 6 的 `createRuntime` 回退路径调用；`OpencodeAdapter` 变为 `RuntimeClient` 的别名（下游导入零改动）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/opencode-runtime.test.ts
jest.mock('../../../gateway/src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({ __clientMarker: true })),
}));

import { createOpencodeRuntime } from '../../../gateway/src/runtime/opencode-runtime';

describe('createOpencodeRuntime', () => {
  const saved = process.env.MAFW_SERVER_SERVE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.MAFW_SERVER_SERVE_URL;
    else process.env.MAFW_SERVER_SERVE_URL = saved;
  });

  it('declares opencode identity + full capabilities, preserving the client surface', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.name).toBe('opencode');
    expect(rt.capabilities).toEqual({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: true, providerConfigApi: true, perLlmCallTransform: true,
    });
    expect(rt.external).toBe(false);
    // 装饰不覆盖 adapter 返回的 client 方法面
    expect((rt as any).__clientMarker).toBe(true);
  });

  it('marks external when MAFW_SERVER_SERVE_URL is set', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999' });
    expect(rt.external).toBe(true);
  });

  it('healthCheck resolves false when serve is unreachable', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
    await expect(rt.healthCheck!()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/opencode-runtime.test.ts`
Expected: FAIL — `Cannot find module '../../../gateway/src/runtime/opencode-runtime'`

- [ ] **Step 3: Write opencode-runtime.ts**

```ts
// gateway/src/runtime/opencode-runtime.ts
/**
 * 内置 opencode runtime —— 契约的"恒等实现"：能力全满（Tier 2），
 * 其事件/消息形状即归一化的目标形状。新 runtime 插件以本文件为参照。
 */
import { AgentRuntime, fullCapabilities } from './contract';
import { createOpencodeAdapter } from '../opencode-adapter';

export interface OpencodeRuntimeConfig {
  baseUrl: string;
  directory?: string;
  headers?: Record<string, string>;
}

export async function createOpencodeRuntime(config: OpencodeRuntimeConfig): Promise<AgentRuntime> {
  const client = await createOpencodeAdapter(config);
  return Object.assign(client, {
    name: 'opencode' as const,
    capabilities: fullCapabilities(),
    /** MAFW_SERVER_SERVE_URL 指向外部 serve 时 gateway 不监管进程（信息性，一期不接线）。 */
    external: !!process.env.MAFW_SERVER_SERVE_URL,
    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${config.baseUrl}/global/health`, {
          headers: config.headers,
          signal: AbortSignal.timeout(3000),
        } as any);
        return res.ok;
      } catch {
        return false;
      }
    },
  });
}
```

- [ ] **Step 4: 单源化 opencode-adapter.ts 的类型**

在 `gateway/src/opencode-adapter.ts` 中，**删除**第 11-67 行（`SessionCreateOpts` / `SessionPromptOpts` / `SessionMessagesOpts` / `SessionSummarizeOpts` / `OpencodeAdapter` 五个本地定义），替换为：

```ts
// ─── 接口定义（单源在 runtime/contract.ts，此处仅转发保持兼容） ─────────────

import type { RuntimeClient } from './runtime/contract';
export type {
  SessionCreateOpts,
  SessionPromptOpts,
  SessionMessagesOpts,
  SessionSummarizeOpts,
} from './runtime/contract';

/** @deprecated 等价于 RuntimeClient；保留别名避免下游改动。 */
export type OpencodeAdapter = RuntimeClient;
```

文件其余部分（`unwrap`、`messageToParts`、`createOpencodeAdapter`）保持不变。注意原文件顶部注释块（第 1-9 行）保留。

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/gateway/opencode-runtime.test.ts tests/unit/gateway/runtime-contract.test.ts`
Expected: PASS

- [ ] **Step 6: Build gate + 全量单测**

Run: `npm run build`，然后 `npm run test:unit`
Expected: build exit 0；既有单测全绿（类型单源化是纯类型操作，不应有任何行为变化）

- [ ] **Step 7: Commit（需用户确认）**

```bash
git add gateway/src/runtime/opencode-runtime.ts gateway/src/opencode-adapter.ts tests/unit/gateway/opencode-runtime.test.ts
git commit -m "refactor(runtime): make opencode the identity AgentRuntime implementation"
```

---

### Task 4: index.ts 消费 facets + 能力门

**Files:**
- Modify: `gateway/src/index.ts`（6 处编辑，逐条列出）

**Interfaces:**
- Consumes: `normalizeOpencodeEvent`（Task 2）、`RuntimeCapabilities`、`fullCapabilities`（Task 1）
- Produces: `this.runtimeCaps` / `this.runtimeName` / `this.capGuard()` —— Task 5/6 依赖。

**编辑 1 —— 导入（文件顶部，`import { config } from "./config";` 附近）：**

```ts
import { normalizeOpencodeEvent } from './runtime/normalize';
import { RuntimeCapabilities, fullCapabilities } from './runtime/contract';
```

同时把 step-inject 导入块（index.ts:57-63）中不再使用的 `stepPropsFromPartUpdated`、`stepPropsFromMessageUpdated` 两个名字删除（逻辑已移入 normalize.ts），保留 `shouldConsiderStep`、`selectMemories`、`memoryFingerprint`、`defaultStepInjectOptions`。

**编辑 2 —— 字段（index.ts:230 `private opencodeClient: any = null;` 之后插入）：**

```ts
  private runtimeCaps: RuntimeCapabilities = fullCapabilities();
  private runtimeName = 'opencode';
```

（`opencodeClient` 的 `any` 类型本期不动——见"已知债务"。）

**编辑 3 —— subscribeToEvents 能力门（index.ts:676 函数体开头，`try {` 之前插入）：**

```ts
    if (!this.runtimeCaps.eventStream) {
      log.info(`[Scheduler] runtime '${this.runtimeName}' declares no event stream; skipping subscription`);
      return;
    }
```

**编辑 4 —— handleOpencodeEvent 整体替换（index.ts:701-793）：**

```ts
  private handleOpencodeEvent(evt: any): void {
    const f = normalizeOpencodeEvent(evt);
    const { type, properties: props, sessionID } = f;
    log.info(`[SSE] ${this.runtimeName} event: ${type} sessionID=${sessionID}`);

    // Caller-location bookkeeping for self-update: every event refreshes the
    // session's last-active stamp; tool events carrying a shell command that
    // touches the restart token file pin the exact session that wrote it.
    if (sessionID) {
      this.lastActiveBySession.set(sessionID, Date.now());
      if (f.toolCommand) {
        if (/pending-restart/i.test(f.toolCommand)) {
          this.tokenWriterSession = { sessionID, at: Date.now() };
        }
        this.lastWriteBySession.set(sessionID, { at: Date.now(), command: f.toolCommand });
      }
    }

    // Path T: trajectory accumulation — writes SQLite + broadcasts trajectory.event/trajectory.turn
    try {
      const collector = this.trajectoryCollector;
      if (collector) {
        const trajEvt = collector.handleEvent(type, props, f.directory);
        if (trajEvt) {
          this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.event', properties: trajEvt, sessionID } });
        }
      }
    } catch (err: any) {
      log.warn(`[Trajectory] handle failed (non-fatal): ${err.message}`);
    }

    // Path 1: settled LLM step → evaluate high-salience memory injection.
    if (f.step && shouldConsiderStep(f.step) && this.stepInject.markStepSeen(f.step.sessionID, f.step.assistantMessageID)) {
      void this.evaluateStepInjection(f.step.sessionID, f.step.assistantMessageID)
    }

    // Per-session SSE (Mode B) forwarding
    if (sessionID && this.chatSessions.hasListeners(sessionID)) {
      if (f.chatSignal === 'delta' && f.deltaText) {
        this.chatSessions.pushDelta(sessionID, f.deltaText);
      } else if (f.chatSignal === 'complete') {
        this.chatSessions.pushComplete(sessionID);
      } else if (f.chatSignal === 'error') {
        this.chatSessions.pushError(sessionID, f.chatError);
      }
    }

    // Global broadcast (Mode A — used by the desktop renderer).
    // Normalize to the renderer's contract: { type, properties, sessionID }.
    if (f.broadcast === 'idle') {
      // Path 1: turn fully settled → drain any queued memory injection
      // (delayed to idle so we never collide with the finishing drain).
      if (sessionID) void this.drainStepInjections(sessionID);
      try {
        if (this.trajectoryCollector) {
          const turn = this.trajectoryCollector.onIdle(sessionID);
          if (turn) {
            this.broadcast({ type: 'opencode_event', data: { type: 'trajectory.turn', properties: turn, sessionID } });
          }
        }
      } catch (err: any) {
        log.warn(`[Trajectory] idle aggregation failed (non-fatal): ${err.message}`);
      }
      this.broadcast({ type: 'opencode_event', data: { type: 'message.complete', sessionID } });
    } else if (f.broadcast === 'error') {
      this.broadcast({ type: 'opencode_event', data: { type: 'message.error', sessionID, error: props?.error } });
    } else {
      this.broadcast({ type: 'opencode_event', data: { type, properties: props, sessionID } });
    }
  }
```

行为等价性核对（执行者必须逐条比对旧代码确认）：
- `stepProps` IIFE → `f.step`（判定逻辑同一套 helper，顺序一致）
- `type.includes('tool') || type.includes('session.next.tool')` → `type.includes('tool')`（后者是前者的子串条件，等价）
- chatSessions delta：`text` 非空才 pushDelta → normalize 只在 text 非空时给 `chatSignal: 'delta'`，等价
- pushError 的 `props?.error || 'Unknown error'` → `f.chatError`，等价

**编辑 5 —— capGuard 辅助方法（放在 handleOpencodeEvent 之后）：**

```ts
  /** 能力门：runtime 未声明该能力时以 503 显式拒绝（fail-open 的声明式降级）。 */
  private capGuard(res: http.ServerResponse, cap: keyof RuntimeCapabilities): boolean {
    if (this.runtimeCaps[cap]) return false;
    res.writeHead(503);
    res.end(JSON.stringify({ error: `capability '${String(cap)}' not available on runtime '${this.runtimeName}'` }));
    return true;
  }
```

**编辑 6 —— 端点接门（在各自路由匹配的 `try {` 之前插入一行）：**

| 路由锚点（regex 匹配行） | 插入 |
|---|---|
| `if (req.url?.match(/^\/api\/provider(?:\?|$)/) && req.method === 'GET') {` | `if (this.capGuard(res, 'providerConfigApi')) return;` |
| `if (req.url?.match(/^\/api\/agents(?:\?|$)/) && req.method === 'GET') {` | `if (this.capGuard(res, 'providerConfigApi')) return;` |
| `/api/opencode-config` GET（`req.method === 'GET'`） | `if (this.capGuard(res, 'providerConfigApi')) return;` |
| `/api/opencode-config` PATCH（`req.method === 'PATCH'`） | `if (this.capGuard(res, 'providerConfigApi')) return;` |
| `/api/questions` 系列（GET、reply、reject 共 3 处，`/^\/api\/questions/`） | `if (this.capGuard(res, 'nativeApprovals')) return;` |
| `/api/permissions` 系列（GET、reply 共 2 处，`/^\/api\/permissions/`） | `if (this.capGuard(res, 'nativeApprovals')) return;` |

- [ ] **Step 1: 应用编辑 1-6**

无新单测（行为保持重构）；逐条核对上面的等价性清单。

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: exit 0。若 `stepPropsFromPartUpdated` 等残留引用导致编译错误，说明编辑 1 的导入清理不彻底，修复后重跑。

- [ ] **Step 3: 全量单测**

Run: `npm run test:unit`
Expected: 全绿

- [ ] **Step 4: 冒烟核对（人工/半自动）**

启动 gateway（`npm start` 或 `mafw start`），向 opencode 会话发一条消息，在 `~/.mafw/logs/mafw.log` 确认：
1. `[SSE] opencode event:` 日志行照常出现（事件流未断）
2. `GET http://127.0.0.1:3000/api/provider` 返回 200 + `{"items":...}`（能力门不误伤 opencode）
3. 会话 idle 后桌面/SSE 收到 `message.complete` 广播

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add gateway/src/index.ts
git commit -m "refactor(runtime): consume EventFacets and gate endpoints by capabilities"
```

---

### Task 5: RuntimePluginLoader + /api/runtime

**Files:**
- Create: `gateway/src/runtime/loader.ts`
- Modify: `gateway/src/index.ts`（新增 `/api/runtime` 路由 + 字段）
- Test: `tests/unit/gateway/runtime-loader.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime`、`RuntimeCapabilities`、`minimalCapabilities`（Task 1）；`config`（gateway/src/config.ts 单例）
- Produces: `RuntimePluginLoader`（`init()`/`scan()`/`get(name)`/`getState()`）、`createRuntimePluginContext()`、`RuntimePluginContext`、`RuntimePluginState` —— Task 6 的 `createRuntime` 依赖。

**设计要点：** 模板复用 `MediaPluginLoader`（`gateway/src/media/media-plugin-loader.ts`），但**去掉 fs.watch 热加载**——runtime 热切换危险（事件流/sidecar 都建在 runtime 之上），重启生效即可。能力合并策略：插件声明的 capabilities 覆盖在 `minimalCapabilities()` 之上（Tier 0 是会话 runtime 的最低可用基线）。`external` 默认 true（gateway 永不 spawn 插件 runtime 的进程）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/runtime-loader.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RuntimePluginLoader } from '../../../gateway/src/runtime/loader';

describe('RuntimePluginLoader', () => {
  let dir: string;
  let loader: RuntimePluginLoader;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-plugins-'));
    loader = new RuntimePluginLoader(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates plugins dir with README and disabled example on init', async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await loader.init();
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'example.js.disabled'))).toBe(true);
  });

  it('loads a valid plugin, merging capabilities over minimal defaults', async () => {
    fs.writeFileSync(path.join(dir, 'my.js'), `module.exports = {
      name: 'my-runtime',
      capabilities: { eventStream: true },
      async createRuntime(ctx) { return { name: 'my-runtime' }; },
    };`);
    await loader.init();
    const p = loader.get('my-runtime');
    expect(p).toBeDefined();
    expect(p!.capabilities).toEqual({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: false, providerConfigApi: false, perLlmCallTransform: false,
    });
    expect(p!.external).toBe(true);
    expect(loader.getState()).toEqual([
      expect.objectContaining({ file: 'my.js', name: 'my-runtime', status: 'ok' }),
    ]);
  });

  it('rejects plugins without name or createRuntime, keeping good ones (fail-open per file)', async () => {
    fs.writeFileSync(path.join(dir, 'bad1.js'), `module.exports = { async createRuntime() { return {}; } };`);
    fs.writeFileSync(path.join(dir, 'bad2.js'), `module.exports = { name: 'x' };`);
    fs.writeFileSync(path.join(dir, 'good.js'), `module.exports = { name: 'good', async createRuntime() { return {}; } };`);
    await loader.init();
    expect(loader.get('good')).toBeDefined();
    const state = loader.getState();
    expect(state.find(s => s.file === 'bad1.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'missing name' }));
    expect(state.find(s => s.file === 'bad2.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'missing createRuntime(ctx)' }));
  });

  it('survives a plugin that throws at require time', async () => {
    fs.writeFileSync(path.join(dir, 'boom.js'), `throw new Error('nope');`);
    await loader.init();
    expect(loader.getState()[0]).toEqual(
      expect.objectContaining({ file: 'boom.js', status: 'error', error: 'nope' }));
  });

  it('duplicate names: first file wins, second recorded as error', async () => {
    fs.writeFileSync(path.join(dir, 'a.js'), `module.exports = { name: 'dup', async createRuntime() { return {}; } };`);
    fs.writeFileSync(path.join(dir, 'b.js'), `module.exports = { name: 'dup', async createRuntime() { return {}; } };`);
    await loader.init();
    expect(loader.get('dup')).toBeDefined();
    expect(loader.getState().find(s => s.file === 'b.js')).toEqual(
      expect.objectContaining({ status: 'error', error: 'duplicate name' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/runtime-loader.test.ts`
Expected: FAIL — `Cannot find module '../../../gateway/src/runtime/loader'`

- [ ] **Step 3: Write loader.ts**

```ts
// gateway/src/runtime/loader.ts
/**
 * Runtime 插件加载器 —— 扫描 ~/.mafw/runtime-plugins/*.js，校验契约形状，
 * fail-open（单个文件失败不影响其他插件与内置 opencode）。
 *
 * 模板复用 MediaPluginLoader，但刻意去掉热加载：runtime 热切换危险
 * （事件流/sidecar 建立在 runtime 之上），重启生效即可。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { config } from '../config';
import { AgentRuntime, RuntimeCapabilities, minimalCapabilities } from './contract';

export interface RuntimePluginContext {
  /** fetch with 60s default timeout */
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  /** 读 config.yaml 的 runtime.pluginConfig[name] */
  pluginConfig(name: string): Record<string, any>;
}

export type RuntimeFactory = (ctx: RuntimePluginContext) => Promise<AgentRuntime>;

export interface RuntimePluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  capabilities?: RuntimeCapabilities;
}

export class RuntimePluginLoader {
  private factories = new Map<string, RuntimeFactory>();
  private meta = new Map<string, { capabilities: RuntimeCapabilities; external: boolean }>();
  private state = new Map<string, RuntimePluginState>();

  constructor(private pluginsDir: string) {}

  async init(): Promise<void> {
    this.ensureDir();
    await this.scan();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
      fs.writeFileSync(path.join(this.pluginsDir, 'example.js.disabled'), EXAMPLE_CONTENT);
      log.info(`[RuntimePluginLoader] Created ${this.pluginsDir}`);
    }
  }

  async scan(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loadedNames = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loadedNames);
      seen.add(file);
    }
    for (const [file] of this.state) {
      if (!seen.has(file)) {
        const prev = this.state.get(file);
        if (prev?.name) {
          this.factories.delete(prev.name);
          this.meta.delete(prev.name);
        }
        this.state.delete(file);
      }
    }
  }

  private async loadFile(file: string, loadedNames: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try {
      const cacheKey = require.resolve(fullPath);
      delete require.cache[cacheKey];
    } catch { /* first load */ }

    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') {
        this.state.set(file, { file, status: 'error', error: 'missing name' });
        return;
      }
      if (typeof mod.createRuntime !== 'function') {
        this.state.set(file, { file, name, status: 'error', error: 'missing createRuntime(ctx)' });
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name' });
        log.warn(`[RuntimePluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }
      // 能力合并：插件声明覆盖在 Tier-0 基线之上
      const capabilities: RuntimeCapabilities = { ...minimalCapabilities(), ...(mod.capabilities || {}) };
      // 插件 runtime 一律视为外部托管（gateway 不 spawn/监管其进程）
      const external = mod.external !== false;
      this.factories.set(name, mod.createRuntime);
      this.meta.set(name, { capabilities, external });
      this.state.set(file, { file, name, status: 'ok', capabilities });
      loadedNames.add(name);
      log.info(`[RuntimePluginLoader] Loaded ${file} (${name})`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, { file, name: prev?.name, status: 'error', error: err.message });
      log.warn(`[RuntimePluginLoader] ${file} load error: ${err.message}`);
    }
  }

  /** 插件不存在或未通过校验时返回 undefined（调用方回退内置 opencode）。 */
  get(name: string): { createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } | undefined {
    const createRuntime = this.factories.get(name);
    const meta = this.meta.get(name);
    if (!createRuntime || !meta) return undefined;
    return { createRuntime, ...meta };
  }

  getState(): RuntimePluginState[] {
    return [...this.state.values()];
  }
}

export function createRuntimePluginContext(): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
  };
}

const README_CONTENT = `# Runtime Plugins

Place \`.js\` files here to plug a new agent runtime into the MAFW gateway.
Activate with config.yaml:

\`\`\`yaml
runtime:
  plugin: my-runtime        # matches module.exports.name
  pluginConfig: {}          # per-plugin config, read via ctx.pluginConfig(name)
\`\`\`

Or env: \`MAFW_RUNTIME_PLUGIN=my-runtime\`. Unknown/failed plugins fall back
to the builtin opencode runtime (fail-open).

## Plugin shape (CJS)

\`\`\`js
module.exports = {
  name: "my-runtime",
  // merged over Tier-0 defaults (sessionApi + promptWhileBusy already true)
  capabilities: {
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
  },
  external: true,             // gateway never spawns plugin runtime processes
  async createRuntime(ctx) {
    // ctx.fetch / ctx.log / ctx.pluginConfig(name)
    return {
      name: "my-runtime",
      capabilities: { /* same object as above */ },
      session: {
        async create(opts) { /* {directory?} → {id} */ },
        async promptAsync(opts) { /* {sessionID, parts|message, ...} → void */ },
        async prompt(opts) { /* → {parts, ...} */ },
        async messages(opts) { /* {sessionID, limit?, before?} → {data, nextCursor?} */ },
        async get({ sessionID }) {},
        async delete({ sessionID }) {},
        async abort({ sessionID }) {},
        async list(opts) { return []; },
        async todo({ sessionID }) { return []; },
        async children({ sessionID }) { return []; },
        async summarize(opts) {},
      },
      global: { async event() { /* → {stream: AsyncIterable} */ } },
      provider: { async list() { return { all: [], connected: [], default: {} }; } },
      app: { async agents() { return []; } },
      config: { async get() { return {}; }, async update(c) { return c; } },
      async healthCheck() { return true; },
    };
  },
};
\`\`\`

Capabilities declared here gate gateway features declaratively: missing
capabilities disable the corresponding features (503 on gated endpoints,
skipped event subscription) — they never crash.
`;

const EXAMPLE_CONTENT = `// Rename to example.js to activate
module.exports = {
  name: "example",
  capabilities: { eventStream: false },
  async createRuntime(ctx) {
    ctx.log.info("[example-runtime] created");
    throw new Error("example plugin: implement createRuntime before activating");
  },
};
`;
```

**编辑 index.ts —— 字段（Task 4 编辑 2 的位置之后）：**

```ts
  private runtimeLoader?: RuntimePluginLoader;
```

**编辑 index.ts —— 导入：**

```ts
import { RuntimePluginLoader } from './runtime/loader';
```

**编辑 index.ts —— 路由（紧跟 `/api/provider` 路由块之后插入）：**

```ts
        // GET /api/runtime — active runtime identity + capabilities + plugin scan state
        if (req.url?.match(/^\/api\/runtime(?:\?|$)/) && req.method === 'GET') {
          res.end(JSON.stringify({
            active: { name: this.runtimeName, capabilities: this.runtimeCaps },
            plugins: this.runtimeLoader?.getState() ?? [],
          }));
          return;
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/runtime-loader.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add gateway/src/runtime/loader.ts gateway/src/index.ts tests/unit/gateway/runtime-loader.test.ts
git commit -m "feat(runtime): add runtime plugin loader and /api/runtime endpoint"
```

---

### Task 6: config 段 + start() 接线

**Files:**
- Modify: `gateway/src/config.ts`（3 处：interface、defaults、accessor）
- Modify: `gateway/src/index.ts`（start() 内接线 + createRuntime 方法）

**Interfaces:**
- Consumes: `RuntimePluginLoader`/`createRuntimePluginContext`（Task 5）、`createOpencodeRuntime`（Task 3）、`AgentRuntime`（Task 1）
- Produces: `config.runtime`（`{ plugin?: string; pluginConfig?: Record<string, any> }`）；`this.createRuntime(sdkConfig)` 私有方法。

- [ ] **Step 1: config.ts 编辑**

**编辑 1 —— `GatewayConfig` 接口（`media: {...};` 段结束之后、`alignment:` 之前，约 config.ts:170）：**

```ts
  runtime: {
    /** 激活的 runtime 插件名（~/.mafw/runtime-plugins/*.js 的 module.exports.name）；空 = 内置 opencode。 */
    plugin?: string;
    /** 插件自定义配置，按插件名索引（ctx.pluginConfig(name) 读取）。 */
    pluginConfig?: Record<string, any>;
  };
```

**编辑 2 —— `defaults()`（`media: {...},` 块结束之后、`env:` 之前，约 config.ts:335）：**

```ts
    runtime: {
      // 空串默认值让 MAFW_RUNTIME_PLUGIN 环境变量覆盖生效
      // （applyEnvOverrides 只遍历 defaults 里存在的 key）。
      plugin: '',
    },
```

**编辑 3 —— accessor（`get usage() { ... }` 之后，约 config.ts:439）：**

```ts
  get runtime() { return this.data.runtime; }
```

- [ ] **Step 2: index.ts —— start() 接线**

**编辑 1 —— 导入补充（Task 5 已加 `RuntimePluginLoader`，本步补两个）：**

```ts
import { createRuntimePluginContext } from './runtime/loader';
import { AgentRuntime } from './runtime/contract';
```

**编辑 2 —— loader 初始化（start() 内，index.ts:322 注释 `// 2. 创建 SDK 客户端` 之前插入）：**

```ts
    this.runtimeLoader = new RuntimePluginLoader(config.resolvePath('runtime-plugins'));
    await this.runtimeLoader.init();
```

**编辑 3 —— 替换 index.ts:323-333 的客户端创建块。** 旧代码：

```ts
    const { createOpencodeAdapter } = await import('./opencode-adapter.js');
    const sdkConfig = { 
      baseUrl: this.serveUrl,
      directory: this.projectDir,
      headers: {} as Record<string, string>,
    };
    const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    this.opencodeClient = await createOpencodeAdapter(sdkConfig);
```

替换为：

```ts
    const sdkConfig = {
      baseUrl: this.serveUrl,
      directory: this.projectDir,
      headers: {} as Record<string, string>,
    };
    const opencodePassword = process.env.MAFW_OPENCODE_PASSWORD;
    if (opencodePassword) {
      sdkConfig.headers = { Authorization: 'Basic ' + Buffer.from(`opencode:${opencodePassword}`).toString('base64') };
    }
    const runtime = await this.createRuntime(sdkConfig);
    this.opencodeClient = runtime;
    this.runtimeCaps = runtime.capabilities;
    this.runtimeName = runtime.name;
```

**编辑 4 —— 新增 createRuntime 方法（放在 capGuard 之后）：**

```ts
  /**
   * Runtime 选择：config.runtime.plugin 指定 ~/.mafw/runtime-plugins/ 中的插件；
   * 未配置/找不到/加载失败一律回退内置 opencode（fail-open，行为与现状一致）。
   */
  private async createRuntime(sdkConfig: { baseUrl: string; directory?: string; headers: Record<string, string> }): Promise<AgentRuntime> {
    const pluginName = config.runtime?.plugin;
    if (pluginName) {
      const plugin = this.runtimeLoader?.get(pluginName);
      if (plugin) {
        try {
          const rt = await plugin.createRuntime(createRuntimePluginContext());
          log.info(`[Runtime] using plugin runtime '${rt.name}' (capabilities: ${JSON.stringify(rt.capabilities)})`);
          return rt;
        } catch (err: any) {
          log.warn(`[Runtime] plugin '${pluginName}' createRuntime failed: ${err.message} — falling back to opencode`);
        }
      } else {
        log.warn(`[Runtime] plugin '${pluginName}' not found — falling back to opencode`);
      }
    }
    const { createOpencodeRuntime } = await import('./runtime/opencode-runtime.js');
    return createOpencodeRuntime(sdkConfig);
  }
```

- [ ] **Step 3: Build gate + 全量单测**

Run: `npm run build`，然后 `npm run test:unit`
Expected: build exit 0；全绿

- [ ] **Step 4: 端到端冒烟**

```bash
# 1. 默认路径（无配置）→ 内置 opencode
curl.exe -s http://127.0.0.1:3000/api/runtime
# Expected: {"active":{"name":"opencode","capabilities":{"sessionApi":true,...}},"plugins":[]}

# 2. 配置不存在的插件名 → 回退 opencode + 日志告警
#    ~/.mafw/config.yaml 加 runtime: { plugin: nope }，重启 gateway
# Expected: /api/runtime 仍返回 opencode；日志含 "plugin 'nope' not found — falling back to opencode"
```

冒烟完成后把 config.yaml 复原。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add gateway/src/config.ts gateway/src/index.ts
git commit -m "feat(runtime): wire runtime selection via config.runtime.plugin"
```

---

### Task 7: 文档（AGENTS.md）

**Files:**
- Modify: `AGENTS.md`（新增 §5.19；修正 §5.11 一处不精确描述）

- [ ] **Step 1: 新增 §5.19（放在 §5.18 之后、## 6 之前）**

```markdown
### 5.19 Runtime 能力契约（多 runtime 接缝）

gateway 与 agent runtime 之间是**能力自声明契约**（`gateway/src/runtime/`）：

- `contract.ts` — `RuntimeCapabilities`（sessionApi/promptWhileBusy/eventStream/
  nativeApprovals/providerConfigApi/perLlmCallTransform）+ `RuntimeClient` 接口面
  + `AgentRuntime`。能力分级：Tier 0（协作协议 + per-turn 记忆）→ Tier 1（+ 自治执行
  + per-step 记忆）→ Tier 2（+ 桌面完整，opencode 形状 DTO 归一化输出）
- `normalize.ts` — runtime 原生事件 → `EventFacets`（正交切面：step/chatSignal/
  broadcast/toolCommand）；opencode 版本知识（≥1.18 step-finish part 结算）只存在于
  本文件和 step-inject.ts 的两个 helper
- `opencode-runtime.ts` — 内置恒等实现（全能力，`external` 跟随 MAFW_SERVER_SERVE_URL）
- `loader.ts` — `~/.mafw/runtime-plugins/*.js` 插件加载（CJS `module.exports =
  { name, capabilities, createRuntime(ctx) }`，fail-open，无热加载；能力声明覆盖在
  Tier-0 基线之上）

激活插件：`config.yaml` 的 `runtime.plugin: <name>`（或 `MAFW_RUNTIME_PLUGIN`）；
未配置/加载失败一律回退内置 opencode。可观测：`GET /api/runtime` 返回当前
runtime 能力集 + 插件扫描状态。能力门：缺能力的 runtime 对应端点 503、
事件订阅跳过，不崩溃。

宿主插件侧（runtime 进程内的 transform/工具注册）是每个 runtime 单独交付物，
不在本契约内；gateway 侧 HTTP（/api/obs/capture、/api/recall/context、/a2a）
对宿主插件保持 runtime 中立。
```

- [ ] **Step 2: 修正 §5.11 表格中"边界 recall"的时机描述**

原文：`| ② 边界 recall | 用户消息到达（messages.transform） | 插件调 GET /api/recall/context → <recall> 指针块 |`

替换为：

`| ② 边界 recall | **每次 LLM 调用前**（messages.transform 在 agentic 循环内；增量游标使同 turn 后续 step 近似幂等） | 插件调 GET /api/recall/context → <recall> 指针块 |`

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add AGENTS.md
git commit -m "docs: document runtime capability contract (§5.19)"
```

---

## 已知债务

1. ~~`index.ts:230` 的 `private opencodeClient: any` 未改为 `AgentRuntime`~~ — **已解决**（commit `5ca7d7df`，Debt 1）
2. ~~`core/manager/wake-handlers.ts:34-35` 每次调用重新 `createOpencodeAdapter`~~ — **已解决**（commit `5ca7d7df`，Debt 2）
3. ~~`AgentRuntime.external` 仅为信息性字段，未接入 serve-sidecar 逻辑~~ — **已解决**（commit `5ca7d7df`，Debt 3）
4. ~~`resources/opencode-db.ts` 直读 opencode.db、`media/auth-util.ts` 直读 auth.json、`manager-agent-config.ts` 直写 agent 定义~~ — **已解决**（commit `5ca7d7df`，Debt 4/5a/5b：`sessionStorageApi` + `credentials` + `agents.install` 抽象接口）
5. pi-coding-agent runtime 插件（Tier 0/1）——契约验证样本，**待实现**。

## 验收标准

- [ ] `npm run build` exit 0
- [ ] `npm run test:unit` 全绿（含新增 19 个测试：contract 2 + normalize 9 + opencode-runtime 3 + loader 5）
- [ ] `GET /api/runtime` 返回 `{"active":{"name":"opencode","capabilities":{...全 true}},"plugins":[]}`
- [ ] 冒烟：发消息 → SSE 日志正常、recall 注入正常、`/api/provider` 200
- [ ] 配置不存在插件名时回退 opencode 且日志告警
