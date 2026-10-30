# Runtime 契约覆盖矩阵（Coverage Manifest）与 JSON 导出设计

日期：2026-10-30
状态：Draft（待评审）
调研：
- `docs/superpowers/specs/2026-10-22-contract-gap-research/`（业界能力缺口，59 条）
- 本文补充的是**契约形状/覆盖模型**，不是重复上述能力缺口研究
相关：
- `gateway/src/runtime/contract.ts`（当前能力位与 RuntimeClient）
- `gateway/src/runtime/validate.ts`（声明 vs 实现校验）
- `gateway/src/runtime/loader.ts`（插件加载与事件映射校验）
- `gateway/src/runtime/host-adapter.ts`（认知面六动词）
- `gateway/src/runtime/conformance-scenarios.ts`（现有 6 个场景）
- `adapters/claude/`（第三方 runtime 的真实样本）
- `.opencode/skills/runtime-plugin-authoring/SKILL.md`（现有作者指南）

## 1. 意图与 Why

用户的目标：

> runtime 契约要能通过插件把不同 agent 平台的 SDK 接进来。但在用其他 agent 开发插件时，发现很多面会漏掉或实现不好——这看起来是契约还不够完善。

这句话需要拆成两个不同的问题：

1. **能力缺口**：业界有、我们没有的动词/字段/事件（gate/rewrite、outputSchema、tool annotations、持久事件历史、队列 inbox……）。`06-gap-synthesis.md` 已列出 59 条，解法是“加能力”。
2. **覆盖缺口**：契约允许插件只实现一部分，而且不告诉作者漏了什么；插件能通过加载与校验，但桌面/记忆/审批/身份等面静默降级。用户说的“很多面会漏掉”主要是这一类。

本设计解决第 2 类。当前契约的根因不是“方法不够多”，而是**契约只有方法集合，没有完整性定义**：

- 可选方法用 `?`，`capabilities` 默认 false；缺失是合法状态，gateway 静默降级（503 / skip），没有“你漏了”的信号。
- `validate.ts` 只回答“你声明为 true 的能力有没有对应方法”，不回答“一个可用 runtime 应该覆盖哪些面”；hard 面只有 11 个 session 方法 + `tools` + `eventStream` 的 `global.event`。
- 作者指南是散文，与代码不同源；人和 AI 都按文档实现，文档没写的面就漏。
- 没有 per-domain 的行为级 conformance；现有 6 个场景只覆盖 chat/lifecycle/cognition/identity/tool-visibility 的一部分。

真实样本：`adapters/claude/src/runtime.ts` 能通过 loader 与 `validate.ts`，但缺：

| 面 | 现状 | 后果 |
|---|---|---|
| `session.update` | 没有 | 会话改名 503 |
| `fork/revert/unrevert` | 没有 | 时间线/回滚不可用 |
| `session.diff` / `vcs` | 没有 | 审阅改动不可用 |
| `permissionReply/List` | 没有（`nativeApprovals:false`） | 审批卡永远空 |
| `question` | 没有 | 结构化问答不可用 |
| `discovery` / `mcp` | 没有 | 命令/技能/MCP 管理不可见 |
| `completion` | 没有 | index-scan/media 无状态通道降级 |
| `agents.install` | 没有 | manager/curator 身份不物化 |
| `prompt` 返回值 | `{parts:[]}`，无 usage/stopReason/structured | 成本、预算、结构化交卷全丢 |
| `parts` | 只取 text | 图片/视频/音频附件被静默丢弃 |
| `tools.registerTools` | `__mafwStub` 占位 | 六件套可能根本没进模型工具面 |
| `children/todo/summarize` | 空实现 | 子代理/计划/压缩 UI 空转 |
| `delete` | 只删内存 Map | 持久会话没删 |

这不是作者粗心，是契约允许它这样。本设计把契约从“方法袋”升级为**覆盖矩阵**：每个面都有稳定的 id、方向、义务、实现探针、消费者、缺失影响和验证场景；`validate`、覆盖率报告、conformance、JSON 导出都是同一份清单的投影。

## 2. 已确认决策

| 决策 | 内容 | 来源 |
|---|---|---|
| 用户确认 | **baseline 硬门禁；gated 面分级放行 + 覆盖率可见**。不要求一个 runtime 全绿。 | 用户 2026-10-30 “可以” |
| 单一事实源 | 清单用 TypeScript const 定义在 gateway 源码里；JSON 是生成产物，不是第二事实源。 | 本设计 |
| 三轴分类 | 方向（谁调谁）× 义务（required/gated/optional/advisory）× 域（session/prompt/events/...）。 | 本设计 |
| Tier 退化 | 旧 Tier 0/1/2 不再是层级，变成**域预设**（core/conversation/autonomous/desktop）。 | 本设计 |
| 向后兼容 | 现有 `capabilities` 布尔面保留；老插件不改也能加载；清单是增量语义。 | 本设计 |
| 信任声明分离 | `turnBudgetApi` 这类无法探针的声明标记为 `attested`，不混进“已实现”。 | 本设计 |
| 覆盖双通道 | **静态覆盖**（presence/declaration）始终计算、不调 runtime；**行为覆盖**（确定性 probe + conformance）按需运行，不阻塞激活。 | 本设计（builder check #1） |
| 声明面输入 | `computeCoverage` 接收 `ContractSubject`：runtime 实例 + loader/内置事件声明（`EventMappingEntry`）+ dialect。opencode 的 `resolveEventEntry()` 在激活时解析后存入 subject。 | 本设计（builder check #2） |
| 条件 required | `required` 支持 `requiredWhen.capabilities`（all-of）；`global.event` 在 `eventStream` 下 hard，`providerConfigApi` 的 provider/app/config 三方法保持 hard。预设只影响覆盖率，不参与 hard 判定。 | 本设计（builder check #3/#5） |
| 降级判定 | 只有 `capability.requires` 列出的面缺失才降级该能力；`capability.unlocks` 里的其他面缺失只记 warning/覆盖率。保留今天 `nativeApprovals` 的 AND-group 语义。 | 本设计（builder check #6） |
| 事件清单来源 | `events` 节从现有三源投影，不新增第四张表：类型来自 `MAFW` 词汇，requiredFields 来自 `event-field-contract.ts`，family 按前缀派生，consumers 来自 `EVENT_FLOW_MATRIX` + 小映射。 | 本设计（builder check #7） |
| JSON 落点 | `packages/gateway-sdk/contract/runtime-contract.json`（与 `gateway-paths.json` 同目录、同 check-in 模式）。 | 本设计 |
| 运行时自描述 | `GET /api/runtime/contract` 返回清单 + 当前 runtime 覆盖率；`GET /api/runtime` 增 `active.coverage`。 | 本设计 |

## 3. 目标 / 非目标 / 反目标

### 目标

- G1：一份机器可读清单覆盖 runtime 契约的所有公开面（编排面、认知面、声明面、事件面）。
- G2：插件作者（人或 AI）能直接回答：我必须实现什么、可选什么、缺了什么会导致哪个功能不可用。
- G3：激活校验由清单驱动，删除 `validate.ts` 里的手写表；不再出现“改了 contract 忘了改 validate”。
- G4：激活后可看到覆盖率：按 preset 和域给出 covered/total、缺失面、影响与验证方式。
- G5：导出带版本的 JSON + JSON Schema；产物新鲜度由测试钉扎；外部工具/插件作者可直接消费。
- G6：把 `adapters/claude` 作为验收样本：跑覆盖率能列出上述缺口，并按域给出补齐优先级。

### 非目标

- N1：不把 `06-gap-synthesis.md` 的 59 条能力缺口全部实现；本设计只定义“如何表达与检查覆盖”。
- N2：不替 conformance 做行为级自动激活门禁（会消耗真实 LLM 往返）；行为场景仍由 `mafw plugin-check` / `POST /api/runtime/conformance` 显式触发。
- N3：v1 不做插件脚手架生成器（`mafw plugin-init` 留 P3）；先把清单和覆盖率做对。
- N4：不改变现有 canonical 事件词汇；只给事件补 family/requiredFields 元数据。
- N5：不强制所有 runtime 实现全部面；小 runtime 可以只覆盖 core，但缺口必须可见。
- N6：不把 gateway 内部的 goal/scheduler/automation 面写进 runtime 契约；它们不是插件义务。

### 反目标

- 清单变成第二事实源，和 `contract.ts` 类型漂移。
- required 面定得过大，导致只有 opencode 能激活，插件生态死掉。
- 覆盖率变成虚荣指标：只报百分比，不报缺什么、影响什么。
- 又回到 23 个 boolean flag 平铺；能力必须是域内的可选增量。
- 为了“完整”把 Claude adapter 这类真实插件直接判死，而不是分级放行。
- 行为级 conformance 在每次激活时自动跑，启动变慢且烧 token。

## 4. 业界分类基准

| 规范 | 主分类轴 | 对本设计的直接借鉴 |
|---|---|---|
| **ACP（Agent Client Protocol）** | 谁实现哪个方法 + baseline/optional | 两侧各一张能力表；baseline 方法规范强制；optional 方法必须由 capability 显式声明；未声明 = 不支持，调用方 **MUST NOT** 调用 |
| **A2A 1.0** | 数据模型 / 操作 / 绑定 三层 | 清单属于“数据模型 + 操作”层，不绑定 CJS/HTTP 实现；AgentCard 是可发现的 JSON；未声明能力调用返回 `UnsupportedOperationError` |
| **MCP 2026-07-28** | 原语 + 双向协商 | `capabilities` 按原语分组的对象（tools/resources/prompts），不是 boolean 平铺；客户端/服务端两侧各自声明；扩展单独协商 |
| **AG-UI** | 事件目的族 | Lifecycle / Text / ToolCall / State / Activity / Subagent / Reasoning / Special；Start-Content-End 与 Snapshot-Delta 两种模式；自定义事件是一等公民 |
| **AI SDK provider spec** | 低层模型接口 | `specificationVersion` 显式；`doGenerate`/`doStream` 两方法；stream part 是可判别联合；可选字段用 undefined 而非报错 |
| **OpenAI Responses** | 输出项生命周期 | 事件名分层（`response.output_item.added/done`、`output_text.delta/done`）；每条事件带稳定关联 id + `sequence_number` |
| **Claude / OpenAI Agents SDK** | 高层构件 | 执行循环（agent/run/handoff/guardrail）、上下文（sessions/memory）、观测（tracing）、策略（permissions/sandbox）分开；策略与能力正交 |

收敛出的规则（本设计采用）：

1. **baseline 规范强制，capabilities 只表示可选增量。**
2. **能力是双向的**：gateway→runtime 与 runtime→gateway 各自声明；未声明即不支持。
3. **按域/原语分组**，能力 key = 域，value = 子特性。
4. **数据模型 / 操作 / 绑定分离**；插件清单只描述前两层。
5. **事件按目的族 + 生命周期模式**；终态显式。
6. **版本 + 发现 + 失败语义**；未声明能力调用返回明确错误，不静默 503。
7. **策略/信任声明与能力正交**；`turnBudgetApi` 不是“功能”，是“信任”。

## 5. 契约分类模型

### 5.1 三轴

**方向（direction）**——谁调谁：

| 值 | 含义 | 例子 |
|---|---|---|
| `gateway->runtime` | gateway 调用 runtime 的方法 | `session.promptAsync`、`session.fork` |
| `runtime->gateway` | runtime 宿主调用 gateway 的 loopback HTTP | `POST /api/obs/capture`、`GET /api/recall/context` |
| `declaration` | 插件模块导出/纯数据声明 | `name`、`capabilities`、`eventMappings`、`nativeTools` |

事件面单独成节（`events`），因为它的生产者是 runtime、消费者是 gateway/UI，方向不是简单的“谁调谁”。

**义务（obligation）**——缺了会怎样：

| 值 | 语义 | 激活期行为 | 覆盖率 |
|---|---|---|---|
| `required` | 契约必选面（可带 `requiredWhen` 条件） | 条件成立且缺失 → hard 失败，回退内置 runtime | 必须 100% |
| `gated` | 由 capability 门控的可选面 | capability 声明 true 且该面在 `capability.requires` 中 → 降级 false + note；不在 `requires` 中 → 单独 503/禁用 + warning | 计入对应 preset |
| `optional` | 无 capability 的独立可选面 | 缺失 → 该功能 503/禁用 + warning | 计入覆盖率但不阻断 |
| `advisory` | 建议实现，不影响核心 | 缺失 → warning | 单独列“建议项” |

`requiredWhen` 只支持 capability 条件（all-of），目前两处使用：

- `global.event` / 事件信封：`requiredWhen: { capabilities: ['eventStream'] }`——声明了事件流却没有事件流方法仍是 hard（与今天一致，不是静默降级）。
- `provider.list` / `app.agents` / `config.get|update`：`requiredWhen: { capabilities: ['providerConfigApi'] }`——保持今天 `validate.ts` 的 hard 语义。

预设（`presets`）**不参与 hard 判定**；它只决定覆盖率的分母。一个 runtime 可以激活但不满足 `desktop` 预设。

**域（domain）**：

`meta` / `session` / `prompt` / `events` / `tools` / `approval` / `identity` / `discovery` / `mcp` / `branch` / `process` / `provider` / `cognition` / `media` / `usage`

域是清单的默认分组，也是 UI 和文档的默认排序；**一个面只属于一个域**。

### 5.2 能力类型（capability kind）

能力位不只是 boolean，还要标明它是什么：

| kind | 含义 | 例子 | 校验方式 |
|---|---|---|---|
| `feature` | 真正的可选功能 | `eventStream`、`nativeApprovals`、`diffApi` | presence + conformance |
| `transport` | 传输/协议变体 | `steerApi`、`instructionsApi` | presence + conformance |
| `strategy` | 实现策略（有替代路径） | `sessionStorageApi`、`mcpConfigApi` | presence；缺失走回退 |
| `trust` | 无法探针的信任声明 | `turnBudgetApi` | `attested`；覆盖率标“未验证” |
| `informational` | 只做信息性声明 | `perLlmCallTransform` | 不消费，不计入覆盖率 |

### 5.3 预设（preset）

预设是**域/能力的组合**，不是新的层级。旧 Tier 0/1/2 映射：

| preset | 旧 Tier | 最小体验 | 必须覆盖 |
|---|---|---|---|
| `core` | Tier 0 | headless 协作/记忆 worker | session 11 方法 + prompt + tools + meta |
| `conversation` | Tier 1 | 聊天流式 + 用量 | core + eventStream + turn/part 事件 + prompt usage |
| `autonomous` | Tier 1+ | goal 编排/自治执行 | conversation + approvals/questions + promptWhileBusy + queue 语义 |
| `desktop` | Tier 2 | 桌面完整 | autonomous + identity + discovery + mcp + branch/diff + completion + instructions |

预设只定义“这个体验至少需要什么”，不要求所有面都实现；`desktop` 也不强制 `diffApi`（审阅面板可以禁用），但覆盖率会显示缺口。

## 6. 清单数据模型

### 6.1 顶层

```ts
export interface RuntimeContractManifest {
  schemaVersion: 1;
  contractVersion: string;          // 例如 '2026.10.0'
  generatedFrom: 'gateway/src/runtime/contract-manifest.ts';
  domains: Array<{ id: ContractDomain; title: string; description: string }>;
  surfaces: ContractSurface[];
  capabilities: ContractCapability[];
  events: ContractEvent[];
  cognition: CognitionVerb[];
  presets: ContractPreset[];
}
```

### 6.2 Surface

```ts
export type ContractDirection = 'gateway->runtime' | 'runtime->gateway' | 'declaration';
export type ContractObligation = 'required' | 'gated' | 'optional' | 'advisory';
export type Verification = 'presence' | 'behavior' | 'conformance' | 'attested';
export type ContractDomain =
  | 'meta' | 'session' | 'prompt' | 'events' | 'tools' | 'approval'
  | 'identity' | 'discovery' | 'mcp' | 'branch' | 'process' | 'provider'
  | 'cognition' | 'media' | 'usage';

export interface ContractSurface {
  id: string;                       // 稳定点号 id，例如 'session.update'
  title: string;
  direction: ContractDirection;
  domain: ContractDomain;
  obligation: ContractObligation;
  capability?: string;              // obligation='gated' 时必填
  requiredWhen?: { capabilities: string[] }; // obligation='required' 时的 all-of 条件
  verification: Verification;
  implementation: string;           // 'session.update' 或 'POST /api/obs/capture'
  probe?: string[];                 // presence 探针路径，例如 ['session','update']
  behavior?: string;                // 确定性行为探针 id（不调 LLM）
  consumer: string;                 // 例如 'PATCH /api/sessions/:id'
  impact: string;                   // 缺失时用户失去什么（一句话）
  conformance?: string[];           // 场景 id，例如 ['session-lifecycle']
  presets?: PresetId[];             // 哪些预设期望它
  since?: string;                   // 加入版本
  deprecated?: boolean;
}
```

约束：

- `id` 一旦发布不可改名；改名 = 新 id + `deprecated` 旧 id。
- `obligation='gated'` 必须有 `capability`；`required/optional/advisory` 不得有；`requiredWhen` 只允许出现在 `required` 上。
- `verification='presence'` 必须有 `probe`；`behavior` 必须有 `behavior`；`conformance` 必须有 `conformance`；`attested` 不得有 `probe`。
- `probe` 的第一段是 `rt` / `declaration` / `plugin`：`session.update` → `['session','update']`，声明面 → `['declaration','eventMappings']`，loader 元数据 → `['plugin','createRuntime']`。`probePasses` 按第一段选 `ContractSubject.rt` / `.declaration` / `.plugin`。
- `gated` 面即使 `capability=true`，只要不在该 capability 的 `requires` 中，缺失只记 warning，不降级能力（保留 `nativeApprovals` 的 `permissionList` 语义）。
- `runtime->gateway` 的 `probe` 为空，`implementation` 写 HTTP 方法与路径；验证靠 behavior/conformance。
- `behavior` 与 `conformance` 都不在激活期自动运行；由 `mafw plugin-check` / `POST /api/runtime/conformance` 触发。

### 6.3 Capability

```ts
export type CapabilityKind = 'feature' | 'transport' | 'strategy' | 'trust' | 'informational';

export interface ContractCapability {
  id: string;                       // keyof RuntimeCapabilities
  title: string;
  domain: ContractDomain;
  kind: CapabilityKind;
  default: boolean;                 // minimalCapabilities 的默认值
  requires: string[];               // AND-group：缺任一 → 降级该能力（保留今天语义）
  unlocks: string[];                // 该能力解锁的 surface；不参与降级判定
  degrade: string;                  // false/降级时的行为
  degradeRule?: 'any-requires-missing' | 'none'; // 缺省 any-requires-missing
  presets?: PresetId[];
}
```

`requires` 就是现在 `validate.ts` 的 `CAPABILITY_REQUIREMENTS`，但变成清单数据；`unlocks` 让“这个能力到底给我什么”可读。

关键区分（builder check #6）：**`requires` 决定是否降级，`unlocks` 只做展示与覆盖率。** 今天 `nativeApprovals` 只要求 `session.permissionReply`；`session.permissionList` 缺失只产生 warning（审批卡轮询为空，但审批本身仍可用）。清单必须保留这个 AND-group：

```ts
{
  id: 'nativeApprovals',
  requires: ['session.permissionReply'],
  unlocks: ['session.permissionReply', 'session.permissionList', 'events.permission.asked'],
  degrade: '审批端点 503；桌面审批卡不出现',
}
```

`requires` 为空表示该能力没有可探针的硬实现（只能 `attested`/conformance）。`eventStream` 的硬门禁放在 `global.event.requiredWhen: { capabilities: ['eventStream'] }`，不在 `requires` 里重复；否则“缺 global.event”会同时触发 hard 与 downgrade，语义混乱。

`eventStream` 的声明面是 **OR**（`eventMappings` 或 `transformEvent` 至少一个），`requires` 的 AND 表达能力不足。这一条保留 `loader.validateEventMappings` 的特例：声明 eventStream 但两者都没有 → 降级 eventStream；清单里 `plugin.eventSource/eventMappings/transformEvent` 面标 `gated` + `degradeRule: 'none'`，由 loader 特例负责降级并在 note 里写明。P2 如果出现更多 OR 需求，再加 `requiresAny` 字段。

### 6.4 Event

```ts
export interface ContractEvent {
  type: string;                     // canonical type，例如 'turn.completed'
  family: 'lifecycle' | 'message' | 'tool' | 'approval' | 'question'
        | 'state' | 'usage' | 'compaction' | 'custom';
  terminal?: boolean;
  requiredFields: string[];         // 例如 ['sessionID']
  producers: Array<'runtime' | 'gateway' | 'host'>;
  consumers: string[];              // 例如 ['goal driver','memory drain','desktop']
  conformance?: string[];
}
```

事件清单与 `packages/gateway-sdk/src/events.ts`、`gateway/src/runtime/mafw-vocabulary.ts` 交叉钉扎；新增/删除类型必须三处同步（沿用 `vocabulary-sync.test.ts` 的模式）。

**不新增第四张并行表**（builder check #7）：`buildEventsSection()` 从现有三源投影——

- `type`：`MAFW_RUNTIME_EVENT_NAMES` + `MAFW_FLAT_EVENT_NAMES`；
- `requiredFields`：从 `event-field-contract.ts` 的 `checkEventFields` 分支抽取（P0 先手写一份 `EVENT_REQUIRED_FIELDS` 常量并加测试对照；P1 再考虑重构 `checkEventFields` 以导出元数据）；
- `family`：按前缀派生（`turn.` → lifecycle，`part.`/`message.` → message，`permission.` → approval，`question.` → question，`plan.`/`run.`/`session.config`/`session.checkpoint` → state，`usage.` → usage，`session.compact*` → compaction，`plugin:*`/其他 → custom）；
- `consumers`：`EVENT_FLOW_MATRIX` 的 desktop/tui 处置 + 一张 gateway 消费方小映射（goal driver / memory drain / trajectory / BudgetGuard / queue）。

如果未来需要真正的单一来源，优先扩展 `EVENT_FLOW_MATRIX` 行而不是再加表；P2 的文档生成必须消费这个投影，不再手写事件表。

### 6.5 Cognition

```ts
export interface CognitionVerb {
  id: 'observe' | 'injectContext' | 'injectSystem' | 'tools' | 'gate' | 'rewrite';
  method: 'GET' | 'POST';
  path: string;
  timeoutMs: number;
  failOpen: string;                 // 例如 '超时=null，直接调 LLM'
  requiredFields: string[];
  presets: PresetId[];              // 哪些预设期望它（core 不要求）
  conformance?: string[];
}
```

认知面是 `runtime->gateway` 的义务，不放进 `RuntimeCapabilities`（那是 gateway→runtime 的声明）。插件如果没有宿主扩展，覆盖率会明确显示“cognition 未验证”，而不是假装完整。

### 6.6 Preset

```ts
export interface ContractPreset {
  id: 'core' | 'conversation' | 'autonomous' | 'desktop';
  title: string;
  description: string;
  requiredSurfaces: string[];       // 该预设必须存在的面（权威）
  capabilities: string[];           // 该预设必须声明为 true 的能力
}
```

`preset.requiredSurfaces` 是权威；`surface.presets` 是构建时派生的反向索引。测试必须校验双向一致（builder check #3 的副产品），避免两处各写一份。

### 6.7 Coverage

```ts
export type SurfaceStatus = 'present' | 'missing' | 'unverified';

export interface RuntimeCoverage {
  runtime: string;
  contractVersion: string;
  /** 静态覆盖：始终计算，不调 runtime。 */
  static: {
    declared: Record<string, boolean>;
    effective: Record<string, boolean>;
    presets: Record<PresetId, {
      required: number;
      covered: number;
      missing: string[];            // surface ids
    }>;
    obligations: Record<ContractObligation, {
      total: number;
      present: number;
      unverified: number;
      missing: string[];
    }>;
    surfaces: Record<string, {
      status: SurfaceStatus;
      verification: Verification;
      impact: string;
    }>;
    missing: Array<{
      id: string;
      domain: ContractDomain;
      obligation: ContractObligation;
      verification: Verification;
      impact: string;
    }>;
    unverified: Array<{
      id: string;
      reason: string;               // attested / cognition / behavior-not-run
    }>;
    notes: string[];                // 降级/警告
  };
  /** 行为覆盖：仅在 plugin-check / conformance 运行后存在。 */
  behavioral?: {
    scenarioResults: Array<{ id: string; pass: boolean; failures: string[] }>;
    verified: string[];             // surface ids
    failed: string[];               // surface ids
    unverified: string[];           // 未跑到的 behavior/conformance surface ids
    details: Record<string, string>; // surfaceId → 失败/验证说明
  };
}
```

`static.surfaces` 是唯一的逐面状态源；`presets/obligations/missing/unverified` 都是它的聚合。`behavioral` 不覆盖 `static` 的 presence 判定——两者并列，UI 显示“已实现 / 行为已验证 / 未验证”三个数。

覆盖计算的输入不是裸 runtime（builder check #2）：

```ts
export interface ContractSubject {
  rt: AgentRuntime;
  /** loader 文件插件 meta / builtin extras / package entry；opencode 为 resolveEventEntry() 结果 */
  declaration?: EventMappingEntry;
  /** loader 级插件元数据（meta.plugin 面用）；active runtime 从 loader.get(name) 取 */
  plugin?: { name?: string; createRuntime?: Function; external?: boolean; capabilities?: unknown };
  /** 当前方言（opencode 自适应探测结果；其他 runtime 缺省） */
  dialect?: string;
  source: 'file' | 'builtin' | 'package' | 'active';
}
```

`declaration` 用来判断 `plugin.eventSource/eventMappings/transformEvent` 面；`source` 用来区分“未激活的扫描件”和“当前 active runtime”。`GET /api/runtime/contract` 只算 active；`mafw plugin-check` 可算任意扫描件。

## 7. 初始覆盖面清单（域级）

> 这是 v1 清单的起点；实现时按 `contract.ts` 的公开方法面逐项补齐。义务与门控列是**设计判定**，不是对现有插件的判决。
>
> 表中「面」列是分组缩写；落地时拆成稳定 id（如 `session.delete.persisted`、`prompt.result.usage`），一个 surface 只验证一件事，避免“方法存在 = 行为正确”的假阳性。

| 域 | 面 | 义务 | 门控 | 验证 | 缺失影响 |
|---|---|---|---|---|---|
| meta | `plugin.name` / `plugin.createRuntime` | required | — | presence | loader 直接拒绝 |
| meta | `plugin.capabilities` | required | — | presence | 按 minimal 默认，功能大幅缩水 |
| meta | `plugin.eventSource` / `eventMappings` / `transformEvent` | gated | `eventStream` | presence | 无翻译声明 → eventStream 降级 |
| session | `session.create/get/list/delete/abort/messages/todo/children/summarize` + `prompt/promptAsync` | required | — | presence | 会话/回合不可用 |
| session | `session.delete` 持久化语义 | optional | — | behavior/conformance | 只删内存，会话在 list/get 复活 |
| session | `session.update`（rename） | optional | — | presence | 改名 503 |
| session | `session.listByDirectory` | gated | `sessionStorageApi` | presence | worktree/项目会话列表回退全量拉取 |
| session | worktree：按 directory 创建/列出 | gated | `worktreeApi` | conformance | worktree 并行会话隔离失效 |
| branch | `session.fork/revert` | gated | `sessionBranchApi` | presence | 时间线/分叉/回滚不可用 |
| branch | `session.unrevert` | gated | `revertUndoApi` | presence | 回滚不可撤销 |
| branch | `session.diff` / `vcs.diff/apply` | gated | `diffApi` | presence | 审阅改动/工作区 patch 不可用 |
| session | `session.instructions.list/put/remove` | gated | `instructionsApi` | presence | 指令分段/压缩免疫不可用 |
| session | `session.switchAgent/switchModel/setThinkingLevel` | optional | — | presence | 会话内切换 503，UI 需回退 per-prompt |
| session | `session.shell.create/get/output/remove` | optional | — | presence | 后台 shell 不可用 |
| branch | `checkpoint` / `runState` | gated | `checkpointApi` / `runStateApi` | attested/conformance | 时间线检查点/软暂停不可用；无专属方法，靠行为场景 |
| prompt | `prompt.parts`（text） | required | — | presence | 回合无输入 |
| prompt | `prompt.parts`（file: image/video/audio） | optional（P0 不加 flag） | — | behavior/conformance | 媒体附件被静默丢弃 |
| prompt | `prompt.agent/model/variant/system` | optional | — | behavior | per-prompt 覆盖不生效 |
| prompt | `prompt.thinkingLevel` | optional（P0 不加 flag） | — | behavior | 推理档位不生效 |
| prompt | `prompt.delivery`（steer） | gated | `steerApi` | conformance | busy 纠偏退化为普通消息 |
| prompt | `prompt.expectReply` | optional | — | behavior | 免回复通知可能触发回复 |
| prompt | `prompt.maxTurns/maxCostUsd` | gated | `turnBudgetApi` | attested | 原生预算不生效；gateway BudgetGuard 兜底 |
| prompt | `prompt.outputSchema` | optional（P0 不加 flag） | — | behavior/conformance | 结构化交卷不校验 |
| prompt | `prompt.result.finish/stopReason` | optional | — | behavior | 终态分类缺失，重试/降级无依据 |
| prompt | `prompt.result.usage` | optional | — | behavior | 成本/用量不可见 |
| events | `global.event` | required | `requiredWhen: eventStream` | presence | 无事件流（声明了 eventStream 则 hard） |
| events | 事件信封形状 + `type` 非空 | optional（preset: conversation） | — | behavior | 事件全部畸形/被拦 |
| events | `turn.started/completed/failed/aborted` | optional（preset: conversation） | — | conformance | UI 永远 busy / 回合不结算 |
| events | `part.updated` / `part.delta`（text） | optional（preset: conversation） | — | conformance | 不能流式渲染 |
| events | `part.updated`（tool 三原语/快照） | optional（P0 不加 flag；preset: desktop） | — | conformance | 工具调用不可见 |
| events | `usage.updated` | optional | — | conformance | 用量只靠 prompt result |
| events | `session.compacting/compacted` | optional | — | conformance | 压缩 flush 延迟 |
| events | `permission.*` / `question.*` | gated | `nativeApprovals` / `questionApi` | conformance | 审批/问答卡不出现 |
| tools | `tools.registerTools` | required | — | presence | 六件套无路可达模型 |
| tools | `tools.nativeTools` | required | — | presence | 工具类别回退并集表（可接受但需声明） |
| tools | tool annotations（readOnly/destructive/…） | optional | — | presence | 审批/UI 失去风险提示 |
| tools | structured tool result（outputSchema/structuredContent） | optional | — | conformance | 工具结果只能是文本 |
| tools | `session.normalizeMessages` | optional | — | conformance | 历史工具卡不渲染 |
| tools | out-of-process `/api/tools` + `/api/tools/execute` | optional | — | conformance | 进程外 runtime 无法用六件套 |
| approval | `session.permissionReply` | gated（在 `nativeApprovals.requires`） | `nativeApprovals` | presence | 审批决定无法回传 |
| approval | `session.permissionList` | gated（不在 `requires`，只 warning） | `nativeApprovals` | presence | 审批轮询为空 |
| approval | `session.question.list/reply/reject` | gated | `questionApi` | presence | 结构化问答不可用 |
| identity | `agents.install` / `agents.remove` | gated | `agentConfigApi` | presence | manager/curator 身份不物化 |
| identity | `prompt.agent` 绑定 | optional | — | conformance | 身份选择不生效 |
| discovery | `discovery.list` / `loadSkill` | gated | `discoveryApi` | presence | 命令/技能目录不可见 |
| mcp | `mcp.list/connect/disconnect` | gated | `mcpApi` | presence | MCP 运行时管理不可用 |
| mcp | `mcp.config.preview/apply/remove/restore` | gated | `mcpConfigApi` | presence | MCP 配置写入不可用 |
| process | `getBaseUrl` / `healthCheck` | advisory | — | presence | 健康探测/反代回退 |
| process | `agentProcess.restart/spawnServe/killServe` | gated | `agentProcessApi` | presence | 自监管/server 拉起不可用 |
| process | `resolveEventEntry` / `activeDialect` | optional | — | conformance | 方言感知退化为静态表 |
| provider | provider.list / app.agents / config.get\|update | required | `requiredWhen: providerConfigApi` | presence | 桌面设置/provider 管理不可用 |
| cognition | observe / injectContext / injectSystem / tools | optional（presets: conversation/autonomous/desktop） | — | conformance | 记忆蒸馏空转、recall 不注入（不 hard，宿主面无法探针） |
| cognition | gate / rewrite | optional | — | conformance | 无工具前门控/输出改写 |
| media | `mafw_media_*` 六件套经 `registerTools` | optional（preset: desktop；P0 不加 flag） | — | conformance | 媒体工具不可达 |
| usage | prompt usage / `usage.updated` | optional | — | conformance | 成本/上下文统计缺失 |

> **P0 不新增** `mediaInputApi` / `thinkingLevelApi` / `turnOutputSchemaApi` / `toolVisibilityApi` 四个能力位——用 `optional` + behavior/conformance 表达，避免又回到 boolean 平铺。P2 如果发现某个面需要“声明 false 才能正确降级”，再补 flag 并升 contractVersion。

> 表中的 `behavior/conformance`、`attested/conformance` 表示**分阶段验证**；清单里一个 surface 只能有一个 `verification`。P0 取前者（确定性探针/声明），P2 再把同一 surface id 的 `conformance` 场景补上（`verification` 可改为 `behavior` 且额外带 `conformance` 列表，或拆成 `*.live` 新 id）。

## 8. 校验与覆盖率语义

### 8.1 激活期（validate.ts）

```
for surface of manifest.surfaces:
  if surface.verification !== 'presence':
      markUnverified(surface); continue   // behavior/conformance/attested：激活期不探针
  if surface.obligation === 'required':
      if requiredWhenSatisfied(surface, caps) && !probePasses(subject, surface):
          hard.push(...)
  else if surface.obligation === 'gated':
      const cap = caps[surface.capability]
      const inRequires = capabilityOf(surface.capability).requires.includes(surface.id)
      if cap && inRequires && !probePasses(subject, surface):
          downgrade(surface.capability, surface.impact)
      else if cap && !probePasses(subject, surface):
          warnings.push(...)          // 个别面 503/禁用，不降级能力
  else if surface.obligation === 'optional':
      if !probePasses(subject, surface): warnings.push(...)
  else if surface.obligation === 'advisory':
      if !probePasses(subject, surface): warnings.push(...)
```

- `requiredWhenSatisfied`：`surface.requiredWhen.capabilities` 全部为 true；为空 = 无条件。
- `required` 缺失 → 保持现有 hard 语义：回退内置 runtime，错误消息带 surface id + impact。
- `gated` 且在该 capability 的 `requires` 中缺失 → 降级该 capability，不整体失败；`validationNotes` 记录 surface id + impact。
- `gated` 但不在 `requires` 中缺失 → 只 warning（如 `permissionList`），能力保持 true；`suppressWarning: true` 的 unlocks-only 面（如 `identity.agents.remove`）只进覆盖率，不写 activation warning。
- `optional` 缺失 → 不降级任何 capability；进覆盖率缺口；激活期 warning 只对 `WARN_ON_MISSING` 子集（`session.update` / `healthCheck` / `getBaseUrl`）发出，保持旧行为。
- `advisory` 缺失 → warning。
- `verification='behavior'` / `'conformance'` / `'attested'`：激活期**不探针**，`static.surfaces` 标 `unverified`；行为结果由 `mafw plugin-check` / conformance 写入 `behavioral`。

**required 集合保持最小**（与今天一致）：11 个 session 方法 + `tools.registerTools` + `tools.nativeTools` + `global.event`（`requiredWhen: eventStream`）+ `provider.list`/`app.agents`/`config.get|update`（`requiredWhen: providerConfigApi`）。其余全部 gated/optional/advisory，避免把现有插件判死。

### 8.2 覆盖率

```
static.surfaces[id] = status:
  - present      : verification=presence && probePasses
  - missing      : verification=presence && !probePasses
  - unverified   : verification in (behavior,conformance,attested) && 尚无 behavioral 结果
  (verified/failed 只存在于 behavioral 通道，不回写 static)

static.presets[p] = {
  required: count(preset.requiredSurfaces[p]),
  covered: count(preset.requiredSurfaces[p] where status=present),
  missing: [surface ids where status=missing]
}
static.obligations[o] = { total, present, unverified, missing }
static.missing = 所有 required/optional/advisory 缺失 + gated 但 capability=false 的面
static.unverified = attested/cognition/behavior-not-run 的面
behavioral = { scenarioResults, verified, failed, unverified, details }  // 仅 plugin-check/conformance
```

- `gated` 面在 capability=false 时计入“缺失”，但不算错误。
- `attested` 面单列 `unverified`，不混进 covered。
- 静态覆盖率按 `probePasses` 计算 presence；行为覆盖由 `behavior` probe / conformance 结果写入 `behavioral`，不覆盖 `static.surfaces` 的 presence 结果。
- `cognition` 面永远不显示为 static present——gateway 自己提供端点，探针会假阳性；它们只能是 `unverified`，直到 `behavioral` 标记 verified/failed（跑过 S3/S4）。

### 8.3 未声明能力的调用语义

沿用现有 503，但错误体统一加：

```json
{ "error": "...", "surface": "session.fork", "capability": "sessionBranchApi", "impact": "时间线/分叉不可用" }
```

这样调用方和用户都知道“不是坏了，是没实现”。

## 9. JSON 导出与运行时自描述

### 9.1 产物

| 产物 | 路径 | 说明 |
|---|---|---|
| 清单 JSON | `packages/gateway-sdk/contract/runtime-contract.json` | check-in；由 emit 脚本生成 |
| JSON Schema | `packages/gateway-sdk/contract/runtime-contract.schema.json` | check-in；第三方校验用；用现有 `validateJsonSchema` 子集（避免 `$ref`） |
| 源 | `gateway/src/runtime/contract-manifest.ts` | 唯一事实源（TS const） |
| 生成器 | `gateway/scripts/emit-runtime-contract.ts` | `npm run emit:runtime-contract` |
| 新鲜度测试 | `gateway/tests/unit/runtime/contract-manifest-freshness.test.ts` | 产物与源不一致 → 红 |

JSON 顶层带 `$comment`（同 `emit-openapi`）：

```json
{
  "$comment": "Auto-generated by gateway/scripts/emit-runtime-contract.ts from gateway/src/runtime/contract-manifest.ts — do not edit by hand; rerun the script after manifest changes.",
  "$schema": "./runtime-contract.schema.json",
  "schemaVersion": 1,
  "contractVersion": "2026.10.0",
  ...
}
```

### 9.2 HTTP

| 端点 | 返回 |
|---|---|
| `GET /api/runtime/contract` | `{ manifest, coverage: { static, behavioral? } }`（manifest 为完整清单；coverage 为当前 active runtime 的覆盖率） |
| `GET /api/runtime` | 现有字段 + `active.coverage`（`static` 摘要；`behavioral` 只在跑过 conformance 时出现） |

- 路由登记进 `route-catalog.ts`（`runtime.contract`），跑 `emit:openapi`；SDK 新增 `runtime.contract()`。
- `GET /api/runtime/contract` 不触发 runtime 调用，纯内存读取；`behavioral` 由 `POST /api/runtime/conformance` 写入内存（不持久化）。
- `GET /api/runtime/contract?behavior=0` 可显式关闭 behavioral（默认有则返回）。

### 9.3 文档与 CLI

- `runtime-plugin-authoring` SKILL.md 增加“覆盖清单”章节，由清单生成的表格替换手写 Tier 表（P2；P0 先手工同步）。
- `mafw plugin-check [name]`（P2）：加载已安装插件 → 跑 validate → 打印按域分组的缺失面 + 影响 + conformance 建议；`required` 缺失 exit 1。
- `mafw plugin-check --module <path>`：对已构建的 CJS 文件跑同一检查（claude 验收用 `adapters/claude/dist/claude.js`；未构建则先提示 `npm run build`，不自动打包）。
- Config → Runtime 卡片显示覆盖率条 + 缺失面列表 + “复制 JSON”。

## 10. 与现有代码的接线

| 文件 | 改动 |
|---|---|
| `gateway/src/runtime/contract-manifest.ts` | 新增：清单源（surfaces/capabilities/events/cognition/presets） |
| `gateway/src/runtime/coverage.ts` | 新增：`computeCoverage(subject: ContractSubject, manifest)` 纯函数 + `probePasses`；`ContractSubject = { rt, declaration, dialect?, source: 'file'|'builtin'|'package'|'active' }` |
| `gateway/src/runtime/validate.ts` | 改为清单驱动；保留 `RuntimeValidation` 形状，新增 `staticCoverage` |
| `gateway/src/runtime/loader.ts` | 用清单校验 `eventSource/eventMappings/transformEvent` 与 `eventStream` 声明；错误消息带 surface id；`getEntry(name)` 已是声明面来源 |
| `gateway/src/runtime/event-field-contract.ts` | P0 导出 `EVENT_REQUIRED_FIELDS` 常量（与 `checkEventFields` 分支同源测试）；P1 再重构 |
| `gateway/src/runtime/event-flow-matrix.ts` | `EVENT_FLOW_MATRIX` 行增可选 `family`/`terminal`/`consumers`，或由 `buildEventsSection()` 派生；不新增平行表 |
| `gateway/src/runtime/conformance-scenarios.ts` | `ScenarioDef` 增 `covers: string[]`（surface ids）；补 approval/discovery/branch/identity/media/usage 场景（P2） |
| `gateway/src/routes/runtime-switch.ts` | `GET /api/runtime` 增 `active.coverage`；新增 `GET /api/runtime/contract` handler |
| `gateway/src/routes/route-catalog.ts` | 登记 `runtime.contract`；`emit:openapi` |
| `gateway/src/index.ts` | 激活时保存 `activeEventEntry`（含 builtin extras / `resolveEventEntry()` 结果）+ dialect；接线 coverage 计算 + contract handler；`validationNotes` 带 surface id |
| `packages/gateway-sdk/src/client.ts` | 新增 `runtime.contract()`；DTO 类型 |
| `packages/desktop/.../Config.tsx` | Runtime 卡片增覆盖率与缺失面（P1） |
| `adapters/claude/` | 新增 static coverage 验收测试 + 现有 `claude-adapter-acceptance.test.ts` 的 fake-SDK 行为探针；不要求立刻补齐所有面 |

**兼容性**：`RuntimeCapabilities` 类型不删字段；清单的 `capabilities` 与它一一对应。P0 不新增能力位；旧插件不受影响。`opencode`（自适应方言）与 `pi` 的 `effective` capabilities 必须与今天一致；允许新增 note，不允许新增 hard/downgrade（A2）。

## 11. 分阶段

### P0 —— 静态清单 + 导出 + 行为探针接口

- 建立 `contract-manifest.ts` 骨架，覆盖现有公开面（§7）。
- `coverage.ts` 静态覆盖纯函数 + `BehaviorProbe` 接口（执行器可注入；P0 只有 fake-SDK/假 runtime 实现，不调真实 LLM）。
- `emit-runtime-contract.ts` + JSON/Schema 产物 + 新鲜度测试。
- `GET /api/runtime/contract` + `GET /api/runtime` 的 `active.coverage.static`。
- `adapters/claude` static coverage 测试 + 现有 fake-SDK 行为探针（`prompt` 返回值、`parts`、`registerTools`）。
- 验收：opencode/pi 的 static coverage 符合预期；claude 列出已知缺口；现有测试全绿。

### P1 —— 校验切换 + 覆盖率 UI + 确定性行为探针

- `validate.ts` 改为清单驱动；hard/gated/optional/advisory + `requiredWhen` 语义落地。
- `computeCoverage(subject)` 接线 builtin/file/package 三种声明来源；opencode 的 `activeEventEntry` 保存。
- Config Runtime 卡片显示覆盖率 + 缺失面。
- `validationNotes` / 错误体带 surface id + impact。
- `mafw plugin-check` 的 **API 级确定性探针**（不调 LLM）：session.create/get/list/delete、registerTools 可调用性、nativeTools 返回值、delete 后 get/list 不可见。
- `prompt` envelope / `parts` 透传 / usage 这类需要真实回合的探针，放在 adapter fixture（fake SDK，如 claude 验收）或 P2 conformance；**不在 live plugin-check 里假装确定性**。
- 验收：opencode/pi 的 `effective` capabilities 与今天一致（允许新增 note，不允许新增 hard/downgrade）；claude 的 `sessionStorageApi` 降级与 §1 表一致。

### P2 —— 行为 conformance + CLI 全量 + 文档

- 场景覆盖 approval/discovery/branch/identity/media/usage；`covers` 映射。
- `mafw plugin-check [name|--module <path>]` 跑完整场景。
- SKILL.md 的 Tier 表改为清单生成。
- 验收：`mafw plugin-check --module <claude dist>` 输出按域分组的缺口与建议；退出码正确。

### P3 —— 脚手架

- `mafw plugin-init <name> --preset conversation` 从清单生成骨架（只含 required + 所选 preset 的 gated 面）。
- 不为 v1 承诺。

## 12. 验收

- A1：清单覆盖 `contract.ts` 的所有公开方法/命名空间；每个 surface 的 `probe` 能解析到 runtime 对象路径或 HTTP 端点。
- A2：`validate.ts` 的 `effective` capabilities 与今天一致：opencode/pi 不新增 hard/downgrade（允许新增 note）；claude 的降级项与预期一致。
- A3：`runtime-contract.json` 与源一致；Schema 校验通过；`GET /api/runtime/contract` 返回同样内容 + `static` coverage。
- A4：`GET /api/runtime` 的 `active.coverage.static` 对 core/conversation/autonomous/desktop 四个 preset 给出 covered/total/missing；`behavioral` 只在跑过 conformance 后出现。
- A5a（static）：claude adapter 的 static coverage 列出 presence 缺口——至少 `session.update`、`fork/revert`、`diff`、`permissionReply/List`、`question`、`discovery`、`mcp`、`completion`、`agents.install`。
- A5b（behavior）：claude adapter 的 fake-SDK 行为探针列出行为缺口——至少 `prompt.result.usage`、`prompt.parts.file`、`tools.registerTools` 占位、`session.delete` 内存语义、`children/todo/summarize` 空实现。
- A5c（conformance）：`mafw plugin-check --module <claude dist>` 能跑 approval/discovery/branch/media/usage 场景并把结果写入 `behavioral`。
- A6：新增测试：manifest/coverage（static+behavior）/emit/freshness/路由各至少 1 个；全量 gateway 测试通过。
- A7：向后兼容：不改任何现有插件的 `capabilities` 声明也能加载；旧 `GET /api/runtime` 字段不删。

## 13. 风险与开放问题

| 风险/问题 | 说明 | 处理 |
|---|---|---|
| 清单与 TS 类型漂移 | 清单是手写 const，可能和 `RuntimeClient` 不一致 | 新鲜度测试只能防 JSON 漂移；P1 加“surface probe 必须能解析”测试；P2 考虑从类型生成（`ts.Program`，参考 dsh typert） |
| required 面过大 | 如果把 optional 面误标 required，小 runtime 无法激活 | required 只保留今天的 hard 集合；新增项先 `optional` 观察一个版本 |
| 行为级验证成本 | conformance 要真实 LLM 往返 | 激活期只 presence；行为验证显式触发；缓存结果按 runtime+dialect |
| 覆盖率虚荣化 | 只报百分比不报影响 | 覆盖率必须带 `missing[].impact`；UI 默认展开缺失面 |
| 新增能力位过多 | 又回到 boolean 平铺 | 优先用 `optional` + conformance；只有“需要声明才能正确降级”的才加 flag |
| `attested` 无法验证 | `turnBudgetApi` 可能谎报 | 覆盖率标 `unverified`；goal 预算仍由 BudgetGuard 兜底（现有策略） |
| 认知面覆盖 | 宿主扩展不在插件 `capabilities` 里，gateway 无法探针 | 用 conformance（S3/S4）验证；覆盖率标 `unverified` 直到跑过 |
| 旧插件/旧文档 | SKILL.md 与清单不同步 | P0 先手工同步；P2 生成；文档改动纳入验收 |

**已闭合的开放问题（builder check 2026-10-30）**：

| 问题 | 决定 | 理由 |
|---|---|---|
| 四个新能力位（mediaInput/thinkingLevel/turnOutputSchema/toolVisibility） | P0 不加；用 `optional` + behavior/conformance | 避免回到 boolean 平铺；这些面没有“声明 false 才能降级”的硬需求 |
| `core` preset 是否要求 `cognition.observe` | 不要求；`conversation` 起列为期望（optional，不 hard） | headless 记忆 worker 可以不接宿主；宿主面 gateway 无法探针 |
| `mafw plugin-check` 时机 | P1 做确定性探针子集；P2 做完整场景 | P1 就能抓 `prompt` 返回值/`parts`/`registerTools` 这类行为缺口 |
| 覆盖率 UI 位置 | Config → Runtime 卡片 | 与现有插件激活同处；右 dock 概览只显示 active runtime 摘要 |
| 行为覆盖是否阻塞激活 | 不阻塞；只在 `plugin-check`/conformance 运行 | 激活要快、不能烧 LLM token |
| `plugin-check` 输入 | `[name]`（已安装）或 `--module <path>`（已构建 CJS） | claude 不在 `~/.mafw/runtime-plugins`；`--module` 用 bundle 产物，不自动打包 |

## 14. 我做的决定（供评审时检查）

- 清单源放在 `gateway/src/runtime/contract-manifest.ts`，JSON 生成到 SDK contract 目录。
- 三轴之外加了 `capability.kind` 与 `verification` 两个元数据，分别解决“能力类型混装”和“presence 不等于行为正确”。
- 义务用四值（required/gated/optional/advisory），没有把 `optional` 合并进 `gated`，因为很多面（rename、usage、stopReason）没有对应 capability flag，硬造 flag 会回到 boolean 平铺。
- **静态/行为双通道**：静态覆盖始终计算；行为覆盖只在 `plugin-check`/conformance 跑，避免激活变慢/烧 token（builder check #1）。
- **`ContractSubject`**：覆盖计算需要 runtime 实例 + 事件声明 + dialect，不能只传 `rt`；opencode 的 `resolveEventEntry()` 在激活时解析并保存（builder check #2）。
- **`requiredWhen.capabilities`**：保留 `global.event` 与 `providerConfigApi` 三方法的 hard 语义；预设不参与 hard（builder check #3/#5）。
- **`requires` vs `unlocks`**：只有 `requires` 缺失才降级能力；`unlocks` 里的其他面缺失只 warning（builder check #6）。
- **事件节从现有三源投影**：不新增第四张表；P0 先导出 `EVENT_REQUIRED_FIELDS` 常量并测试对照（builder check #7）。
- 认知面独立成 `cognition` 节，不塞进 `RuntimeCapabilities`；它是反向义务，只能 conformance 验证。
- 预设用 `core/conversation/autonomous/desktop`，旧 Tier 只做映射说明。
- P0 不加新能力位；先用 `optional` + behavior/conformance，避免一上来就扩 flag。
- `plugin-check` 支持 `[name]` 与 `--module <path>`；claude 验收走已构建 CJS（builder check #8）。

## 15. 参考

- ACP v1 Overview / Initialization：https://agentclientprotocol.com/protocol/v1/overview
- A2A 1.0 Specification：https://a2a-protocol.org/latest/specification/
- MCP 2026-07-28 Lifecycle/Versioning：https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle
- AG-UI Events：https://docs.ag-ui.com/concepts/events
- AI SDK Provider Specification：https://ai-sdk.dev/v5/providers/community-providers/custom-providers
- OpenAI Responses streaming events：https://developers.openai.com/api/reference/resources/responses/streaming-events
- Claude Agent SDK Overview：https://docs.claude.com/en/api/agent-sdk/overview
- 仓库内：`docs/superpowers/specs/2026-10-22-contract-gap-research/00-our-contract-inventory.md`、`05-industry-frontier.md`、`06-gap-synthesis.md`
