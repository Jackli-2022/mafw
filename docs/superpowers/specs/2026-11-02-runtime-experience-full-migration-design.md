# Runtime Isolation / Experience Contract 第二批：全量迁移与兼容层删除设计

日期：2026-11-02
状态：Draft（builder check 已完成，待用户批准）
前置：`2026-11-02-runtime-isolation-experience-contract-design.md`
前置计划：`docs/superpowers/plans/2026-11-02-runtime-isolation-experience-contract.md`

## 1. 意图与 Why

第一批已经建立 RuntimeFacade / Runtime Ingress、RuntimeAccess，以及 checkpoint、steer、background、MCP 四个 Experience 切片，并证明原生事件可以在 Ingress fail-closed。

但当前系统仍是“双轨制”：

- gateway 内部使用 canonical flat DTO，HTTP/SSE 出口又通过 `wire-compat.ts` 还原为 opencode `{info,parts}` / `{info}`。
- session-ui 直接引用 `@opencode-ai/sdk/v2` 类型；desktop、TUI、mobile 继续消费 opencode 历史形状。
- desktop 的 worktree、fork/revert、per-turn diff、run control 等仍由裸 capabilities 或 runtimeName 驱动。
- TUI 对 provider、agent、permission 等原生 DTO 做形状假设；SDK 暴露 shells、opencodeConfig 等原生或 legacy 面。
- gateway 仍有若干 routes/core 直接读取 capabilities、runtime 名称、原生快照路径或方法存在性。
- 旧 gateway / 旧客户端兜底让同一业务语义存在第二套前端推导。

第二批的目的不是再增加几个示例，而是结束双轨制：**所有现役客户端与业务核心只消费 MAFW 自有契约，随后实际删除本批涉及的兼容 shim。**

## 2. 已确认决策

| 决策 | 内容 | 来源 |
|---|---|---|
| 范围 | 除 dsh 外，第一批文档列出的后续项全部纳入 | 用户 2026-11-02 |
| dsh | 不在本批实现；后续作为普通 adapter 验证契约 | 用户 2026-11-02 |
| 兼容 shim | 本批最终实际删除，不再保留一个迁移周期 | 用户 2026-11-02 |
| mobile | 纳入 flat DTO 与 canonical SSE 的必要消费者迁移 | 用户 2026-11-02 |
| 终端 | gateway 定义并拥有中性 WebSocket、帧、票据与生命周期协议；adapter 翻译原生 PTY | 用户 2026-11-02 |
| 后台 | runtime shell、MAFW 持久任务、SSE 派生子代理统一为一套 jobs DTO 与动作语义 | 用户 2026-11-02 |
| 进程模型 | runtime 插件仍在 gateway 进程内，不新增 Runtime Host | 继承第一批 |
| 原生语义 | 原生优先；可靠时才由 MAFW fallback；不能模拟时显式降级 | 继承第一批 |
| Diagnostics/Admin | `/api/runtime`、插件中心、coverage、conformance 等诊断面保留，但不得供业务组件消费 | 继承第一批 |

## 3. 目标 / 非目标 / 反目标

### 3.1 目标

- G1：所有 runtime 历史出口与 SSE 消息出口只产生 MAFW flat DTO，不再输出 `{info,parts}` 或 `message.updated.properties.info`。
- G2：session-ui、desktop、TUI、SDK、mobile 不再依赖 runtime SDK 类型或 opencode wire 形状。
- G3：所有现役前端业务场景由 Experience Action Descriptor 或 MAFW View DTO 驱动；不读取 runtimeName、active.name、裸 capabilities。
- G4：gateway 业务 routes/core 的能力门与语义分支全部经过 RuntimeAccess；runtime 私有路径、存储布局、会话 id 前缀不进入业务核心。
- G5：本批涉及的旧路由别名、旧 SDK namespace、旧 gateway 数据推导、flat↔wire egress shim 全部删除。
- G6：依赖扫描、契约 golden、跨端形状测试能够抓回旁路，而非只验证 helper 存在。
- G7：opencode、pi、claude 现役能力不回归；不支持的能力以中性原因显式降级。

### 3.2 非目标

- N1：不实现 dsh adapter，也不为 dsh 预留特权分支。
- N2：不拆 Runtime Host 进程，不引入运行时沙箱。
- N3：不删除 adapter 内的原生协议翻译。opencode/pi/claude 的 native→canonical 转换是 adapter 的永久职责，不是待删客户端 shim。
- N4：不清理与 Runtime/Experience 无关的通用 API 历史债务。
- N5：不承诺旧 desktop/TUI/mobile 可以连接新 gateway；本批是有意 breaking change。特别是已安装的旧 mobile app 会因 flat/canonical 切换而失效，不保留 mobile 专用旧 wire 出口；发布时需协调新版 app 与 gateway。
- N6：不为了“全量”给弱 runtime 伪造 fork、文件回滚、PTY、审批等语义。

### 3.3 反目标

- 只把 `@opencode-ai/sdk` import 改名，却继续让 UI 读取 runtime 原生字段。
- 新增一套 Experience action，同时保留前端按 capabilities 推导的第二套业务契约。
- 先删 gateway wire shim，再逐个修客户端，造成中间提交不可用。
- 把 composition root 或 Diagnostics 白名单扩大到整个 `index.ts` / Config，使业务泄漏合法化。
- 用任意 `any` / 透传 `native` 代替真正的 View DTO。
- 将“加载中”“当前 busy”“数据缺失”误报为“runtime 不支持”。

## 4. 总体结构

第二批仍使用第一批的双契约，但把 View DTO 补成第三个明确的数据面：

```text
adapters
  │ native SDK / native events / native history
  ▼
Runtime Ingress + RuntimeFacade       ← 原生数据唯一入口
  │ canonical events + MAFW flat DTO
  ▼
gateway business core
  │ RuntimeAccess + MAFW semantics
  ▼
ExperienceProjector / View DTO exits  ← 前端唯一业务面
  │ versioned Experience actions + flat data
  ▼
desktop / session-ui / TUI / SDK / mobile
```

三个面的职责：

1. **Runtime Driver Contract**：adapter 能做什么，供 gateway 与 RuntimeAccess 使用。
2. **Experience Contract**：用户能执行什么、现在是否可执行、为什么不可执行、动作具有什么语义。
3. **View DTO**：消息、部件、会话、diff、provider、agent、approval、background 等中性只读数据。

Diagnostics/Admin 是独立窄通道，不属于业务 Experience。

## 5. MAFW View DTO

### 5.1 单一来源与包位置

新增一个零运行时依赖的共享契约包（本设计建议 `packages/contract`，包名由 builder 按现有 workspace 命名定稿），承载：

- `MafwMessage` / `MafwPart` 及其完整判别联合；
- `MafwSession` / `MafwSessionStatus`；
- `MafwDiff` / `MafwCheckpoint` 的只读视图；
- `MafwProvider` / `MafwModel` / `MafwAgent`；
- `MafwPermissionRequest` / `MafwQuestionRequest`；
- `MafwBackgroundJob` / terminal capability 所需的只读 DTO；
- 结构守卫与构建期 JSON Schema 导出。

gateway、SDK、session-ui、desktop、TUI 均消费该包；不得在 claude adapter、SDK、session-ui 再复制同名字符串类型。mobile 使用同一 JSON Schema/契约快照实现 Dart 映射，并加形状 golden。

这是本设计的包位置建议，不是用户指定的目录；builder 可在不引入循环依赖、不改变源码消费方式的前提下选择等价位置。

### 5.2 Message / Part 完备性

当前 `gateway/src/runtime/canonical-types.ts` 只有内部最小字段，不能直接作为 UI DTO。共享模型必须显式覆盖现役消费者使用的字段：

- 消息身份：`id/sessionID/role/parentID`。
- 内容：`content: MafwPart[]`；历史响应必须有数组，事件快照可缺省但需由事件类型区分。
- 时间：`time.created/completed`。
- 模型与 agent：使用中性 `model?: {providerID,modelID}` 与 `agent?`，不再要求 user/assistant 分别读不同原生字段。
- 状态：`finish` / `stopReason` 归一成 MAFW stop reason；中止不得靠 `MessageAbortedError` 字符串分支。
- 摘要：`summary.title/diffs` 使用 MAFW diff 视图。
- 错误：`error` 使用中性 kind/message，不暴露 runtime 原生错误类名作为业务判断。
- part：`id/sessionID/messageID/type` 为身份主干；`part.id` 必须稳定用于 upsert 与 live/history 去重。
- text/reasoning：`text/signature/time/synthetic`。
- tool：`callID/tool/toolClass/canonicalTool/state`，状态统一为 pending/running/completed/error；输入、输出、错误、metadata 使用明确结构。
- file：`mime/url/filename/source`。
- step/data/agent/compaction 等现役 part：显式建模；未知扩展使用受控 extension 字段，而不是无约束复制原生对象。

`native` 不得作为通用原生载荷穿过 View DTO。签名连续性所需的 `signature` 可以保留；确需 opaque 扩展时必须由 Ingress 过滤并列入契约。

### 5.3 其他 DTO 统一

- provider 的 models 恒为数组，不再出现 opencode 对象映射与 pi 数组两种形状。
- agent 使用 `{id,label,description,source,selectable}`；plan/build 是否存在由列表与 action 共同决定，不在业务代码硬编码 runtime 名。
- permission/question 统一为 MAFW 请求 DTO；TUI 不直接读取 opencode `patterns` 或 pi `toolName`。
- session revert 状态由 `MafwSession.reverted` 等中性字段表达，UI 不读原生 `info.revert`。
- background job 与 shell 原生 DTO 分离，状态、输出游标、取消语义由 MAFW 定义。统一 DTO 至少携带稳定 id、来源（runtime-shell / mafw-task / subagent）、kind、状态、标题、sessionID、时间、输出定位信息；对象级动作由 Experience 给出，不另挂裸 capabilities。
- opencode 的 synthetic shell started/ended 消息不得伪装成 user/assistant message。Ingress 将其翻译为 canonical `background.job.updated` 领域事件；desktop 后台实时更新改消费该事件，REST/facade 快照仍用于对账。

## 6. Experience Contract 扩展

### 6.1 `supported` 与 `enabled` 分离

`ActionDescriptor` 改为：

```ts
interface ActionDescriptor {
  supported: boolean;       // 当前 runtime/会话是否具备该能力
  enabled: boolean;         // 此刻是否允许执行
  reason?: ActionUnavailableReason;
  warningKey?: string;
  semantics?: Record<string, unknown>;
}
```

规则：

- `supported=false` → `enabled=false`，`reason='unsupported'`。
- `supported=true, enabled=false` 可表示 busy、missing-data、non-invertible-patch、unsafe 等暂时或对象级限制。
- `enabled=true` → 必须 `supported=true`。
- loading/error/unavailable 是客户端 store 状态，不伪造 ActionDescriptor。
- 对 checkpoint 等对象级动作，全局 action 表示功能面存在；每个 checkpoint 自带的 actions 表示该对象此刻的可执行范围。

`checkpoint.restore` 增加明确的 `sessionBacked` 等 semantics，Overlay 不再用 `enabled` 推断服务端模式。

### 6.2 动作覆盖

最终 action 清单由实现计划从下列现役场景逐项落表，至少覆盖：

| 域 | 动作面 | 替代的旧判断 |
|---|---|---|
| checkpoint | restore、manual create、对象级 scopes | 前端按 kind/snapshotTree 猜动作 |
| branch | fork、revert、unrevert | `sessionBranchApi`、方法存在性、原生 `info.revert` |
| diff | per-turn read、hunk/file revert | `diffApi`、runtimeName 缓存键 |
| run | suspend/resume/discard/read | `runStateApi` |
| session | worktree、summarize、switch agent/model、queue | worktreeApi、错误试探、runtime 原生配置 |
| prompt | steer、queue fallback、thinking/variant（现役面） | steerApi 与 busy 本地特判 |
| background | 原生后台化与 jobs list/output/cancel | `/api/shell` 直连与 REST probe |
| terminal | attach/local PTY 生命周期 | `/api/info`、`persistentPty`、`/api/pty` 原生发现 |
| approval | permission reply、question reply、mode/rules | 原生 DTO 与方法存在性 |
| discovery | commands/skills/AGENTS 读取 | `/command`、`/skill` legacy namespace |
| MCP | manage/config write（第一批已有） | 清除剩余旧 gateway 兜底与 runtime 字段文案 |

Provider、agent、message 等主要是数据，不为了形式统一强做成动作；它们走 View DTO，相关 select 操作才有 action。

### 6.3 版本与客户端状态

- 本批提升 `EXPERIENCE_VERSION`；生成 JSON 与 SDK 类型必须同步。
- 响应增加客户端兼容信息或请求版本协商，但它只用于给出明确的 `incompatible` 状态，不用于恢复旧 wire。
- store 至少区分 `idle/loading/ready/unavailable/incompatible/error`。
- runtime 切换、SSE 重连、会话切换必须按作用域失效；旧响应不得覆盖新 runtime。
- 本批结束后，旧 gateway 404 可显示中性“不支持此契约”，但不得激活旧业务推导路径。

## 7. Gateway 改造

### 7.1 Facade 与 RuntimeAccess

业务可见的 RuntimeFacade 不再向业务核心暴露 `name` 与裸 `capabilities`。组合根需要诊断信息时使用独立 `RuntimeDiagnostics` 视图，不允许经 facade 回读。

逐项迁移：

- routes：session diff/summarize/mutations/switch、restart-agent、permission 两入口、skill content、worktree 等全部使用 surface 门。
- core：discovery、instructions、media completion、run/checkpoint 之外的遗留点全部注入 RuntimeAccess。
- 缺 surface 时先补 manifest，再接线；禁止用方法存在性充当长期能力模型。
- 所有 503/错误文案保持中性，不包含 runtime 名或 capability flag。

当前只有前端隐藏、后端无门的入口必须补服务端门禁。worktree 是 gateway 拥有的 git 工作区能力，不是 opencode 专有 runtime 能力：其 Experience `supported` 由本地 git/worktree 可用性与 runtime 的 `session.create({directory})` 契约共同决定。不得再用 `worktreeApi` 将支持 directory 的 pi/claude 错判为不支持；现有 runtime capability 行应在契约清理中重新归类或删除。

### 7.2 清除 runtime 私有知识

- `index.ts` 按 `runtime.name === 'pi'` 选择媒体执行路径，改为契约能力/语义。
- `core/diff/turn-diff.ts` 不得知道 `~/.local/share/opencode/snapshot`；快照树定位与读取下沉到 adapter 提供的中性 surface。
- manager session 归属不得靠 `pi_` / `ses_` 前缀推断；使用显式 runtime 标签或持久槽位元数据。
- 删除 core approval 中已无实际作用的 runtimeName 参数。
- `normalizeOpencodeEvent` / `RawRuntimeEvent` 等 Ingress 内部名字可保留在 adapter 方言模块，但业务核心入口使用 canonical 命名。

### 7.3 中性 background 与 terminal 面

这两项不是 desktop 单方面可以完成的迁移：

- **background 三源统一**：gateway 新增中性 jobs façade，把 runtime shell、MAFW 持久任务（shell/subagent）与 SSE 派生子代理投影为同一 DTO、状态机与输出游标。SDK/preload/desktop 不再调用 `/api/shell*` 原生面；Experience 描述 list/output/cancel 等真实语义。`session.background`（把阻塞工具转后台）仍是独立动作，不与 jobs 查询合并。
- **terminal 完整中性协议**：gateway 新增中性 PTY capability、CRUD、connect-ticket 与 WebSocket 升级路径，并定义版本化的 input/output/resize/meta/close 帧。ticket 是 MAFW 不透明票据，桌面不得再发送 `x-opencode-ticket` 或拼接 `/api/pty` 原生 URL。adapter 负责原生 PTY 帧↔MAFW 帧翻译；desktop 只实现 MAFW 协议。
- runtime 不支持时必须 `supported=false`，并保留本地终端不可用原因；不得用假 PTY、假后台任务或原生帧透传代替。

## 8. 客户端迁移

### 8.1 session-ui

- 删除全部 `@opencode-ai/sdk` 类型依赖与 package dependency。
- 改用共享 View DTO；保留 `ToolProps/ToolComponent` 等现役公开导出路径，必要时轻模块 re-export。
- `file-diff-shape`、`tool-output`、`task-session` 等多形状读取收敛到客户端摄取层；渲染组件只读规范形。
- 删除无生产数据的 `part_text_accum_delta`、错误 provider Map 等死通道。
- stories 与测试不得继续用 `@ts-nocheck` 隐藏旧形状。

### 8.2 desktop

- 拆除 MafwShell 的 `rtCaps/rtName` 业务中枢；ChatPane 不再接收这些 props。
- worktree、fork/revert、diff、run、background、terminal、checkpoint 全部读 Experience/View DTO。
- 删除 `branch-actions.ts`、旧 checkpoint actions 推导、按 scope 猜 warning 的旧 gateway fallback。
- per-turn diff 缓存键不再包含 runtimeName；能力变化由 experience generation 驱动失效。
- SSE 改读 `properties.message`，历史改读 flat `content`；data-part overlay 与 enrich 同步支持 flat。
- Config/插件中心保留 Diagnostics，但按文件白名单，不得向聊天业务组件转发裸诊断面。

### 8.3 TUI

- 历史只读 flat content，删除 `item.info ?? item` / `item.parts` 双形状。
- fork/revert/unrevert/compact/model/agent/permission 等使用 Experience action 与中性 DTO；不可用时不发请求。
- 增加框架无关的 Experience store；可与 SDK 共享状态机，desktop 只做 Solid 适配。
- busy prompt 使用与 desktop 相同的 steer/queue/fallback 语义，不另造一套规则。
- 清理无消费者的死事件订阅；事件白名单必须有实际消费者。

### 8.4 SDK 与 preload

- `session.messages` 返回完整 MAFW flat DTO，类型与实际响应一致。
- 删除 `shells/requestRuntime`、`opencodeConfig`、legacy `command/skill` 等本批迁移面。
- 删除对应 preload 别名、通用旧 invoke 通道及 route-catalog 项；生成物只能由 emitter 重建。
- Diagnostics runtime namespace 保留并明确注释“仅 Admin/诊断”。

### 8.5 mobile

- 历史读取从 `info/parts` 改为 flat message/content。
- SSE 从旧 `opencode_event` / `message.part.*` / `session.idle` 词汇迁到当前 `mafw_event` 与 canonical 事件。
- Dart 模型与共享契约 golden 对齐；不再保留旧形状 fallback。
- CI 增加针对 mobile 契约迁移的 Flutter job：至少执行 `flutter analyze`、`flutter test` 与 flat/canonical golden。Android 安装包构建仍属发布门禁，不要求每个 Node 提交都构建 AAB。
- mobile 只做本批必需的契约迁移，不顺带重构移动端 UI。

## 9. 兼容 shim 删除边界

### 9.1 必须删除

- `wire-compat.ts` 的 flat→wire 历史与 SSE 转换及全部生产消费者。
- 客户端 `info ?? item`、`parts ?? content` 等双形状读取。
- 旧 gateway 无 actions 时的前端业务推导。
- 本批取代的 SDK/preload 旧 namespace、别名与 legacy 端点。
- 无生产消费者的 `applyNormalizeMessages` / `wrapRuntimeMessages` 等死通道。
- facade 的 wire rescue：所有 adapter 必须显式交付合法 flat DTO；违例 fail-closed 并记录诊断，不回吐原生历史。
- 持久 `event_log` 中升级前写入的 `message.updated.properties.info` 帧必须做一次幂等存储迁移为 `properties.message`，在 replay 服务开放前完成；迁移需备份/失败安全与 golden。不得在 replay 出口长期保留 info→message 兼容读取，也不得让新客户端重连收到已知旧形状。

### 9.2 必须保留或迁移而非机械删除

- adapter 内部的 native SDK 调用、native event/history 翻译。
- 三原语 tool call/result 合帧等 canonical 生产机制；其输出必须改为 MAFW View DTO，而非为了删 shim 删除功能。
- Diagnostics/Admin 的 runtime 名称、coverage、plugin manifest。
- 与第二批无关的其他系统兼容层。

## 10. 实施顺序（同一批内的依赖波次）

1. **契约先行**：共享 View DTO、Experience 新 schema/action 清单、版本与生成测试。
2. **gateway 中性面**：RuntimeAccess 收尾、background/terminal façade、flat 历史/SSE 出口的可切换实现。
3. **全部消费者切 flat**：session-ui、desktop、TUI/SDK、mobile；此时 gateway 可以短时双写，但任何客户端不得新增旧形状依赖。
4. **Experience 全量接线**：所有业务动作与 View DTO 消费完成，旧 capabilities/runtimeName 中枢拆除。
5. **删除 shim**：先完成 event_log 一次性迁移，再关闭双写，删除 wire-compat、旧别名、旧端点与前端 fallback。
6. **硬化禁令与验收**：全量扫描、跨端 golden、真实 runtime/UI/mobile 冒烟。

中间每个提交必须保持可构建、可测试；“删除 shim”是最后波次，不是第一批提交。

## 11. 架构守卫

- gateway 扫描覆盖 routes/core/media/trajectory 与 index.ts 内联业务块；composition root 必须按具体区段或抽出模块，不能整文件豁免。
- 扫描需覆盖 `?.`、cast、getter、`capabilities.diffApi`、runtimeName 比较、原生私有路径等形态，并有反向 fixture 证明会失败。
- 每个 gated route 必须有 route→surface 对照与中性 503 测试。
- 所有历史消费者使用同一 flat golden；所有 SSE 消费者使用同一 canonical golden。
- session-ui/desktop/TUI/SDK/mobile 各有依赖禁令；Diagnostics 白名单逐文件列出。
- 每个待删 shim 必须有“生产消费者为零”的守卫，删除后由禁止回归测试锁死。
- Experience 快照验证 supported/enabled、busy/loading/unsupported、runtime switch 与对象级 actions。

## 12. 验收标准

### 12.1 契约与架构

- 所有公开历史出口只返回 MAFW flat DTO；SSE `message.updated` 只携带 `properties.message`。
- session-ui、desktop、TUI、SDK、mobile 无 runtime SDK import、runtimeName 业务分支、裸 capabilities 或旧 wire fallback。
- gateway 业务核心无 runtime 名称、原生 SDK、原生私有路径或裸能力门。
- Diagnostics/Admin 例外有显式清单，扫描反向 fixture 有效。
- Experience 与 View DTO 的版本化 JSON/Schema 均新鲜，SDK/preload/Dart 消费面对齐。

### 12.2 行为

- opencode/pi/claude 的共有场景在语义一致时呈现一致；差异只来自显式 semantics。
- busy、loading、unsupported、missing-data、non-invertible-patch 不互相混淆。
- worktree、fork/revert/unrevert、diff、run、background、terminal 等不支持时显式禁用，不发生先试请求再报错。
- data-part overlay、tool identity、part.id 去重、streaming caret、中止态、per-turn diff 不回归。
- mobile 能读取 flat 历史并处理 canonical SSE，无空消息列表。

### 12.3 删除与质量

- `wire-compat` 与本批登记的旧 alias/fallback 已物理删除，仓库无生产引用。
- 全量 gateway、SDK、session-ui、desktop、TUI 测试与各自 typecheck/build 通过；mobile 的 `flutter analyze`、`flutter test` 与契约 golden 进 CI 并通过。
- 真实 gateway + desktop 冒烟覆盖首批四场景与第二批关键场景；mobile 至少跑契约测试，能连真实 gateway 时补在线冒烟。
- 发布说明明确 breaking change、删除面、版本号与 commit。

## 13. 风险与对策

| 风险 | 后果 | 对策 |
|---|---|---|
| flat 字段不完备 | 工具卡、diff、中止态静默回归 | 先盘点字段，跨端共享 golden，再翻出口 |
| supported/enabled 混用 | busy 时功能消失或错回本地模式 | schema 层强制不变量，checkpoint 专项测试 |
| mobile 漏迁 | 消息空、SSE 不更新 | 纳入同一 flat/canonical 验收 |
| shim 过早删除 | 中间提交客户端不可用 | 最后波次删除，零消费者守卫 |
| 白名单过宽 | 架构测试假绿 | 逐文件/逐区段例外 + 反向 fixture |
| background/terminal 只改 UI | 仍依赖原生协议 | gateway 先建中性 façade，再迁客户端 |
| 弱 runtime 假支持 | 用户触发无效或破坏操作 | supported=false + 中性原因，不伪造语义 |

## 14. 留给 builder 的决定

- 共享契约包的最终名称与 workspace 构建接线。
- 新 action 的最终 id 命名，以及 background/run 是聚合动作还是逐动词动作；一旦导出必须保持稳定。
- 共享 Experience store 放 SDK 还是独立包，需避免引入 Solid 依赖。
- mobile 的 Dart 契约生成程度；最低要求是共享 golden，而非必须引入代码生成器。
- 任务级 TDD 切分、每波次提交点与具体测试数量。

这些决定不得改变已确认范围：除 dsh 外全部完成，mobile 纳入，本批最终删除相关兼容 shim。

## 15. Builder check 裁决记录

- **终端协议深度**：用户选择完整中性协议；gateway 拥有 WS/帧/票据，adapter 翻译，禁止原生帧透传给 desktop。
- **background 真相源**：用户选择三源统一；`session.background` 仍独立表达“转后台”动作。
- **旧 mobile 破坏窗口**：由已确认的 breaking change 覆盖；不保留专用 shim，新版 app 与 gateway 协调发布。
- **event_log 旧帧**：本设计决定做一次性幂等迁移，不在 replay 长期保留兼容层。
- **synthetic shell 消息**：本设计决定翻译为 `background.job.updated`，不扩充聊天 message role。
- **worktree 归属**：本设计决定归为 gateway git 能力 + session directory 契约，不以 opencode 能力位限制其他 runtime。
- **mobile 验证**：本设计决定把 focused Flutter analyze/test/golden 纳入 CI；完整安装包构建留在发布门禁。

## 16. 实现偏差记录（2026-11-02 验收批）

实现阶段与设计文本的差异，逐条登记（设计面未变的项不在此列）：

1. **`session.background` 路由漏登记（真实契约洞）**：`POST /api/session/:id/background`
   自 Task 3 起在 SDK（`sessions.background`）与 index dispatch 中存在，但未进
   `routes/route-catalog.ts`，因此不在 `openapi.json` / 契约产物里。Task 16 的
   route→surface 守卫首次把它抓出，本批补登记并重生成契约产物
   （`emit:openapi` 241 operations / 215 paths）。
2. **守卫的扫描范围口径**：桌面/TUI/session-ui 扫描器排除 `*.test.ts(x)` 与 `*.stories.tsx`
   （它们本身就是反向 fixture 与 wire 样本）；desktop 的 `history-wire-shape` 规则限定接收者
   （`item.info` / `msg.parts`），避免把 turn-queue 的 prompt `parts` 误判为 wire 历史。
3. **`properties.info` 例外清单**：Task 14 只翻转 `message.updated`，session 生命周期
   （`session.created/updated/deleted`）仍是 wire `properties.info`。因此 desktop 守卫把它
   列为**逐文件例外**（`session-events.ts`、`sse/dispatcher.ts`、`sse/handlers/subagents.ts`），
   而不是全域禁令。
4. **组合根例外按「规则 + 访问形态」登记**（8 条，含 `this.runtimeHost` 诊断窄面、
   `plugin.capabilities` 声明、激活期 `rawRuntime/fallbackRt`）。守卫反向断言每条登记都仍被
   使用（无死豁免），并拒绝任何未登记形态。
5. **pi live `message.updated` 缺 `message.id`**：Task 12 已登记的映射缺口，本批不修
   （映射行只带 role/finish）；SSE golden 把它钉成显式期望：桌面按「无 id 的 live
   message.updated 丢弃」处理，历史 id 由 `normalizePiMessages` 提供。
6. **claude 历史无时间戳**：`normalizeClaudeHistory` 不产出 `time`（SDK 消息无时间字段），
   View DTO 的 `time` 为可选，golden 显式断言该缺口。
7. **`session-ui` 的架构守卫文件位置**为 `src/architecture.test.ts`（brief 指定）；
   纯逻辑守卫导出 `scanSessionUiSource/scanSessionUiFixture` 供后续复用。

