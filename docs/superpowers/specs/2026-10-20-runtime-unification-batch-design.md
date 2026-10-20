# Runtime 架构统一批设计 spec

日期：2026-10-20 · 状态：已批准待实施（**rev2**：删 C 切片——六件套 MCP 通道移出本批，属"工具通道"决策域；B 扩为 B1 入口执法 / B2 执行守卫 / B3 拦截可观测——**default-deny 声明制翻译入口**，用户拍板"只有声明的才能放行，还要注册翻译函数"）· 前置调研：`docs/research/2026-10-20-tool-canonical-translation-layer-research.md`（commit 1fa90123，canonical 方案 B）· 前置契约：v4.30 工具注册（2026-10-15 spec）+ 显示链两帧合成（2026-10-20 spec）

> **架构原则（本批立柱）**：runtime 声明翻译、gateway 执行翻译；**注册 = 唯一放行路径**。事件入口 default-deny——未命中任何注册翻译（表行 / transformEvent / 恒等行）的原生事件一律拦截 + 计数，无任何默认透传分支。工具身份翻译（A 切片）沿用同一模式：runtime 声明、gateway 单点解析。

## 1. 目标与非目标

**目标（三切片，顺序即依赖序）**：
1. **B 翻译入口统一执法**（三段）：
   - **B1 入口执法**：删除 canonical 直发分支——放行唯一条件 = 命中注册翻译；恒等翻译（identity 行）从词汇单源派生，opencode 改为 差异行 + identity 派生 显式注册；无声明 runtime = 加载期能力降级（不再 warning + 透传）；
   - **B2 执行守卫**：函数型注册（`transformEvent`/`normalizeMessages`）输出形状守卫 + try/catch——违规/抛错 = drop + 限频 ERROR + per-runtime 计数 + `GET /api/runtime` 暴露，不再静默（含断流 bug 修复）；类型收紧给 TS 消费者编译期报错；
   - **B3 拦截可观测**：drop 按类型持续计数（区分 未命中 vs 显式压制）；turn 终态类被拦 = 每次 loud warn；conformance 增 `unmatched === 0` 断言（升级后跑一遍即抓词汇漂移）；
2. **A canonical 翻译层**：静态别名表 + `NativeToolDeclaration.canonical` 声明 + gateway 双出口 enrich（live + 历史）+ 渲染四级查找链 + read 域多 key 链 + 聚合键；
3. **D 加载收敛**：createRuntime 分支合一、switch 端点 `'opencode'` 特判删除——opencode 纯粹作为 `registerBuiltin('opencode')` 注册表成员。

**非目标**：载荷结构强转（per-alias keyMap，codex 式构造器——调研 §3.1 方案 C 否决）；历史行 canonical 回填（enrich 只在出口，存量 trajectory 不改）；MCP 工具卡桌面渲染改动（registerAliased 已覆盖 `mafw_*` 前缀）；六件套 MCP 通道统一（**移出本批**——工具通道=各 runtime 插件自接 MCP，gateway 只管 MCP server，属并行批次决策域）；payload 字段级硬校验（只 warn 不挡，防 additive 误杀）。

## 2. 现状缺口（当日实读）

| 缺口 | 位置 | 后果 |
|---|---|---|
| **canonical 直发 = 默认放行漏洞** | event-mapper.ts 优先级链（eventMappings → canonical 直发 → transformEvent → drop） | 类型恰在词汇表内即透传，与 runtime 是否声明无关——未声明 runtime 的事件流无契约可言 |
| **无声明 = warning + 恒等透传** | wrapGlobalEventStream | "忘了声明"与"刻意直发"不可区分 |
| **未知事件只首次 warn** | event-telemetry.ts | 持续 drop 无计数，runtime 升级词汇漂移不可见 |
| transformEvent 输出零校验、无 try/catch | event-mapper.ts:101-105 | 垃圾形状静默入流；**抛错打断整条事件流迭代** |
| normalizeMessages 返回形状零检查 | normalize-messages.ts:5-13 | 历史渲染无声劣化（回退原文无告警） |
| `TransformEventFn` 返回值 `any` | event-mapper.ts:34 | TS 编译期不设防 |
| 渲染层按字面名精确匹配 | message-part.tsx:1564/1641 | `Bash`/`command_execution` → 通用兜底卡 |
| 历史 parts 无 toolClass/canonical | enrich 只在 live（index.ts:1127） | 历史(含 opencode 自身)工具块无身份标注 |
| pi read `path` vs 卡读 `filePath` | pi read.js:17 vs message-part.tsx:493 | 同名工具卡片副标题失明 |
| createRuntime 三分支 + switch 特判 | index.ts:1307-1377 / runtime-switch.ts:70 | opencode 加载路径特殊化 |

## 3. 决策记录

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 入口执法形态 | **声明制白名单（default-deny）+ 翻译注册为唯一放行**：canonical 同形事件经词汇单源派生的 identity 行（恒等翻译也是翻译）——无 blanket passthrough | `canonicalPassthrough: true` blanket 声明（用户否决——"只有声明的才能放行，还要注册翻译函数"，声明必须落到翻译注册） |
| D2 无声明处置 | 加载期 **eventStream 能力降级 + error 状态**（与未知 canonical `to` 同处置路径） | warning + 恒等透传（现状——两种意图不可区分） |
| D3 identity 行单源 | `canonicalIdentity()` 从词汇单源派生（MAFW 公开词汇 ∪ 内部三原语集）；opencode = 8 差异行 + identity 派生；词汇表加新类型自动覆盖（契约内类型即放行），runtime 私货新类型被拦逼显式注册 | 手写完整清单（opencode 发射面高频变化，维护不住） |
| D4 字段契约层级 | **类型白名单硬挡，payload 只 warn**：字段契约（event-field-contract）保持警告不拦截——runtime additive 字段变更不该被误杀成断流 | payload 硬校验（additive 变更=断流） |
| D5 拦截可观测 | per-type 持续计数 + **未命中 turn 终态类每次 loud warn** + conformance `unmatched === 0` 断言；drop 计数区分 **unmatched**（无翻译命中，监控信号）vs **suppressed**（transformEvent 显式 null，作者意图，单独计） | 维持首次 warn（词汇漂移=静默断流：BudgetGuard 不计数/goal driver 不推进/desktop 不刷新） |
| D6 守卫失败策略 | **loud + counted + surfaced**：限频 ERROR（30s per-runtime，isMalformedEvent 同模式）+ 计数 + `/api/runtime.translationErrors`；normalizeMessages 违规仍回退原文（历史可用性不破坏——可见但不 500） | 硬失败（历史/事件流可用性倒退） |
| D7 transformEvent 抛错 | try/catch → drop + 计数（**修断流 bug**：当前异常沿迭代器上抛可杀订阅循环） | — |
| D8 类型收紧 | `TransformEventFn = (raw:any) => RawRuntimeEvent \| RawRuntimeEvent[] \| null \| undefined`；`.js` 插件无编译 → dry-event 实调回显形状判定（等价编译检查） | 只收紧类型（JS 插件不设防） |
| D9 canonical 载体 | `part.canonicalTool` additive，gateway 双出口 enrich（live = index.ts:1127 同点；历史 = messages 路由出口，**全 runtime** 不只 normalizeMessages 声明者）——`wrapRuntimeMessages` 只包 pi，opencode 历史不经过它 | 前端内置表（runtime 声明进不了前端，双源） |
| D10 原名不改写 | `part.tool` 永不动（审批/obs/对账用原生名）；canonical 只做下游视图 | 改写（10-13 additive 决策不 reopen） |
| D11 别名准入 | 形状兼容才进表（调研 §2.2 矩阵）；read 域分歧由消费侧多 key 链消化（`filePath ?? path ?? file_path`，commandTextOf 先例） | alias 表带 keyMap（方案 C，YAGNI） |
| D12 class 家族卡 | session-ui `CLASS_FAMILY` 映射 class→代表内建卡名（shell→bash / readonly→read / search→grep / file-edit→edit / subagent→task / web→webfetch / plan→todowrite）——未知名也有过得去的卡 | desktop 家族卡改造（session-ui 内建卡已够） |
| D13 加载收敛 | config.runtime.plugin 缺省 = `get('opencode')`（loader 注册表成员）；direct import fallback 仅留作 loader 缺失安全网 | 保留三分支（特殊化继续） |

## 4. 设计

### 4.1 B1：入口执法（default-deny + 声明制放行）

- **event-mapper.ts 优先级链变更**：删除「canonical 直发 passthrough」分支——新链：**eventMappings（数组序）→ transformEvent（B2 守卫后）→ drop + 计数**。放行唯一条件 = 命中注册翻译；identity 行语义钉扎：`{from: t, to: t}` 无 when/fields = 恒等翻译原样放行（实现中确认无 fields 行为 verbatim passthrough，测试钉扎）；
- **`canonicalIdentity()` helper**（event-mapper 或 mafw-vocabulary 侧）：从词汇单源生成恒等行——公开词汇（MAFW 常量）∪ 内部三原语（tool.call/delta/result）；
- **opencode 注册改造**（runtime/opencode-events.ts）：`OPENCODE_EVENT_MAPPINGS = [...DIFF_ROWS(现 8 行), ...canonicalIdentity()]`——不再依赖直发分支；transformEvent 前缀丢弃（session.next.*/sync）保留（其 null 返回计 suppressed）；
- **pi audit**：核对 PI_EVENT_MAPPINGS 覆盖面——pi 原生事件名均非 canonical 类型（预期全表达标零改动），实读确认无靠直发分支进入的事件，若发现则补行；
- **loader.ts**：无 eventMappings 且无 transformEvent 声明的 runtime → eventStream 能力降级 + error 状态（沿用未知 canonical `to` 的既有处置）；
- **字段契约**：保持 warn 不硬挡（D4）。

### 4.2 B2：执行守卫

- **event-mapper.ts**：`applyEventMappings` 内 transformEvent 调用包 try/catch + 输出守卫（合法 = null/undefined / 对象(payload?.type 或 type 非空串) / 其数组）；违规或抛错 → drop + 新增 `onTranslationError(runtimeName?)` 回调（index.ts 注入计数器）；`TransformEventFn` 类型收紧（D8）——内置件/pi 同批适配（PI transformEvent 输出本就合法，预期零改动）；
- **normalize-messages.ts**：`applyNormalizeMessages` 增输出守卫（Array 且逐项 `parts` 为数组）；违规 → ERROR 日志 + `onViolation` 回调计数 + 回退原文；`wrapRuntimeMessages` 透传回调（index.ts `wrapRuntimeIdentity` 处注入）；
- **index.ts**：`translationErrors: Map<runtime, {transformEvent, normalizeMessages, lastError, lastAt}>`——runtime 切换时清空；`handleRuntimeGet` deps 增 `translationErrors()`；
- **dry-event**：守卫位于 applyEventMappings → 样本落入 transformEvent 路径时响应自动携带违规信息（零额外逻辑，仅确认回显）；
- **conformance**：`session-lifecycle` 场景增历史形状断言（create 后拉 messages，`{info,parts[]}` 合法）。

### 4.3 B3：拦截可观测

- **drop 计数**：入口拦截按类型持续计数（首次 warn 保留，计数不封顶），区分两类——**unmatched**（无翻译命中：监控信号，进 `dropped` 计数）vs **suppressed**（transformEvent 显式 null：声明式压制，单独计数）；`GET /api/runtime` 暴露 `dropped: {type: count}`；runtime 切换清空（translationErrors 同生命周期）；
- **关键事件 loud warn**：unmatched 事件类型 ∈ turn 终态类（turn.completed/failed/aborted）→ **每次** warn（不只首次）——终态断流是最危险的静默失效（BudgetGuard/goal driver/desktop 全依赖）；
- **conformance 断言**：S1 chat-roundtrip / S2 session-lifecycle 跑完断言 `unmatched === 0`（suppressed 白名单除外，如 session.next.*）——升级 runtime 后跑 conformance 即抓词汇漂移。

### 4.4 A：canonical 翻译层

- **tool-classes.ts**：`TOOL_CANONICAL_TABLE`（调研矩阵：`command_execution/shell/powershell→bash`、`ls→list`、`find→glob`、`file_change→edit`、`collab_tool_call→task`、`web_search→websearch`、`todo_list→todowrite`…；小写归一顺带覆盖 `Bash→bash`、`Read→read`）；`canonicalToolOf(name)`：overlay 声明 → 静态表 → 已是 opencode 名（TOOL_CLASS_TABLE 命中）则返回小写 → undefined；`setToolClassOverlay` 条目扩展 `canonical?`；
- **contract.ts**：`NativeToolDeclaration.canonical?: string`；
- **enrich 双出口**：live = 现有 enrich 点扩为 `enrichToolIdentity`（toolClass + canonicalTool 一趟）；历史 = messages 路由出口 `enrichHistoryParts(data)`（幂等，补两字段，全 runtime）；
- **session-ui**：查找链 `render(part.tool) ?? render(part.canonicalTool) ?? render(CLASS_FAMILY[part.toolClass]) ?? GenericTool`（message-part.tsx:1641）；`getToolInfo`/`contextToolTrigger`/`CONTEXT_GROUP_TOOLS`/步骤摘要先解析 `displayTool = part.canonicalTool ?? part.tool`；read 副标题多 key `filePath ?? path ?? file_path`；
- **聚合键**：trajectory collector（:202/213）与 TUI recap（session-recap.ts:37）改 `canonicalTool ?? tool`。

### 4.5 D：加载收敛

- `createRuntime`：`pluginName = config.runtime?.plugin || 'opencode'` 单查找路径（loader.get 已统一优先级 文件>包>内置）；`'opencode'` 不再绕过校验；direct import 分支仅当 loader 未注册 opencode 时兜底（安全网，注释标注）；
- `runtime-switch.ts`：删除 `plugin !== 'opencode'` 特判（'opencode' 走 loader 校验，注册表成员语义）。

## 5. 实施清单（TDD，顺序 B1→B2→B3→A→D）

1. **B1**：canonicalIdentity helper + identity 行 verbatim 语义测试；优先级链删直发分支 + unmatched/suppressed 双计数；opencode-events 改差异行 + identity 派生 + **词汇完备性测试**（MAFW.EVENTS 逐类型过 opencode 注册面全部命中）；pi audit（实读 PI_EVENT_MAPPINGS vs pi 事件源）；loader 无声明降级；测试（fake runtime 无声明 → 降级；vocab 外类型 → drop+计数；canonical 形状但无行 → 不再透传）；
2. **B2**：event-mapper 守卫+类型收紧+onTranslationError；normalize-messages 守卫；index.ts translationErrors 计数与暴露；conformance session-lifecycle 历史断言；测试（守卫单元 + fake 违规计数 + dry-event 回显确认）；
3. **B3**：dropped per-type 计数 + /api/runtime 暴露 + turn 终态 loud warn；conformance unmatched===0 断言；测试；
4. **A**：tool-classes canonical 表+overlay 扩展+canonicalToolOf；contract.canonical；enrichToolIdentity 双出口；session-ui 查找链+displayTool+多 key；collector/recap 聚合键；测试（gateway ~10 + session-ui/desktop ~8）；
5. **D**：createRuntime 收敛 + switch 特判删除；测试（runtime-switch 现有用例适配）；
6. 文档：AGENTS.md §5.19 事件映射注册段更新（优先级链、无声明处置、identity 派生、drop 计数语义）；
7. 全量回归（gateway jest + desktop bun test + build）。

## 6. 验收

- B1：未注册类型（fake runtime 发 vocab 外类型）→ drop + `dropped` 计数可见；canonical 形状事件无 identity 行 → **不再透传**；opencode 事件流全量进入（差异行+identity 行，现有 SSE 集成测试全绿 + 词汇完备性测试通过）；无声明 fake runtime → 加载期 eventStream 降级 + error 状态；
- B2：transformEvent 返回字符串/抛错 → 事件 drop + ERROR 日志 + `GET /api/runtime` 计数可见，事件流不断；normalizeMessages 返回垃圾 → ERROR + 回退原文 + 计数；TS 下违反新类型的 transformEvent 编译报错；
- B3：turn.completed unmatched → 每次 warn；conformance 场景断言 unmatched===0 通过；suppressed（session.next.*）不误报；
- A：`Bash`/`command_execution`/pi `ls` 的事件与历史 → 渲染对应 bash/list 卡；`part.canonicalTool`/`toolClass` 在 live 与历史两路径都存在；TUI recap 聚合不再按别名碎片化；
- D：`POST /api/runtime/switch {plugin:'opencode'}` 走 loader 校验路径成功；createRuntime 无 opencode 硬编码分支（安全网除外）；
- 全量：gateway + desktop 套件绿 + build exit 0。

## 7. 风险与边界

- **词汇漂移静默断流（本批最大系统性风险）**：runtime 升级改名终态事件 → 旧映射不匹配 → 拦截 → BudgetGuard 不计数/goal driver 不推进/desktop 不刷新，且默认无信号——B3 可观测性（持续计数+终态 loud warn+conformance 断言）为硬配套，不可裁剪；
- **identity 行依赖词汇单源**：词汇表加新 canonical 类型 → 所有 identity 派生 runtime 自动放行——有意语义（契约内类型即放行，拦的是 runtime 私货类型）；单源由 mafw-vocabulary.ts ↔ SDK events.ts 交叉测试钉扎，无第二名单；
- **transformEvent 类型收紧波及面**：内置 opencode/pi 的 transformEvent 需同批核对输出形状（预期合法；若有隐性 any 依赖由 tsc 暴露）；
- **历史 enrich 性能**：messages 出口逐 part 解析为 Map 查询（O(parts)），千级 part 历史无感；幂等字段缺失才写；
- **canonical 表策展风险**：错配别名 → 卡片渲染错位——准入规则（形状兼容）+ 表内注明依据对；
- **旧客户端兼容**：canonicalTool/toolClass 为 additive 字段，旧 desktop/TUI 忽略即可。
