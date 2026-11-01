# Runtime 隔离与前端体验契约设计

- 日期：2026-11-02
- 状态：已批准（2026-11-02；builder-check 已完成，首个里程碑边界已确认）
- 关联设计：
  - `2026-10-21-runtime-canonical-v3-design.md`
  - `2026-10-30-runtime-contract-coverage-manifest-design.md`
  - `2026-10-31-runtime-plugin-ergonomics-design.md`
- 关联调研：`2026-10-22-contract-gap-research/04-pi-dsh.md`、`06-gap-synthesis.md`

## 1. 意图与为什么

当前 MAFW 已有 runtime 契约、能力覆盖计算、事件翻译执行器和插件检查器，但真实消费仍存在三类补丁：

1. gateway 业务路由直接解释布尔能力位、方法存在性和自定义 `supported`，新增 runtime 时需要逐处补点。
2. 前端直接消费 `runtimeName`、裸 `capabilities` 和 opencode SDK 类型；不同组件对“未加载/不支持”的缺省判断不同。
3. 原生 runtime 数据可以通过同一对象模型进入核心，当前主要依赖开发者记得调用翻译/归一化，缺少“未翻译就无法进入”的结构保证。

目标不是换一个更强的 runtime 内核，而是建立两条独立契约和一条强制防腐边界：

- **Runtime Driver Contract**：adapter 与 gateway 之间的驱动契约。
- **Experience Contract**：gateway 与前端之间的体验契约。
- **Runtime Ingress**：进程内唯一允许接触原生 runtime 数据的隔离层；只有翻译后的 canonical 数据可以进入 gateway 业务核心。

dsh（DeepSeek Harness）可以作为普通 adapter 接入并验证契约，但不取代 MAFW canonical contract，也不获得任何 gateway/前端特权。

## 2. 业界分层对照

本设计采用多家系统的交集，而不是照搬任何一家。

| 系统 | 业界分法 | 对本设计的直接启示 |
|---|---|---|
| DAP（Debug Adapter Protocol） | 具体 debugger/runtime 由 intermediary adapter 接到抽象协议；开发工具只实现一套 generic debugger UI。协议刻意提供面向 UI 的高层数据，而不是暴露全部底层细节。 | Runtime adapter 与 Experience Contract 必须分开；前端要的是 UI 可直接消费的高层语义，不是 runtime 原始能力全集。 |
| ACP（Agent Client Protocol） | Client 与 Agent 通过 JSON-RPC 通信；Client 只接收 `session/update` 中的消息、工具、计划、通知等标准内容，能力在初始化时协商，扩展走 `_meta`/自定义 capability。 | 前端应消费版本化的体验协议，不应订阅 runtime 原生事件流；高级语义可扩展但不能破坏基线。 |
| MCP（Model Context Protocol） | Host 负责 orchestration，Client 维护隔离连接，Server 只提供窄能力；server 不应读取完整会话或看见其他 server。 | gateway 拥有策略与编排；runtime 插件只提供实现，不拥有跨域业务语义。 |
| OpenTelemetry Collector | receiver → processor → exporter 管道；不同来源先进入统一数据管线，processor 可转换或 drop，再交给 exporter。 | Runtime Ingress 必须先归一再进入核心；未匹配事件在边界丢弃，不允许旁路广播。 |
| dsh | 会话原始日志内部持有，客户端使用 page/follow/projection/control 等投影面；Typert 从 Host 生成 Client 消费面。 | 原始日志与客户端投影分离；可以借鉴契约生成，但不必把 dsh 变成 MAFW 的总线或唯一内核。 |

证据入口：

- DAP overview：https://microsoft.github.io/debug-adapter-protocol/overview
- ACP overview：https://agentclientprotocol.com/protocol/v1/overview
- MCP architecture：https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture
- OTel Collector architecture：https://opentelemetry.io/docs/collector/architecture/
- dsh 调研：`docs/superpowers/specs/2026-10-22-contract-gap-research/04-pi-dsh.md`

结论：业界没有一个现成系统同时解决 MAFW 的「多 harness 归一 + 记忆/goal 编排 + 桌面体验」。合理方案是组合 DAP 的 adapter、OTel 的入口管线、ACP 的客户端协议和 dsh 的投影思想。

## 3. 目标、非目标与反目标

### 3.1 目标

- G1：runtime 插件仍运行在 gateway 进程内，不引入 Runtime Host 进程或新的网络边界。
- G2：原生事件、原生 Message/Part、SDK 类型、runtime 专属配置与名称不得越过 Runtime Ingress。
- G3：未翻译、未匹配或字段非法的事件在入口 fail-closed，只能产生 telemetry，不能进入业务总线或前端 SSE。
- G4：gateway 业务核心只依赖 canonical `RuntimeFacade` 与 MAFW 语义，不依赖 runtime 名称、版本、SDK 或原生事件。
- G5：前端只消费 Experience Contract；不再读取裸 runtime capabilities、按 `runtimeName` 分支或 import runtime SDK 类型。
- G6：前端看到的是 MAFW 在“原生实现或可靠 fallback”之后的最终可用性，而不是 runtime 原生覆盖率。
- G7：两份契约均有明确 schema、版本和 JSON 导出；线上只传数据，不传可执行翻译代码。
- G8：接入 dsh 不需要修改 gateway 业务核心或前端，只需 adapter、声明和契约测试。

### 3.2 非目标

- 不做进程隔离、插件沙箱或多 runtime 并存。
- 不用 dsh 替换 MAFW gateway，也不把 MAFW 前端改成 dsh 原生客户端。
- 不承诺所有 runtime 都原生支持全部功能。
- 不在本设计中一次性迁移所有 HTTP 路由和 UI；先定义边界与高价值切片。
- 不删除 `/api/runtime` 的诊断能力；它不再是前端业务功能的数据源。
- 不通过网络以字符串/序列化形式注入或执行翻译代码；本地受信插件可以携带过程式翻译模块，但只能在 Runtime Ingress/quarantine 内加载执行。

### 3.3 反目标（出现即说明设计失败）

- 原生事件经“调试/临时”旁路直接进入 `handleRuntimeEvent`、trajectory 或广播。
- 为了功能表一致，把不支持的语义伪装成支持。
- 前端继续通过 `runtimeName === 'pi'`、`active.name === 'opencode'` 或 SDK 类型决定行为。
- 为 dsh 增加独立 canonical 词汇、独立事件出口或前端专用分支。
- 以“兼容”为名永久保留第二套业务契约。

### 3.4 首个里程碑与后续边界（用户已确认）

**首个里程碑必须交付：**

1. RuntimeFacade + Runtime Ingress，保证未翻译事件不能进入 gateway 业务核心。
2. RuntimeAccess，收编首批 gateway 能力门与语义分支。
3. checkpoint、steer、background、MCP 四个 Experience 切片，移除这些场景的前端 runtime 特判。
4. 依赖禁令、入口 golden、历史 golden、前端泄漏扫描和体验快照等架构测试。
5. Driver/Experience 两份契约的首版 JSON 导出与版本字段。

**明确排入后续里程碑，不属于本次完成线：**

- dsh adapter spike 与在线 conformance。
- session-ui 全量类型中立化。
- TUI/SDK 的全量 Experience 迁移（本批只保持兼容，并迁移首批场景必需的 SDK 类型）。
- 其余 HTTP 路由和 UI 的全量清理。

首个里程碑不得引用后续项作为完成证据，也不得以“后续还要做”为由留下首批场景的旁路。

## 4. 总体结构

```text
opencode / pi / claude / dsh / codex adapters（仍在 gateway 进程内）
  │ 原生 SDK 调用、原生事件、原生历史
  ▼
Runtime Ingress（组合根内的隔离层）
  ├─ gateway 提供的翻译函数执行器
  ├─ canonical 词汇与字段校验
  ├─ normalizeMessages / flat DTO 归一
  ├─ 原生能力与语义声明校验
  └─ 未匹配/非法输入：drop + telemetry
  │ 只输出 canonical events / canonical DTO
  ▼
RuntimeFacade + RuntimeAccess
  │ MAFW 中自动词、surface 状态、语义描述
  ▼
Gateway 业务核心
  ├─ 原生实现或可靠 fallback
  ├─ goal / memory / approval / checkpoint / queue 等策略
  └─ ExperienceProjector
  │ 只输出体验 DTO、动作描述和体验事件
  ▼
Experience Contract（HTTP / SSE / JSON）
  ▼
desktop / session-ui / TUI
```

“raw-event-first”只描述 adapter 的编写方式：插件可以推原生事件，gateway 的翻译函数在 Runtime Ingress 执行。它不表示原生事件可以进入 gateway 业务核心。

## 5. Runtime Driver Contract

### 5.1 两类对象必须分离

**RawRuntime** 仅存在于 adapter 与 Runtime Ingress：

- 可包含原生 SDK client、原生 `global.event()`、原生历史和 runtime 专属配置。
- 不得传给 gateway 业务路由、goal、memory、desktop egress 等消费者。

**RuntimeFacade** 是 gateway 业务核心唯一可见的 runtime 面：

- `events(): AsyncIterable<CanonicalRuntimeEvent>`，不存在原生事件流入口。
- session/prompt/tools 等动词只接受和返回 canonical DTO。
- `RuntimeAccess.can(surfaceId)` / `requireSurface(surfaceId)` 提供统一能力门。
- `RuntimeAccess.semantics(surfaceId)` 提供布尔值无法表达的语义差异。
- runtime 名称只可作为诊断元数据，不能参与业务分支。

组合根负责把 RawRuntime 包装成 RuntimeFacade。业务核心不能取得未包装的 RawRuntime。

### 5.2 入口不变量

- I1：每个进入 facade 的事件必须来自翻译执行器并通过 canonical 类型与必需字段校验。
- I2：未匹配、显式 drop、翻译异常、非法信封都在 Ingress 终止，只记录 `translationDrops` / `translationErrors`。
- I3：业务核心和前端不存在第二条原生事件订阅路径。
- I4：历史数据在 facade 边界完成 `normalizeMessages`，核心只接收 flat canonical Message/Part。
- I5：runtime 原生 SDK 类型不得出现在 facade 的公开签名中。
- I6： facade 之外不允许通过 `runtime.name` / `active.name` 决定功能行为。

### 5.3 能力语义不只是布尔值

保留现有 capabilities 作为粗粒度开关，同时增加 surface 级语义描述。例如：

```json
{
  "prompt.delivery.steer": {
    "available": true,
    "boundary": "after-turn"
  },
  "approval.permissionReply": {
    "available": true,
    "alwaysScope": "unsupported"
  },
  "branch.revert": {
    "available": true,
    "files": true,
    "undo": false
  }
}
```

语义由 adapter 声明，经激活校验后进入 RuntimeAccess。dsh 无 `always`、opencode/pi 的 steer 边界不同等差异必须显式表达，不能靠名称补丁。

### 5.4 契约 schema 与 JSON 导出

Driver Contract 至少包含：

- schema/version；
- domains / surfaces / capabilities / presets；
- canonical events 与字段要求；
- surface 级语义键及允许值；
- 翻译声明形状；
- 降级与验证方式。

构建期导出 versioned JSON。映射执行器由 gateway 内置；插件可以提交声明、原生数据样本，以及本地受信的过程式 `transformEvent` / 历史归一化模块。后者属于 adapter 交付物，只能在 Runtime Ingress/quarantine 内由 gateway 激活并执行，不能进入业务核心，也不通过网络动态注入。因而 dsh 可以在 adapter 内新增必要的过程式翻译，不要求通用声明 DSL 覆盖所有方言。

## 6. Experience Contract

### 6.1 与 Driver Contract 分离的原因

Driver Contract 回答“runtime 原生能做什么”；Experience Contract 回答“MAFW 最终允许用户做什么、如何做、有什么限制”。两者不能再用同一组裸 capabilities 表示。

`/api/runtime.active.coverage` 继续用于诊断与插件编写；前端业务 UI 使用 Experience Contract。

### 6.2 体验 DTO 的组成

初版包含四类：

1. **View DTO**：MAFW 自有 Session/Message/Part/Diff/Checkpoint 等类型，不继承 runtime SDK 类型。
2. **Action Descriptor**：某动作是否可用、不可用原因、语义与确认提示键。
3. **Experience Event**：版本化 canonical 体验事件，不含 runtime 原生字段。
4. **Error Descriptor**：稳定错误码、可重试性和可选详情，不要求前端识别 runtime 错误形状。

示例动作描述：

```json
{
  "action": "checkpoint.restore",
  "enabled": true,
  "scope": ["conversation", "files"],
  "undo": "unsupported",
  "warningKey": "restore-conversation-files-no-undo"
}
```

`warningKey` 由前端映射到 i18n；前端不再用 `runtimeName` 选择文案。

### 6.3 动作状态要有正确作用域

- app 级：MCP 管理、runtime 配置等。
- session 级：fork、prompt steer、background 等。
- turn/checkpoint 级：restore conversation/files、代码回滚等。
- part/tool 级：打开子会话、查看 diff、重试等。

动态对象应直接携带自己的动作状态，避免前端重新推导。例如 checkpoint：

```json
{
  "id": "cp_123",
  "actions": {
    "restoreConversation": { "enabled": true },
    "restoreFiles": {
      "enabled": false,
      "reason": "non-invertible-patch"
    }
  }
}
```

不可用原因使用稳定枚举，如 `unsupported`、`busy`、`missing-data`、`non-invertible-patch`、`unsafe`。前端可统一呈现，无需理解 runtime。

### 6.4 版本与 JSON 导出

- Experience Contract 有独立 `experienceVersion`，不与 Driver Contract 强绑定。
- 响应携带版本；客户端声明可接受范围。
- 新增可选字段/动作为 minor；删除或改变既有语义为 major。
- 构建期导出 JSON Schema/清单，供 SDK、desktop、TUI 和契约测试共用。
- SSE 只传 Experience Event；`data-*` 等扩展必须按 name 注册 schema。

### 6.5 Diagnostics / Admin Contract 是独立窄通道

插件中心、runtime 切换、原生覆盖率和 runtime 专属配置本质上就是管理面，不强行伪装成 runtime-neutral。它们使用独立的 Diagnostics/Admin Contract（可沿用 `/api/runtime` 及配置路由），允许展示 runtime 名称、原生 capabilities、coverage 和方言信息。

该通道只能用于明确的管理/诊断页面，不得被 session/chat/goal 等业务 UI 复用。依赖扫描只为这些页面保留显式白名单；Experience Contract 不因此吸收 runtime 原生配置全集。

### 6.6 迁移兼容性

- 当前 desktop/TUI/SDK 至少保留一个迁移周期的兼容 shim，并进行新旧 gateway/client 的滚动升级测试；不以硬切换制造无提示破坏。
- 现有 opencode/pi/claude 插件必须持续可用。其声明式 mappings 与本地 `transformEvent` 均可迁入 Runtime Ingress。
- 未知的第三方旧 RuntimeClient 插件采用 best-effort legacy adapter；无法安全包装的标记为 incompatible，并给出迁移错误，不静默放行原生事件。
- shim 必须带版本和退役条件，不能形成永久第二套业务契约。

## 7. 原生实现、fallback 与降级

ExperienceProjector 消费 RuntimeAccess 和 MAFW 自有服务，按固定顺序决策：

1. **原生优先**：runtime 能准确实现 MAFW 语义时走原生。
2. **可靠 fallback**：gateway 能自己保证语义时，由 MAFW 提供，例如 queue、checkpoint、软暂停等。
3. **显式降级**：无法可靠模拟时返回 `enabled:false + reason`，不伪装成功。

Runtime native coverage 与 Experience availability 是两个不同投影：

- native coverage 用于插件诊断，允许缺面。
- Experience availability 是 fallback 后的最终状态，供前端使用。

任何 fallback 都必须写清语义限制。例如无 `always` 审批只能声明 `alwaysScope:'unsupported'` 或 `once-only`，不能显示“永久允许”。

## 8. 强制依赖边界

### 8.1 gateway

`gateway/src/core/**`、`gateway/src/routes/**` 及其他业务消费者：

- 禁止 import 具体 runtime SDK 和 adapter 私有模块。
- 禁止接收 RawRuntime。
- 禁止用 runtime 名称决定行为。
- 只能通过 RuntimeFacade / RuntimeAccess 使用 runtime。

组合根是唯一例外，但只允许注册、创建、包装和诊断，不承载业务规则。迁移期间 adapter 可暂留 `gateway/src/runtime/`，但必须位于明确的 quarantine 区域；目标包位置由实现计划决定。

### 8.2 frontend

`packages/desktop/src/renderer/**`、`packages/session-ui/**`：

- 禁止 import `@opencode-ai/sdk`、pi/claude/dsh SDK 类型。
- 禁止读取 `runtimeName` / `active.name` / 裸 runtime capabilities 决定 UI。
- 只能消费 Experience DTO、Action Descriptor 和 Experience Event。

### 8.3 架构验证

至少建立以下自动化守卫：

- 依赖扫描：禁止模块与 import 在 CI 直接失败。
- 类型守卫：core 公开入口不能引用 RawRuntime 或 runtime SDK 类型。
- 入口 golden：原生事件在 Ingress 被翻译，未匹配事件不到达核心和广播。
- 历史 golden：不同 runtime 的原生历史在 facade 出口生成同一 flat DTO。
- 体验快照：同一 MAFW 语义在不同 runtime 下产生一致 Experience DTO；差异只能来自显式语义描述。
- 前端泄漏扫描：`runtimeName`、`active.name`、裸 capabilities 和 runtime SDK import 不得进入业务组件。

## 9. 当前泄漏与迁移方向

已确认的代表性泄漏：

- `gateway/src/index.ts` 直接 import opencode 事件表、创建 opencode runtime 并注册多个方言。
- `gateway/src/index.ts:1622` 与各 routes 分散解释能力门。
- `packages/desktop/.../MafwShell.tsx` 缓存并传递裸 `runtimeCaps`。
- `packages/desktop/.../checkpoint-revert.ts` 用 `runtimeName` 选择回滚文案。
- `packages/desktop/.../background-capability.ts` 用 `active.name === 'opencode'` 判断功能。
- `packages/session-ui` 直接 import `@opencode-ai/sdk/v2` 的 Message/Part/Diff 类型。

建议按风险递增切片，而不是大爆炸重写：

1. 先建立 RuntimeFacade/Ingress，保持线上行为不变，把所有 runtime 包装到同一边界。
2. 用 RuntimeAccess 收编 gateway 能力门和语义分支。
3. 先为 checkpoint restore、prompt steer、background、MCP 四类高价值场景建立 Experience Action Descriptor，移除对应 runtime 特判。
4. 逐步将 session-ui 的 DTO 切到 Experience Contract，并统一 SSE/历史出口。
5. 在边界稳定后实现 dsh adapter spike；dsh 只能通过 Ingress，验收不得要求业务核心或前端修改。

详细任务拆分留给实现计划。

## 10. 验收标准

### 10.1 首个里程碑完成线

- 注入任意原生事件，只有翻译且校验通过的 canonical 事件能到达 gateway 业务核心；未翻译事件 0 条到达核心与前端。
- 经过 RuntimeFacade 的现役 runtime 历史出口只产生 MAFW flat DTO，无 SDK 类型泄漏；未迁移的 legacy 路径必须由兼容 shim 明确隔离。
- gateway 业务核心不存在 runtime 名称分支和具体 runtime SDK import；组合根/诊断白名单除外。
- checkpoint、steer、background、MCP 四个首批场景只消费 Action Descriptor，不再出现 `runtimeName` / `active.name` / 裸 capabilities 分支。
- 首批场景中，能可靠 fallback 的功能在不同 runtime 下呈现一致；不能 fallback 的功能统一显式降级，无假承诺。
- Driver Contract 与 Experience Contract 均可导出带版本的 JSON，并有新鲜度/兼容性测试。
- 现有 desktop/TUI/SDK 至少一个迁移周期内保持兼容；opencode/pi/claude 现役插件不回归。
- 全量既有测试保持通过；新增架构与契约测试证明上述边界，而不是只测 helper。

### 10.2 最终目标（后续里程碑，不作为本批完成声明）

- 所有 runtime 的历史出口和全部前端业务组件完成 Experience 迁移。
- dsh adapter 在不修改业务核心和前端的前提下通过对应 preset 的离线检查与在线 conformance。
- TUI/SDK 完成剩余 Experience 场景迁移，兼容 shim 按版本条件退役。

## 11. 已作出的决定

- 插件继续运行在 gateway 进程内，采用进程内强隔离，不拆 Runtime Host。
- 采用 Driver Contract 与 Experience Contract 双契约，不让前端复用 runtime 原生能力模型。
- 翻译函数由 gateway 提供并在 Runtime Ingress 执行；未翻译数据 fail-closed。
- dsh 是普通 adapter 和契约验证对象，不是 MAFW 总线或特权内核。
- 原生优先、可靠 fallback、显式降级，绝不为一致性伪造语义。
- runtime 名称只用于诊断，不用于业务和 UI 分支。
- 首个里程碑只做 Runtime Ingress/Facade、RuntimeAccess、四个 Experience 切片及架构测试；dsh spike、session-ui 全量中立化、TUI/SDK 全量迁移记录为后续工作，不混入本批。

## 12. 留给 builder 的决定

- Runtime Ingress / RuntimeFacade / ExperienceProjector 的具体包位置与命名。
- Experience Action Descriptor 是嵌入现有 session/checkpoint 响应，还是增加独立查询端点；可按场景选择并说明理由。
- JSON Schema/清单生成方式及与现有 `emit-runtime-contract` 的复用关系。
- 兼容 shim 的退役顺序，避免一次 wire flip 影响 desktop/TUI/SDK。
- dsh 使用 SDK stdio 还是更丰富的 SessionController/Remote 面，由 spike 的覆盖率与语义保真结果决定。
