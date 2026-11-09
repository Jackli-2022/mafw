# 中性 Runtime Driver 架构设计（内核 / 驱动模型）

- 日期：2026-11-09
- 状态：待批准
- 关联调研：`docs/research/2026-11-09-openmausbot-harness-research.md`
- 关联设计：
  - `2026-11-02-runtime-isolation-experience-contract-design.md`
  - `2026-10-21-runtime-canonical-v3-design.md`
  - `2026-10-31-runtime-plugin-ergonomics-design.md`

## 1. 意图与为什么

MAFW 已经有 runtime 契约、canonical 事件、View DTO、Experience 和 runtime 插件检查器。但 adapter 边界仍然是 opencode 形状的：

- `RuntimeClient` 是 30+ 方法的单一接口，新的 runtime 一打开契约就要面对整张表；
- 事件翻译的目标是 opencode 的 `payload.properties` / `info/parts`，新作者必须先学 opencode；
- gateway core 里仍有 `normalizeOpencodeEvent`、`opencode-*`、`serve-sidecar` 的 opencode 分支、`index.ts` 的 117 处引用；
- 前端虽然不 import opencode，但 View DTO 的字段仍带有 opencode 形状（`time.busy/idle`、`tokens.cache.read`、`state.status`）。

这导致两个后果：

1. 加一个新 runtime 的成本高，因为要“模仿 opencode”，而不是“实现自己的协议”；
2. gateway 与 opencode 的耦合被当成默认架构，任何 runtime 都很难做到真正平等。

本设计借用计算机底层的**内核 / 驱动模型**，把 gateway 变成内核，把 runtime 变成驱动：

- **ISA** = 中性的 `AdapterEvent` + `RuntimeTransport` 方法签名；
- **驱动** = `adapters/opencode`、`adapters/pi`、`adapters/claude`；
- **总线** = `RuntimeBus` / `defineRuntime` / loader；
- **中断** = `AdapterEvent` 异步事件；
- **DMA** = 大载荷走附件 handle，不内联进事件；
- **系统调用** = `RuntimeAccess` / Experience / View DTO；
- **HAL / class driver** = `RuntimeChannels`；
- **保护环** = 驱动只能发事件/返回结果，不能改内核状态。

最终形态：**gateway core 不认识任何具体 runtime；内置 runtime 只是随包编译的驱动，不是特权路径。**

## 2. 目标、非目标与反目标

### 2.1 目标

- G1：所有 runtime（opencode / pi / claude / 未来 runtime）都通过同一个 `defineRuntime` 注册，走同一套 `RuntimeTransport` + `AdapterEvent` + `RuntimeChannels`。
- G2：gateway core（`gateway/src`，`adapters/` 之外）不得出现任何 runtime 的协议代码、配置键、存储路径、CLI 解析或事件方言。
- G3：runtime → gateway 的唯一事件出口是 `AdapterEvent`；`payload.properties`、`info/parts`、原生 SDK 类型不得越过 adapter 边界。
- G4：gateway → runtime 的唯一协议入口是 `RuntimeTransport`（回合）和 `RuntimeChannels`（非事件面）。
- G5：前端只消费 `Mafw*` View DTO / SSE；不读 runtime 名、不读原生字段、不 import runtime SDK。
- G6：新 runtime 的最小实现只需要 5～7 个 transport 方法 + 可选 channels；不需要实现整张 `RuntimeClient`。
- G7：AdapterEvent v1 覆盖现有 runtime 原生事件 100%，v1 channels 覆盖约 85%；剩余 15%（MCP / discovery / instructions / PTY / checkpoint / background）由**同批交付**的 v2 channels 覆盖，不留功能回退。
- G8：ABI 版本化，gateway 拒绝不匹配的 adapter；未知事件是 spurious IRQ，drop + 计数，不 passthrough。

### 2.2 非目标

- 不做进程隔离/沙箱（adapter 可以先在进程内；接口按进程外设计）。
- 不替换 `RuntimeFacade` / `RuntimeAccess` / Experience；它们在内核之上继续存在。
- 不要求每个 runtime 都发全部 33 个事件；不支持的显式 `unavailable`，不伪造。
- 不在本设计里一次性清理所有前端 opencode 字样（WSL 安装、主题名等是功能名，不是协议耦合）。
- 不做多 runtime 并存/会话跨 runtime 迁移（保持现有语义）。

### 2.3 反目标（出现即说明设计失败）

- gateway core 出现 `if (runtimeName === 'opencode')`、`normalizeOpencodeEvent`、`opencode-*` 协议分支。
- adapter 直接调用 gateway 内部函数，或 gateway 直接读 adapter 私有字段。
- adapter 把原生事件、`payload.properties`、`info/parts` 直接塞进 SSE/事件总线。
- 为了“统一”伪造不支持的事件/能力。
- 以“兼容”为名在 `defineRuntime` 里永久保留 `native` 分支。
- 前端按 runtime 名或原生字段决定行为。

## 3. 内核 / 驱动边界

```text
gateway/src/runtime/          ← 内核：只有中性契约
  transport.ts                ← RuntimeTransport
  adapter-event.ts            ← AdapterEvent v1（33 变体）
  adapter-event-schema.ts     ← 运行时校验 + 必填字段
  adapter-event-mapper.ts     ← AdapterEvent → canonical / View DTO（唯一执行器）
  channels.ts                 ← RuntimeChannels
  define-runtime.ts           ← 唯一注册入口
  runtime-bus.ts              ← 枚举、绑定、路由、热插拔
  loader.ts                   ← 内置 + 外部共用

adapters/opencode/            ← 驱动：HTTP/serve/MCP/instructions/PTY/方言
adapters/pi/                  ← 驱动：SDK/registry/approval bridge
adapters/claude/              ← 驱动：SDK/history/events
```

规则：

1. **内置 = 静态链接的驱动，不是特权。** opencode 可以随包编译，但只能通过 driver interface 被调用。
2. **没有 vendor ioctl。** MCP、Discovery、PTY、Checkpoint 也是标准 channel；驱动没实现就返回 `ENODEV`，不能开 vendor 专用路径。
3. **没有 `native` 分支。** 迁移期的兼容代码放在 **adapter 包内部**（`legacy.ts`），内核只看到 `defineRuntime` 的返回值。
4. **内核不认识 runtime 名。** `gateway/src` 里只允许出现 adapter 包的 import 路径，不允许协议分支/配置/存储知识。
5. **保护环。** adapter 只能发事件、返回结果、实现 channels；不能调用 gateway 内部函数，也不能被 gateway 直接读私有字段。

### 3.1 构建与链接

- ISA 类型放在独立 workspace 包 `packages/runtime-contract`：`AdapterEvent`、`RuntimeTransport`、`RuntimeChannels`、`defineRuntime`、`deriveCapabilities`。gateway 与 adapters 都依赖它；`gateway/src/runtime/adapter-event.ts` 只做 re-export。这样 adapter 不需要 import gateway 源码。
- `adapters/*` 是独立的 workspace 包（加入 root workspaces，或保持独立构建但产出标准包入口）。
- 每个 adapter 产出 CJS/ESM 入口，导出 `defineRuntime(...)` 的结果；不导出旧 `createRuntime`。
- gateway 只依赖 adapter 的**包入口**，不 import adapter 内部文件。
- 构建顺序：adapters → gateway；`deploy:local` / `stage-gateway` / npm `files` 必须包含 adapter 产物。
- 外部插件仍从 `~/.mafw/runtime-plugins/*` 加载，入口形状与内置 adapter 完全相同。
- 具体用 workspace、esbuild bundle 还是运行时 require，由 builder 在 Phase 0 决定；约束是“gateway 不 import adapter 内部”。

## 4. ABI 与版本

| 项 | 值 | 规则 |
|---|---|---|
| `adapterApi` | `1` | `defineRuntime` 必填；gateway 不匹配拒绝加载 |
| `eventApi` | `1` | AdapterEvent v1；adapter 声明，gateway 校验 |
| `channelApi` | `1` 或 `2` | v1 只含基础 channels；v2 才允许 `channelsV2`（MCP/discovery/instructions/PTY/checkpoint/background） |
| `preset` | `core` / `conversation` / `autonomous` / `desktop` | 最低 surface 集，不是能力声明；实际能力从 transport/channels 派生 |

破坏性变更升版本；gateway 可以支持 N/N-1 一段时间，但不允许“无版本”或“猜版本”。

## 5. RuntimeTransport v1

只有回合协议。非事件面走 `RuntimeChannels`。

```ts
export interface RuntimeTransport {
  /** 可选：启动/停止 adapter 自己的进程或 SDK。 */
  start?(): Promise<void>;
  stop?(): Promise<void>;

  createSession(input: {
    directory: string;
    parentID?: string;
    title?: string;
  }): Promise<{ sessionID: string }>;

  /** 投递一个回合；不得阻塞到回合结束。 */
  sendTurn(input: {
    sessionID: string;
    /** gateway 铸造并传入；adapter 必须在所有事件中回显同一个 id。 */
    turnID: string;
    text: string;
    parts?: AdapterPartInput[];
    system?: string;
    agent?: string;
    model?: MafwModelRef;
    variant?: string;
    thinkingLevel?: ThinkingLevel;
    cwd?: string;
    /** false = 通知型回合（milestone push / run 简报），不触发模型回答。 */
    expectReply?: boolean;
    /** 排队窗口幂等键；gateway 队列消费，adapter 只透传。 */
    idempotencyKey?: string;
    /** 结构化交卷 schema（goal plan/execute/review）。 */
    outputSchema?: OutputSchemaSpec;
    /** 回合预算；adapter 原生支持时自行强制，否则 gateway BudgetGuard 兜底。 */
    budget?: { maxTurns?: number; maxCostUsd?: number };
    /** 非语义扩展：adapter 可忽略。 */
    metadata?: Record<string, unknown>;
  }): Promise<{ turnID: string }>;

  /** 幂等：重复调用不报错。 */
  interruptTurn(sessionID: string, turnID?: string): Promise<void>;

  /** provider 原生审批；没有原生审批的 runtime 不实现。 */
  respondToRequest?(
    sessionID: string,
    requestID: string,
    decision: { behavior: 'allow' | 'deny' | 'answer'; message?: string; always?: boolean },
  ): Promise<'allowed-once' | 'rejected' | 'answered' | 'unavailable'>;

  /** busy 时投递；三值语义，indeterminate 不得重发。 */
  steer?(
    sessionID: string,
    text: string,
    parts?: AdapterPartInput[],
  ): Promise<'steered' | 'refused' | 'indeterminate'>;

  /** 健康/安装/认证/版本快照；插件中心与 Config 用。 */
  snapshot?(): Promise<RuntimeSnapshot>;

  /** 唯一事件出口；adapter 自己负责把原生事件翻译成 AdapterEvent。 */
  onEvent(listener: (event: AdapterEvent) => void): () => void;
}

export interface RuntimeSnapshot {
  state: 'available' | 'unavailable';
  reason?: string;
  authenticated?: boolean;
  version?: string;
  update?: { title: string; message: string; command: string };
  warning?: { title: string; message: string };
}
```

语义约束：

- `sendTurn` 返回 `turnID` 后，adapter 在后台继续跑；所有进度通过 `onEvent` 发。
- 阻塞型 SDK（如 pi）在 adapter 内后台化，不能阻塞 transport 调用。
- `interruptTurn` 必须幂等；已经结束的回合不报错。
- `respondToRequest` 的 `unavailable` 表示“没有人能接这个答案”，调用方按拒绝处理。
- `steer` 的 `indeterminate` 表示“可能已送达”，调用方不得重发。
- `onEvent` 只能发 `AdapterEvent`；未知原生事件由 adapter 自己 drop + telemetry。

### 5.1 附件 / DMA 契约

`AdapterPartInput` 是 transport 的入参，不是 event 的载荷：

```ts
export type AdapterPartInput =
  | { type: 'text'; text: string }
  | {
      type: 'file';
      /** gateway 附件存储的 handle；adapter 不直接接收 base64。 */
      ref: AttachmentRef;
      mime: string;
      filename?: string;
    };

export interface AttachmentRef {
  id: string;
  bytes: number;
  mime: string;
  /** gateway 解析后的本地路径（同进程 adapter 用）或 loopback URL（外部 adapter 用）。 */
  path?: string;
  url?: string;
}
```

规则：

- 小文本/小 JSON 可以内联；图片、视频、音频、文件、patch 一律走 `AttachmentRef`。
- gateway 拥有附件存储与 GC；adapter 只读 handle，不负责上传/删除。
- 事件里的 `MafwPart` file 形态增加可选 `ref?: AttachmentRef`；gateway 投影时解析为 `url`，不内联 data URL。`url` 仍保留给已经解析好的短 URL / 工件引用。
- 外部 adapter 拿 `url`（loopback + 短期票据），不拿 gateway 文件系统路径。

## 6. RuntimeChannels v1

非事件面。全部可选；未实现 = surface 不可用（`ENODEV` / 503），不是 native 旁路。

```ts
export interface RuntimeChannels {
  session?: {
    list?(opts?: { directory?: string }): Promise<MafwSession[]>;
    listByDirectory?(directory: string, limit?: number): Promise<MafwSession[]>;
    get?(sessionID: string): Promise<MafwSession>;
    update?(sessionID: string, patch: { title?: string }): Promise<void>;
    delete?(sessionID: string): Promise<void>;
    abort?(sessionID: string): Promise<void>;
  };
  messages?: {
    list(sessionID: string, opts?: { limit?: number; before?: string }): Promise<{ data: MafwMessage[]; nextCursor?: string }>;
    normalize?(raw: unknown[]): MafwMessage[];
  };
  providers?: {
    list(): Promise<{ all: MafwProvider[]; connected: string[]; default: Record<string, string> }>;
  };
  agents?: {
    list(): Promise<MafwAgent[]>;
    install(name: string, definition: AgentDefinition): Promise<void>;
    remove?(name: string): Promise<void>;
  };
  branch?: {
    fork?(sessionID: string, messageID?: string): Promise<{ sessionID: string }>;
    revert?(sessionID: string, messageID: string, opts?: { files?: boolean }): Promise<void>;
    unrevert?(sessionID: string): Promise<void>;
  };
  diff?: {
    get?(sessionID: string, messageID?: string): Promise<MafwDiff[]>;
    vcsDiff?(opts?: { mode?: 'git' | 'branch' }): Promise<MafwDiff[]>;
    vcsApply?(patch: string): Promise<void>;
  };
  question?: {
    list(opts?: { directory?: string }): Promise<MafwQuestionRequest[]>;
    reply(opts: { requestID: string; answers: string[][]; directory?: string }): Promise<void>;
    reject(opts: { requestID: string; directory?: string }): Promise<void>;
  };
  completion?: {
    complete(req: CompletionRequest): Promise<CompletionResult>;
  };
  shell?: {
    create(opts: { command: string; cwd?: string; timeout?: number }): Promise<{ shellID: string }>;
    get(shellID: string): Promise<unknown>;
    output(shellID: string, opts?: { cursor?: number; limit?: number }): Promise<unknown>;
    remove(shellID: string): Promise<void>;
  };
  mediaSession?: {
    create(opts: { directory: string }): Promise<{ sessionID: string }>;
  };
}
```

### 6.1 v2 channels（与 v1 同批交付）

用户裁决：v2 channels 与 v1 同一批交付，不允许迁移后这些面降级。`RuntimeChannels` 增加以下可选块；adapter 声明 `channelApi: 2` 才能使用：

```ts
export interface RuntimeChannelsV2 {
  mcp?: {
    list(opts?: { directory?: string }): Promise<McpServerStatus[]>;
    connect?(name: string): Promise<void>;
    disconnect?(name: string): Promise<void>;
    config?: RuntimeMcpConfigChannel;
  };
  discovery?: {
    list(input?: { directory?: string }): Promise<RuntimeDiscoverySnapshot>;
    loadSkill?(key: string): Promise<string>;
  };
  instructions?: {
    list(sessionID: string): Promise<Array<{ key: string; value: unknown }>>;
    put(sessionID: string, key: string, value: unknown): Promise<void>;
    remove(sessionID: string, key: string): Promise<void>;
  };
  pty?: RuntimePtyChannel;
  checkpoint?: {
    snapshotTree?(sessionID: string, messageID?: string): Promise<unknown>;
  };
  background?: {
    toBackground?(sessionID: string): Promise<void>;
    list?(): Promise<MafwBackgroundJob[]>;
    cancel?(jobID: string): Promise<void>;
  };
}
```

这些类型复用现有 `RuntimeMcpChannel` / `RuntimeDiscoveryChannel` / `RuntimePtyChannel` / `RuntimeSnapshotTreeChannel`，不再造第二套。opencode 的五类实现全部搬进 `adapters/opencode`，在同一个发布里通过 v2 channel 暴露；Phase 4 删除 gateway 旧代码前，v2 channel 必须全部绿。

## 7. AdapterEvent v1

### 7.1 信封

```ts
export const ADAPTER_EVENT_VERSION = 1 as const;

export interface AdapterEventBase {
  id: string;
  type: AdapterEventType;
  sessionID?: string;
  turnID?: string;
  itemID?: string;
  requestID?: string;
  at: number;
  seq?: number;
  /** 仅诊断：gateway 脱敏、截断、写 native.ndjson；永不转发客户端。 */
  native?: { source: string; payload: unknown };
}
```

规则：

- 插件不发 runtime 名字/实例 id；gateway 在边界 stamp。
- 未知 `type`：drop + spurious 计数，不 passthrough。
- `native` 上限 16KB，超限截断；内容脱敏。
- 大载荷（图片/文件/patch）走 handle/URL，不内联。

### 7.2 事件清单（33 变体）

| 类别 | 事件 |
|---|---|
| 会话（6） | `session.created`、`session.updated`、`session.deleted`、`session.status`、`session.compacting`、`session.compacted` |
| 回合（7） | `turn.started`、`turn.completed`、`turn.failed`、`turn.aborted`、`turn.retrying`、`turn.waiting`、`turn.cap_exhausted` |
| 消息/部件（7） | `message.updated`、`message.removed`、`part.updated`、`part.delta`、`part.completed`、`part.removed`、`data.updated` |
| 计划/用量（2） | `plan.updated`、`usage.updated` |
| 审批/问答（5） | `permission.asked`、`permission.replied`、`question.asked`、`question.replied`、`question.rejected` |
| runtime（2） | `runtime.notice`、`runtime.error` |
| 工具三原语（3） | `tool.call`、`tool.delta`、`tool.result` |
| shell（1） | `shell.updated` |

完整 TypeScript 形状见调研文档 §3.7；本 spec 只钉住语义与验收：

- `part.updated` / `part.completed` 的 payload 直接复用 `MafwPart`；`message.updated` 复用 `MafwMessage`。
- `tool.call/delta/result` 只给 call/result 分离的 runtime；snapshot 型 runtime 直接发 `part.updated`，gateway 的 assembler 统一。
- `permission.asked` 必须带 `command`/`cwd`/`reads`/`origin`/`requiresExplicitApproval`/`allowSession`/`nativeReview` 中适用的字段。
- `turn.completed` 的 `usage` 只算本回合，不累加；`thread` 累计由 gateway 的 trajectory 负责。
- `turn.failed` 的 `kind` 至少覆盖 `provider / rate_limit / usage_limit / credits / tool_schema / tool_count / interrupted / unknown`。

### 7.3 Mapper

`adapter-event-mapper.ts` 是唯一执行器：

- 校验 ABI/版本/必填字段；
- 把 `AdapterEvent` 映射到现有 canonical 事件（`mafw-vocabulary`）；
- 把 `tool.call/delta/result` 交给 `tool-part-assembler`；
- 把 `permission/question` 交给现有路由/审批策略；
- 把 `turn.*` 交给 NodeDriver/RunCoordinator/trajectory；
- 未知/畸形事件 drop + telemetry，不进入业务；
- 在出口 stamp `runtimeName`/`instanceID`，但 View DTO/SSE 不带这些字段（诊断面例外）。

### 7.4 排序、去重与 turn 身份

- **turnID 由 gateway 铸造**，`sendTurn` 传入；adapter 必须在所有 `turn.*` / `part.*` / `usage.*` 事件中回显同一个 `turnID`。adapter 不能自己换 id；如果原生协议有自己的 turn id，放在 `native` 里。
- **event.id 去重**：gateway bus 对每个 session 保留最近 N 个 event id；重复 id 直接 drop。
- **seq 可选**：adapter 提供 `seq` 时，bus 按 `(sessionID, seq)` 丢弃旧帧；不提供时按到达顺序，迟到 turn 由 generation fence 兜底。
- **终态优先**：`turn.completed/failed/aborted` 到达时，先 flush 该 turn 的 pending delta/progress，再结算 trajectory / usage / BudgetGuard。
- **usage 结算**：`usage.updated` 以 `turnID` 为幂等键；同一 turn 的重复 usage 只取最后一份，不累加。
- **重试**：gateway 换新 `turnID`，旧 turn 进入 retired 集合；adapter 不得把旧 turn 的事件贴到新 turn 上。

### 7.5 客户端可见性（v1）

AdapterEvent v1 是 **adapter-facing**，不等于客户端事件。v1 不改 SDK `events.ts` union：

| AdapterEvent | v1 处理 |
|---|---|
| `session.created/updated/deleted` | 映射现有 canonical 同名事件 |
| `session.status` | 合并进 `session.updated`（status 字段）；不新增客户端事件 |
| `session.compacting/compacted` | 映射现有 canonical 同名事件 |
| `turn.started/completed/failed/aborted` | 映射现有 canonical 同名事件 |
| `turn.retrying/waiting/cap_exhausted` | **内部**：写 telemetry / Goal timeline / Experience 后续消费；v1 不广播 |
| `message.updated` / `part.updated/delta` / `part.completed` | 映射现有 canonical；`part.completed` → `part.complete` |
| `message.removed` / `part.removed` | 内部：用于 revert/compaction 对账；v1 不广播 |
| `data.updated` | 映射 `part.updated`（`data-*`） |
| `plan.updated` / `usage.updated` | 映射现有 canonical 同名事件 |
| `permission.asked/replied` / `question.asked/replied/rejected` | 映射现有 canonical 同名事件 |
| `runtime.notice` | **内部**：日志 / 插件中心；v1 不广播 |
| `runtime.error` | turn-scoped → `turn.failed`；无 turn → 内部 telemetry / 插件中心；v1 不新增客户端事件 |
| `tool.call/delta/result` | 内部三原语，由 assembler 合成 `part.updated` |
| `shell.updated` | 内部：background job / shell 状态；v1 不广播 |

后续如果要让桌面看到 retry/waiting，新增 canonical 事件（升 SDK union）或在 Experience 里暴露；不在 v1 偷渡。

## 8. defineRuntime 与 manifest

```ts
export function defineRuntime(input: {
  api: 1;
  name: string;
  displayName: string;
  preset: 'core' | 'conversation' | 'autonomous' | 'desktop';
  transport: RuntimeTransport;
  channels?: RuntimeChannels;
  /** v2 channels（MCP/discovery/instructions/PTY/checkpoint/background）。 */
  channelsV2?: RuntimeChannelsV2;
  channelApi?: 1 | 2;
  manifest?: {
    install?: EngineInstall;
    auth?: AuthDescriptor;
    models?: ModelCatalog;
    nativeTools?: NativeToolDeclaration[];
    configSchema?: unknown;
  };
  events?: { api: 1 };
}): RuntimeFactory;
```

需要异步初始化的 adapter（例如先 `import()` SDK、先探测 CLI）导出：

```ts
export function createRuntimeDefinition(ctx: RuntimeFactoryContext): Promise<RuntimeDefinition>;
```

loader 在激活时调用一次；`defineRuntime` 仍是同步的纯函数，返回静态 `RuntimeDefinition`。`RuntimeFactoryContext` 是合同包里的最小结构（`gatewayPort` / `rootDir` / `projectDir` / `pluginConfig` / `credentials` / `log`），不引用 gateway 源码。

`defineRuntime` 负责：

- 校验 `api` / `eventApi` / `channelApi`；
- 从 `transport` + `channels` + `preset` 派生 `RuntimeCapabilities`（不再手写 23 个布尔）；
- 填充未实现 channel 的中性桩（返回不支持，不抛异常）；
- 包装 `onEvent`：校验 → 映射 → 分发；
- 提供 `snapshot` / `install` / `auth` 的插件中心展示；
- 把 `nativeTools` 注册到工具类别表（声明优先，静态表兜底）。

能力派生规则（示例）：

| 能力 | 来源 |
|---|---|
| `sessionApi` | `transport.createSession` + `sendTurn` |
| `promptWhileBusy` | `transport.steer` 或 adapter 声明 |
| `eventStream` | `transport.onEvent` |
| `nativeApprovals` | `transport.respondToRequest` |
| `steerApi` | `transport.steer` |
| `questionApi` | `channels.question` |
| `sessionBranchApi` | `channels.branch.fork/revert` |
| `diffApi` | `channels.diff.get` |
| `completionApi` | `channels.completion.complete` |
| `mcpApi` / `discoveryApi` / `instructionsApi` / `ptyApi` / `checkpointApi` | `channelsV2` 对应块是否存在 |

语义位（`turnBudgetApi`、`revertUndoApi`）必须显式声明，不能从方法存在性猜。

## 9. 迁移计划

**没有 `native` 分支。** 迁移兼容代码放在 adapter 包内部。

### Phase 0：内核骨架

- 新增 `transport.ts`、`adapter-event.ts`、`adapter-event-schema.ts`、`adapter-event-mapper.ts`、`channels.ts`、`define-runtime.ts`、`runtime-bus.ts`；
- 用 fake driver 跑通：createSession → sendTurn → 事件 → turn.completed → channels；
- loader 同时支持内置 adapter 包与外部 `~/.mafw/runtime-plugins`；
- 架构守卫骨架（`gateway/src` 不得出现 runtime 协议名）。

### Phase 1：claude（样板）

- `adapters/claude` 拆成 `transport.ts` + `channels.ts` + `events.ts` + `index.ts`；
- `transport.ts` 包装现有 `runtime.ts` 的 `spawn/sessions/tracker/bus`；
- `events.ts` 输出 `AdapterEvent`（修 `field:'reasoning'` 和 `tool.delta` 的 `field/delta`）；
- 补 `session.updated/deleted/status`、`usage.updated`；
- 不实现 `permission/question/plan`，显式 `unavailable`。

### Phase 2：pi

- `gateway/src/runtime/plugins/pi-runtime.ts` + `gateway/src/runtime/pi/**` 移到 `adapters/pi/**`；
- `transport.ts` 包装 `PiSessionRegistry`；
- `PI_EVENT_MAPPINGS` 改为输出 `AdapterEvent`；
- 补 `session.created/deleted`、`usage.updated`、`plan.updated`、`session.compacted`；
- `question.*` 显式 `unavailable`。

### Phase 3：opencode

- `gateway/src/runtime/opencode-*` 全部移到 `adapters/opencode/**`；
- `adapters/opencode/transport.ts` 包装现有 `opencode-adapter.ts`（先作为 `legacy.ts`）；
- `channels.ts` 包装 messages/providers/agents/branch/diff/completion/shell/media；
- 事件翻译输出 `AdapterEvent`；
- 方言探测、MCP JSONC、instructions、PTY、checkpoint、background 留在 adapter，**同批**通过 `channelsV2` 暴露；
- gateway 只保留通用进程监督器；opencode 的 spawn/readiness 描述进 adapter。

### Phase 4：删除 legacy + 守卫

- 每个 adapter 重写完成后删除 `legacy.ts`；
- 删除 `gateway/src/runtime` 里的 `opencode-*` / `pi/**`；
- **删除前门禁**：opencode 的 v2 channels（MCP / discovery / instructions / PTY / checkpoint / background）全部 golden 绿，桌面功能无回退；
- CI 守卫上线：
  1. `gateway/src`（`adapters/` 之外）grep `opencode|pi|claude` 协议引用 → fail；
  2. `gateway/src` grep `payload.properties`（adapter 之外）→ fail；
  3. `defineRuntime` 不得出现 `native` 分支；
  4. 所有内置 runtime 必须经 `defineRuntime` 注册；
  5. 前端 grep runtime 名 → 只允许 WSL/主题等功能名白名单。

### Phase 4.1：旧插件兼容 shim（一个发布周期）

用户裁决：保留一个发布周期的 generic 兼容 shim，下个大版本删除。

- 位置：`gateway/src/runtime/legacy/legacy-plugin-bridge.ts`（临时目录，标注 `@deprecated`）。
- 触发：loader 发现插件导出 `createRuntime(ctx)` 且没有 `api: 1`。
- 行为：把旧 `AgentRuntime` 包装成 `RuntimeDefinition`：
  - `transport.createSession` → 旧 `session.create`；
  - `sendTurn` → 旧 `session.promptAsync`；
  - `interruptTurn` → 旧 `session.abort`；
  - `respondToRequest` → 旧 `session.permissionReply`（`once/always/reject` 映射）；不可用 → `unavailable`；
  - `onEvent` → 订阅旧 `global.event()`，把旧 canonical 事件反映射为 `AdapterEvent`（只覆盖核心 20 类；其余进 `native`/telemetry）；
  - `channels` → 旧 `session.messages/provider.list/agents/branch/diff/completion/question/shell` 中存在的方法。
- 降级：旧插件没有的 channel 一律 `ENODEV`；`plugin-check` 给 `legacy-plugin` 警告。
- 删除门禁：下个大版本删除 `legacy/` 目录；CI 禁止新 adapter import 它。
- 这不是 vendor native：bridge 不认任何 runtime 名，只认旧 ABI 形状；内核仍然只看到 `RuntimeDefinition`。

### Phase 5：前端 / DTO 中性化

- 移除 View DTO 的 opencode 形状字段，或只在 adapter 内使用；
- 确保 desktop/session-ui/tui 不按 runtime 名分支；
- 保留 `runtimeName` 只在 Config 诊断面。

## 10. 测试策略

### 10.1 Fake driver

一个脚本化 adapter：按时间轴发事件，断言 mapper 输出、能力派生、未知事件 drop、ABI 不匹配拒绝、热插拔 detach/attach。

### 10.2 Golden 对照

每个 runtime 迁移时：

1. 固定原生事件 fixture；
2. 旧实现 → canonical 序列；
3. 新 `defineRuntime` → canonical 序列；
4. 逐事件断言相等（字段顺序无关）。

### 10.3 契约 / 场景

- `mafw plugin-check --preset <preset>`：声明的能力 ↔ 实际 transport/channels/events 一致；
- `mafw plugin-test`：S1/S2/S3/S4 场景；
- `event-replay`：raw → AdapterEvent → canonical 全链路；
- `stream` 并发/乱序/重复/迟到事件；
- 大载荷（图片/文件）走 handle，不进事件正文；
- 审批 / 问题 / 中断 / steer 三值；
- 热插拔：运行时切换、旧 adapter detach、事件不串流。

### 10.4 架构守卫

见 §9 Phase 4。

## 11. 风险与取舍

| 风险 | 处理 |
|---|---|
| opencode 迁移量大（1012 行 adapter） | 先 `legacy.ts` 包装，再逐步重写；行为由 golden 钉住 |
| pi 阻塞式 `promptAsync` | adapter 内后台化；transport 只投递 |
| claude 无原生审批/问答 | 显式 `unavailable`，不伪造 |
| 多一层 mapper 的性能 | delta 合并、零拷贝 part、只对必要字段校验 |
| 大载荷撑爆总线 | DMA 规则：handle/URL，不内联 base64 |
| 现有客户端破坏 | AdapterEvent 只在 adapter 边界；View DTO/SSE 不变 |
| v2 channels 同批导致范围膨胀 | 先做 opencode v2 五类，其他 runtime 按需；v2 有独立验收，不阻塞 v1 内核 |
| 旧插件 shim 变成永久分支 | `legacy/` 目录 + 删除门禁 + 下个大版本移除；CI 禁止新 adapter import |
| 迁移期出现“临时代码永久化” | 每个 adapter 的 `legacy.ts` 有删除门禁；Phase 4 CI 守卫 |
| 能力漂移 | capabilities 从 transport/channels 派生，plugin-check 校验 |

## 12. 验收标准

- [ ] `gateway/src/runtime` 只含中性契约；`gateway/src` 无 runtime 协议分支。
- [ ] `adapters/opencode`、`adapters/pi`、`adapters/claude` 全部通过 `defineRuntime` 注册。
- [ ] `AdapterEvent` v1 33 变体 + schema 校验 + mapper。
- [ ] `RuntimeTransport` v1 + fake driver 通过。
- [ ] `RuntimeChannels` v1 覆盖 80%+ runtime 功能面；v2 channels（MCP / discovery / instructions / PTY / checkpoint / background）同批交付，opencode 无功能回退。
- [ ] 每个 adapter 有 golden 事件序列测试；v2 channels 有桌面冒烟。
- [ ] `plugin-check --preset` / `plugin-test` 通过。
- [ ] 旧插件兼容 shim 工作，且 `plugin-check` 给出 `legacy-plugin` 警告；下个大版本删除。
- [ ] CI 守卫：无 `native`、无 `payload.properties`、无 runtime 协议名、内置 runtime 全走 defineRuntime。
- [ ] 前端无 runtime 名/原生字段业务分支（WSL/主题等功能名白名单）。
- [ ] `native` 分支在最终代码中不存在。

## 13. 已裁决

### Q1：v2 channels 与 v1 同批交付（已确认）

MCP / Discovery / Instructions / PTY / Checkpoint / Background 与 v1 同一批交付；Phase 4 删除 gateway 旧代码前，这些 v2 channels 必须全部绿，桌面无功能回退。

### Q2：旧 `createRuntime(ctx)` 插件保留一个发布周期的 shim（已确认）

generic 兼容桥，不是 vendor native；下个大版本删除。见 §9 Phase 4.1。

## 14. 留给 builder 的决定

- `AdapterEvent` 各变体的具体 JSON Schema 写法（TypeBox/Zod/手写）。
- `RuntimeBus` 的注册表/生命周期实现细节。
- golden fixture 的存放位置与命名。
- 通用进程监督器的接口（只服务 opencode 还是也服务未来 CLI runtime）。
- 前端 DTO 字段改名的时间点与兼容策略。

以上不影响本 spec 的边界与验收。
