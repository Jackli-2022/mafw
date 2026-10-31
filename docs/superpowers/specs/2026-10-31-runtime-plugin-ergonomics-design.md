# Runtime 插件体验与契约强化设计（盘点 + 下一代插件接口）

- 日期：2026-10-31
- 状态：待批准
- 关联：`docs/guides/runtime-plugin-authoring.md`（agent 版编写指南）、`gateway/src/runtime/contract-manifest.ts`（契约单源）、spec `2026-10-12-native-event-vocabulary-design.md`、`2026-10-15-runtime-tool-registration-contract-design.md`

## 1. 意图与为什么

路线图目标是「多 runtime 的 agent 工作台」——未来不同 runtime 的会话并存于同一桌面。经与用户确认：**多 runtime 并存是方向，本批不做**；本批范围 = 单 runtime（全局热切换）前提下，把契约与插件作者体验做扎实，让「接入一个新 runtime」从抄写级工程变成填表级工程。

驱动力来自三个实测痛点（见 §3 盘点）：

1. 事件翻译机制被重复实现（claude 适配器内嵌了 gateway event-mapper 的迷你复制版，注释自认漂移风险）；
2. 会话注册表 / 事件总线 / 历史归一化等 plumbing 在每个适配器手写一遍；
3. 能力声明分散两处（claude 模块侧 + 实例侧双份，漂移无防线），「实现存在但未声明」的能力不生效也无提示。

## 2. 目标 / 非目标 / 反目标

### 目标

- **G1 raw-event-first 唯一推荐路径**：插件只推原生事件 + 声明 `eventSource/eventMappings/transformEvent`（模块导出，纯数据 + 逃逸函数），翻译由 gateway 统一执行器执行。插件包内不再出现事件翻译执行器。
- **G2 共享运行机械**：新增仓库内共享包 `packages/runtime-kit`，提供会话注册表（busy/queue）、事件总线 fan-out、turn 状态助手等；claude / pi 先消费。
- **G3 能力声明单源**：能力在 `module.exports.capabilities` 声明一次；runtime 实例不再重复声明（gateway 在加载期解析后盖印到实例上）；声明 ↔ 实现交叉校验。
- **G4 manifest 驱动脚手架**：`scripts/generate-runtime-plugin.mjs` 读 `runtime-contract.json`，按 preset 生成带逐面 TODO 的骨架。
- **G5 三级强制链**：加载期硬校验（声明↔实现）→ 激活期降级（能力缺失降级 + error 状态，已有）→ CI/观测（`mafw plugin-check` + coverage 进 `GET /api/runtime` 与桌面 Config）。
- **G6 迁移现有插件**：claude 删迷你执行器、迁 raw-event-first；pi 核对齐（已在表化路径上，收尾差异）。迁移与规范同批交付。

### 非目标

- 多 runtime 同时挂载 / 会话级 runtime 归属（路线图，另立 spec）。
- 改动 canonical 事件词汇本身（v2 词汇不动）。
- `packages/runtime-kit` 发 npm（先仓库内消费，稳定后再裁决）。
- 桌面 / TUI 渲染层改动（本批零桌面改动，除 Config 页展示 coverage 徽章——若做，为独立小任务）。

### 反目标（技术上成立也算失败）

- 破坏存量插件：自翻译插件必须能继续工作（逃逸声明 + 警告，不是禁绝）。
- 让「最小 runtime」更难写：core preset 的必备面数量不得增加。
- 校验规则只挡好人不挡漂移：每条强制必须 fail-loud 且报错文本指出修复动作。

## 3. 现状盘点（as-is，实测数据）

### 3.1 契约单源

- `gateway/src/runtime/contract-manifest.ts` + `contract-surfaces-core.ts`（48 面）+ `contract-surfaces-agent.ts`（56 面）= **104 面**；`contract-capabilities.ts`（23 能力）；`contract-presets.ts`（4 preset：core / conversation / autonomous / desktop）；`contract-cognition.ts`（6 动词：observe / injectContext / injectSystem / tools / gate / rewrite）；事件从 `mafw-vocabulary.ts` 投影（29 runtime 事件 + 15 扁平广播名）。
- 导出：`scripts/emit-runtime-contract.ts` → `packages/gateway-sdk/contract/runtime-contract.json`；运行时 `GET /api/runtime/contract`；SDK `runtime.contract()`。
- 校验三件套：`validateManifest`（结构不变量）、`coverage.ts`（覆盖分级）、`validate.ts`（激活期形状校验）。

### 3.2 RuntimeClient 接口面（contract.ts，640 行）

- session 域 ~20 方法（create/prompt/promptAsync/messages/normalizeMessages/get/delete/update/abort/list/listByDirectory/todo/children/switchAgent/switchModel/setThinkingLevel/summarize/permissionReply/permissionList/question/fork/revert/unrevert/diff/vcs/instructions）。
- 工具通道 `tools`（Tier-0 必选，无能力位）；可选 channel：discovery / mcp(+config) / completion / agents / shell / credentials。
- `AgentRuntime` 进程面：name / capabilities / external / getBaseUrl / healthCheck / agentProcess / resolveEventEntry（方言探测）。

### 3.3 事件翻译链

- gateway 侧执行器：`event-mapper.ts`（`applyEventMappings`：mappings 数组序 first-match → transformEvent 逃逸 → 拦截+计数；`wrapGlobalEventStream` 接线）。
- loader 已支持插件模块导出 `eventSource/eventMappings/transformEvent` 并做加载期校验（未知 canonical to / 坏路径 / eventStream 无声明 → 能力降级）。README 已写明 "No hand-written translation layer"。
- **但现状两个新适配器都没走这条路**：claude 在包内用迷你执行器自翻译后推 canonical；pi 在 gateway 树内、表化（PI_EVENT_MAPPINGS）但由自己的 translate 函数执行。

### 3.4 三个 runtime 实例的工作量分布

| | opencode（内置参照物） | pi | claude（最新案例，adapters/claude） |
|---|---|---|---|
| 代码量 | adapter 802 + runtime 517 + 两张事件表 ~580 | pi-runtime 325 + pi/* 助手 ~1300 | ~750（runtime 224 / events 310 / history 114 / index 46） |
| 重复手写 | — | 会话注册表、事件总线 fan-out、审批桥、历史归一化 | **迷你 event-mapper 执行器（~50 行，与 gateway 语义子集，注释自认漂移风险）**、会话注册表、事件总线、turn.started 合成状态机、工具 stash→MCP 桥 |
| 能力声明 | 单源 | 单源 | **双份（index.ts + runtime.ts）——当前逐字段一致，但漂移无防线（gateway 消费实例侧、loader 展示模块侧，不一致时零告警）** |

### 3.5 缺口清单（gap → 设计条目）

| # | 缺口 | 设计条目 |
|---|---|---|
| GAP-1 | 插件包自翻译事件，gateway 真执行器被旁路 | §4.1 raw-event-first + preTranslated 逃逸 |
| GAP-2 | plumbing 四件套逐适配器重写 | §4.2 packages/runtime-kit |
| GAP-3 | 能力声明双份无防线；反向校验缺位（实现存在+未声明不生效）；正向 presence 门禁已存在于 validate.ts | §4.3 单源盖印 + 反向校验（增量，非重建） |
| GAP-4 | 脚手架不含 manifest，作者不知道每档要填哪些面；one-api 模板发 v1 旧词汇出生即死 | §4.4 codegen 读 runtime-contract.json + 模板重写 |
| GAP-5 | 强制只到「加载期降级」，无 CI 门禁、无声明↔实现门禁 | §4.5 三级强制链 |

## 4. 设计

### 4.1 raw-event-first（G1）

**规则**：声明 `eventStream: true` 的插件，默认必须导出 `eventSource + eventMappings`（可选 `transformEvent` 逃逸）。插件的 `global.event()` 推**原生事件**，gateway 的 `wrapGlobalEventStream` 统一翻译。

**逃逸**：模块导出 `eventTranslation: 'self'`（缺省 `'declared'`）= 显式签名画押「我自己翻译」。逃逸插件：

- 不再要求 eventMappings（现状的降级规则对它放宽为 warn）；
- coverage 报告与 `GET /api/runtime` 标注 `translation: 'self'`，桌面 Config 显示「自翻译（不推荐）」；
- conformance 的 `unmatched === 0` 断言对逃逸插件改为断言「事件字段契约零警告」。

**进程内事件源适用性**：raw-event-first 不要求 wire 流。claude 的事件来自 SDK query 的 async iterator——插件把原生 SDKMessage（附 session_id）原样推入 `global.event()` 总线即可。

**stateful 合成的归属（builder-check Q1 裁决）**：`applyEventMappings` 是 first-match——映射行命中后**不会**调 `transformEvent`，因此「turn.started 合成 / result 复位」这类跨事件状态机**不能**留在 transformEvent（claude 现状恰恰把复位挂在自家迷你执行器的映射命中分支上，直接删会静默丢失）。裁决：

- turn.started 合成（每回合首条 user 标记 + 终态/失败复位）收进 kit 的 `createTurnTracker`，形态是**插件侧 raw-stream 前置 tap**：包装插件总线的 `push`，在原生事件进总线前观察，需要时**补发 canonical `turn.started`**（经插件声明的 canonicalIdentity 恒等行放行——恒等行注册本来就是既有约定）。
- **显式例外**：插件本地检测到的失败（如 spawn 失败，没有任何原生事件可推）允许直接推 canonical `turn.failed`——同样经恒等行。规则表述为「原生事件只推 raw；本地合成的终态/起点事件可直推 canonical 且必须经恒等行声明」，不是「插件只推原生事件」的绝对禁令。

**loader 改动**：

- `EventMappingEntry` 增 `eventTranslation?: 'declared' | 'self'`；
- 校验矩阵：`eventStream && declared && !hasDeclarations` → 降级（现状保留）；`eventStream && self` → 不降级、coverage 标注；`eventTranslation:'self'` 同时导出 eventMappings → error 状态（矛盾声明）；
- README 与编写指南更新：declared 为唯一推荐路径，self 为遗留/特殊逃逸。

### 4.2 `packages/runtime-kit`（G2）

仓库内新包（workspace 成员；**v1 仅作 adapters 的构建期依赖**，`adapters/*/build.mjs` 打包时内联进单文件产物；gateway 本体与 pi **不依赖它**，避免 deploy-local / root files 发布工程）。v1 只收三个被实测重复两次以上的机械：

1. **`createSessionRegistry`**：Map<sid, state> + busy/queue/shift-flush + abort 清队。取代 claude `SessionState` 与 pi `PiSessionRegistry` 的重复实现（pi 的会话亲和字段留在 pi 侧，registry 接受泛型 state）。
2. **`createEventBus`**：listener 集合 + `push` + `event(): { stream: AsyncIterable }`（queue/waiter 配对），即 claude `bus` 与 pi `PiEventStream` 的公共核。
3. **`createTurnTracker`**：插件侧 raw-stream 前置 tap——包装总线 `push`，观察原生事件流，每回合首条 user 消息时补发 canonical `turn.started`、终态/失败时复位（取代 claude `turnStartedBySession` 手写与迷你执行器命中分支里的复位逻辑）。

显式不收：历史归一化（各家形状差异大，v1 只有 claude/pi 两个样本，抽象会错）、审批桥（pi 独有）、工具桥（各家注册机制差异大）。这些等第三个样本出现再收敛。

### 4.3 能力声明单源 + 声明↔实现校验（G3）

**现状基线（builder-check 事实修正）**：正向门禁已部分存在——`validate.ts` 在激活期对每个声明为 true 的能力跑 `requires` 面的 presence 探针（如 `completionApi → completion.complete`、`mcpApi → mcp.list`），缺席即降级。今天 gateway 实际消费的是**实例侧** `rt.capabilities`（`index.ts` 激活时赋给 `runtimeCaps`），模块侧声明只进 loader 展示——两份声明不一致时「展示与生效不符」无任何告警（claude 双份声明当前逐字段一致，但漂移无防线）。

**本批增量（不是重建）**：

- **单源盖印**：`module.exports.capabilities` 为唯一声明点。实例化后 gateway 用模块声明解析结果**普通赋值覆盖** `rt.capabilities`（保持可写——激活期降级路径（coverage.ts `applyEventStreamDeclarationDowngrade`、validate.ts 降级回写）继续在同一个对象上工作，不得用 non-writable `defineProperty`）。实例自带 capabilities 且与模块声明不一致 → error 状态（矛盾声明）+ 以模块声明为准覆盖。内置 runtime（opencode/pi）同规则收敛。
- **反向校验（新）**：实例存在某 channel/方法而对应能力未声明 → 自动补 true + warn（「实现了就让它生效」，提示把声明写进 module.exports）。能力 ↔ 探针映射**复用既有 `contract-capabilities.ts` 的 requires/probe 数据**，不另建 CAPABILITY_CHANNELS 表；缺探针的能力面逐条补齐 probe。
- 行为型能力（promptWhileBusy / steerApi / turnBudgetApi 等无 channel 可探的）保持 attested（声明即信），由 conformance 场景兜底。

claude 的双份声明随迁移删除 runtime.ts 那份（另一处事实修正：当前两份逐字段一致，本设计消灭的是「漂移无防线」的结构性风险，而非已发生的漂移）。

### 4.4 manifest 驱动脚手架（G4）

`generate-runtime-plugin.mjs` 升级：

- 新增 `--preset core|conversation|autonomous|desktop`（缺省 conversation）；
- 读 `packages/gateway-sdk/contract/runtime-contract.json`，按 preset 的 `requiredSurfaces` 生成骨架：每个必备面一个带 `// TODO(contract:<surface-id>)` 注释的桩（session 方法 / eventMappings 行 / tools 通道），TODO 注释写该面的 `title`（manifest 字段名是 title/impact，无 summary）；
- 生成物自包含 `eventTranslation: 'declared'` + 空的 `eventSource/eventMappings` 骨架（注释指路 dry-event 试衣间）；
- `--check` 模式：对既有插件文件输出「声明 preset 的缺面清单」（dry-run 版 plugin-check，见 §4.5）；
- **既有 one-api 模板不能字面保留**（builder-check 事实修正）：它发射的是 v1 旧词汇（`session.idle` / `message.part.updated` / `session.error`，均不在 canonical v2），且零声明——在当前 loader 下出生即被降级、事件全部落 default-deny。本批**重写**该模板的事件出口到 v2 词汇 + declared 映射行（`--template openai` 变体），不是原样保留。

### 4.5 三级强制链（G5）

| 级 | 时机 | 机制 | 本批新增 |
|---|---|---|---|
| L1 加载期 | 插件 require / 实例化 | validate.ts 形状校验、事件映射校验、**声明↔实现校验（新）**、矛盾声明 error | 声明↔实现校验、capabilities 盖印 |
| L2 激活期 | runtime 接线 | 能力降级（现有）+ coverage 标注（自翻译/降级原因进 `GET /api/runtime`） | coverage 理由字段 |
| L3 CI/手动 | `mafw plugin-check <file>` | **离线静态档**（不需要 LLM 凭据、不切换 active runtime）：隔离试载 → validate → 声明↔实现校验 → dry-event 冒烟；样本事件来自新增的**可选模块导出 `sampleEvents`**（原生事件数组，codegen 骨架自带占位）。非零退出码挂 CI。在线 conformance（chat-roundtrip 等需真实 LLM 往返的场景）**不并入** plugin-check，仍由既有 `mafw plugin-test`（对 active runtime）承担；plugin-check 输出里提示下一步跑 plugin-test | 整条命令 + `sampleEvents` 约定 |

桌面 Config 的 runtime 行展示 coverage 百分比与降级原因（若本批来得及；否则留 follow-up，API 面先就位）。

### 4.6 迁移：claude / pi（G6）

**claude**（adapters/claude）：

1. `src/events.ts`：删迷你执行器（getPath/setPath/evalField/matchWhen/组合执行段）；`CLAUDE_EVENT_SOURCE` / `CLAUDE_EVENT_MAPPINGS` / `claudeTransformEvent` 从 index.ts 模块导出；turn.started 合成与 result 复位迁入 kit `createTurnTracker`（注意：复位不能指望 transformEvent——gateway 执行器 first-match，命中行不到逃逸口）；
2. `src/runtime.ts`：`spawn` 循环推原生 SDKMessage（`{...msg, session_id}`）入总线（经 turnTracker tap），不再本地翻译；spawn 失败直推 canonical `turn.failed`（恒等行放行）；capabilities 声明删（留 index.ts 单源）；会话注册表与事件总线换 kit；
3. `tests/events.test.ts`：改为经 gateway 真 `applyEventMappings` 执行同一张表（构建期 devDependency 引用，不进产物）；
4. 验收：`adapters/claude` 全部测试绿 + `mafw plugin-check` 对构建产物过 core→conversation 档。

**pi**（gateway/src/runtime/plugins/pi-runtime.ts）：已表化（PI_EVENT_MAPPINGS 由 `pi-events.ts` 内部调 gateway `applyEventMappings` 执行，gateway wrap 对其恒等放行——语义已在声明路径上）。本批只做：能力声明收敛到模块侧单源（实例不再重复声明）；**不迁 kit**（pi 的会话注册表携带 SDK session 亲和字段，且 pi 在 gateway 树内——kit v1 仅供 adapters 打包，见 §4.2）。

### 4.7 兼容性

存量插件的判定矩阵（builder-check 事实修正：推 canonical 但**零声明**的插件现状已被 loader 强制 eventStream 降级，不属于「现状能工作」的存量）：

| 插件形态 | 判定 | 处置 |
|---|---|---|
| 导出 `eventTranslation: 'declared'`（或有 eventMappings/transformEvent） | declared | 新规则全量适用 |
| 导出 `eventTranslation: 'self'` | self | 放行 + coverage 标注「自翻译（不推荐）」 |
| 未导出且推 canonical（有恒等/映射声明） | `self(legacy)` | 现状行为保留 + 标注；下个 major 再考虑收紧缺省 |
| 未导出且零声明 + `eventStream: true` | 非法（现状即如此） | 强制降级 + error 状态（不变） |

- 内置 opencode：事件已是 canonical，走既有恒等行路径，零改动。
- 契约 JSON 增字段（`eventTranslation`、coverage 理由）为 additive，`SCHEMA_VERSION` 保持 1。

## 5. 验证策略（TDD）

- 每个新机制先红后绿：loader 校验矩阵（eventTranslation 三态 × eventStream × 声明有无）、capabilities 盖印与矛盾检测、CAPABILITY_CHANNELS 降级/自动补、kit 三件套（registry/bus/turnTracker）纯逻辑、codegen 输出快照、plugin-check 退出码。
- 全量门禁：gateway `npx jest --runInBand --forceExit`、desktop `npm test`、`tsgo -p` / `tsc` rc=0、adapters/claude 自身测试。
- 真机冒烟：claude 插件经 `POST /api/runtime/switch` 热切换后跑一个流式回合，桌面能看到 delta + 工具卡 + 终态。

## 6. 留给实现者的

- kit 包的具体 API 签名（以 claude/pi 迁移时的实际调用点为准收敛）；
- `CAPABILITY_CHANNELS` 的完整映射表初值（按 contract-capabilities 逐条过）；
- plugin-check 的 CLI 参数形态；
- Config 页 coverage 徽章是否随本批（默认留 follow-up）。
