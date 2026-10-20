# Runtime 架构统一批设计 spec

日期：2026-10-20 · 状态：已批准待实施 · 前置调研：`docs/research/2026-10-20-tool-canonical-translation-layer-research.md`（commit 1fa90123，canonical 方案 B）+ 架构投影讨论（builtin 与其他 runtime 一致）· 前置契约：v4.30 工具注册（2026-10-15 spec）+ 显示链两帧合成（2026-10-20 spec）

## 1. 目标与非目标

**目标（四切片，顺序即依赖序）**：
1. **B 翻译注册面校验强化**：函数型注册（`transformEvent`/`normalizeMessages`）的输出形状守卫——违规/抛错 = 限频 ERROR + per-runtime 计数 + `GET /api/runtime` 暴露，**不再静默**；类型收紧给 TS 消费者编译期报错；
2. **A canonical 翻译层**：静态别名表 + `NativeToolDeclaration.canonical` 声明 + gateway 双出口 enrich（live + 历史）+ 渲染四级查找链 + read 域多 key 链 + 聚合键；
3. **D 加载收敛**：createRuntime 分支合一、switch 端点 `'opencode'` 特判删除——opencode 纯粹作为 `registerBuiltin('opencode')` 注册表成员；
4. **C 通道统一（带验证门）**：六件套补挂 MCP 面（单一 factory 源）→ opencode 全会话可得；v1 插件 `src/tools/` 六件退役**以验证门为准**（serve worker 会话 MCP 可见性）。

**非目标**：载荷结构强转（per-alias keyMap，codex 式构造器——调研 §3.1 方案 C 否决）；历史行 canonical 回填（enrich 只在出口，存量 trajectory 不改）；MCP 工具卡桌面渲染改动（registerAliased 已覆盖 `mafw_*` 前缀）。

## 2. 现状缺口（当日实读）

| 缺口 | 位置 | 后果 |
|---|---|---|
| transformEvent 输出零校验、无 try/catch | event-mapper.ts:101-105 | 垃圾形状静默入流；**抛错打断整条事件流迭代** |
| normalizeMessages 返回形状零检查 | normalize-messages.ts:5-13 | 历史渲染无声劣化（回退原文无告警） |
| `TransformEventFn` 返回值 `any` | event-mapper.ts:34 | TS 编译期不设防 |
| 渲染层按字面名精确匹配 | message-part.tsx:1564/1641 | `Bash`/`command_execution` → 通用兜底卡 |
| 历史 parts 无 toolClass/canonical | enrich 只在 live（index.ts:1127） | 历史(含 opencode 自身)工具块无身份标注 |
| pi read `path` vs 卡读 `filePath` | pi read.js:17 vs message-part.tsx:493 | 同名工具卡片副标题失明 |
| createRuntime 三分支 + switch 特判 | index.ts:1307-1377 / runtime-switch.ts:70 | opencode 加载路径特殊化 |
| 六件套双通道 | v1 插件 src/tools vs 契约 factory | 描述文本双源债；worker 会话依赖插件原生 |

## 3. 决策记录

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 守卫失败策略 | **loud + counted + surfaced**：限频 ERROR（30s per-runtime，isMalformedEvent 同模式）+ 计数 + `/api/runtime.translationErrors`；normalizeMessages 违规仍回退原文（历史可用性不破坏——可见但不 500） | 硬失败（历史/事件流可用性倒退） |
| D2 transformEvent 抛错 | try/catch → drop + 计数（**修断流 bug**：当前异常沿迭代器上抛可杀订阅循环） | — |
| D3 类型收紧 | `TransformEventFn = (raw:any) => RawRuntimeEvent \| RawRuntimeEvent[] \| null \| undefined`；`.js` 插件无编译 → dry-event 实调回显形状判定（等价编译检查） | 只收紧类型（JS 插件不设防） |
| D4 canonical 载体 | `part.canonicalTool` additive，gateway 双出口 enrich（live = index.ts:1127 同点；历史 = messages 路由出口，**全 runtime** 不只 normalizeMessages 声明者）——`wrapRuntimeMessages` 只包 pi，opencode 历史不经过它 | 前端内置表（runtime 声明进不了前端，双源） |
| D5 原名不改写 | `part.tool` 永不动（审批/obs/对账用原生名）；canonical 只做下游视图 | 改写（10-13 additive 决策不 reopen） |
| D6 别名准入 | 形状兼容才进表（调研 §2.2 矩阵）；read 域分歧由消费侧多 key 链消化（`filePath ?? path ?? file_path`，commandTextOf 先例） | alias 表带 keyMap（方案 C，YAGNI） |
| D7 class 家族卡 | session-ui `CLASS_FAMILY` 映射 class→代表内建卡名（shell→bash / readonly→read / search→grep / file-edit→edit / subagent→task / web→webfetch / plan→todowrite）——未知名也有过得去的卡 | desktop 家族卡改造（session-ui 内建卡已够） |
| D8 六件套 MCP 补挂 | MCP handlers 包装 `buildMafwToolFactory` 注册项（与 /api/tools/execute 同单源）；MCP 调用由 opencode 自发工具事件（无需合成帧） | 复制实现（三源） |
| D9 v1 六件退役 | **验证门**：实测 serve 派生 worker 会话是否可见 MCP 工具——可见则退役，不可见则 worker 保留插件原生路径（部分达成，不硬切） | 盲切（AGENTS.md 记录 v1 时代 worker 无 MCP——未验证现状） |
| D10 加载收敛 | config.runtime.plugin 缺省 = `get('opencode')`（loader 注册表成员）；direct import fallback 仅留作 loader 缺失安全网 | 保留三分支（特殊化继续） |

## 4. 设计

### 4.1 B：校验强化

- **event-mapper.ts**：`applyEventMappings` 内 transformEvent 调用包 try/catch + 输出守卫（合法 = null/undefined / 对象(payload?.type 或 type 非空串) / 其数组）；违规或抛错 → drop + 新增 `onTranslationError(runtimeName?)` 回调（index.ts 注入计数器）；`TransformEventFn` 类型收紧（D3）——内置件/pi 同批适配（PI transformEvent 输出本就合法，预期零改动）；
- **normalize-messages.ts**：`applyNormalizeMessages` 增输出守卫（Array 且逐项 `parts` 为数组）；违规 → ERROR 日志 + `onViolation` 回调计数 + 回退原文；`wrapRuntimeMessages` 透传回调（index.ts `wrapRuntimeIdentity` 处注入）；
- **index.ts**：`translationErrors: Map<runtime, {transformEvent, normalizeMessages, lastError, lastAt}>`——runtime 切换时清空；`handleRuntimeGet` deps 增 `translationErrors()`；
- **dry-event**：守卫位于 applyEventMappings → 样本落入 transformEvent 路径时响应自动携带违规信息（零额外逻辑，仅确认回显）；
- **conformance**：`session-lifecycle` 场景增历史形状断言（create 后拉 messages，`{info,parts[]}` 合法）。

### 4.2 A：canonical 翻译层

- **tool-classes.ts**：`TOOL_CANONICAL_TABLE`（调研矩阵：`command_execution/shell/powershell→bash`、`ls→list`、`find→glob`、`file_change→edit`、`collab_tool_call→task`、`web_search→websearch`、`todo_list→todowrite`…；小写归一顺带覆盖 `Bash→bash`、`Read→read`）；`canonicalToolOf(name)`：overlay 声明 → 静态表 → 已是 opencode 名（TOOL_CLASS_TABLE 命中）则返回小写 → undefined；`setToolClassOverlay` 条目扩展 `canonical?`；
- **contract.ts**：`NativeToolDeclaration.canonical?: string`；
- **enrich 双出口**：live = 现有 enrich 点扩为 `enrichToolIdentity`（toolClass + canonicalTool 一趟）；历史 = messages 路由出口 `enrichHistoryParts(data)`（幂等，补两字段，全 runtime）；
- **session-ui**：查找链 `render(part.tool) ?? render(part.canonicalTool) ?? render(CLASS_FAMILY[part.toolClass]) ?? GenericTool`（message-part.tsx:1641）；`getToolInfo`/`contextToolTrigger`/`CONTEXT_GROUP_TOOLS`/步骤摘要先解析 `displayTool = part.canonicalTool ?? part.tool`；read 副标题多 key `filePath ?? path ?? file_path`；
- **聚合键**：trajectory collector（:202/213）与 TUI recap（session-recap.ts:37）改 `canonicalTool ?? tool`。

### 4.3 D：加载收敛

- `createRuntime`：`pluginName = config.runtime?.plugin || 'opencode'` 单查找路径（loader.get 已统一优先级 文件>包>内置）；`'opencode'` 不再绕过校验；direct import 分支仅当 loader 未注册 opencode 时兜底（安全网，注释标注）；
- `runtime-switch.ts`：删除 `plugin !== 'opencode'` 特判（'opencode' 走 loader 校验，注册表成员语义）。

### 4.4 C：通道统一（带验证门）

- **C1（无门，安全）**：`mcp/tool-registry.ts` 补挂五工具（python/python_restart/media_speak/media_upload/media_ask——`mafw_add_memory` 已在）；定义与执行均出自 `MAFW_TOOL_SPECS` + `buildMafwToolFactory`（第三处消费同一单源）；
- **C2**：opencode `registerTools` ack 日志升级为通道声明（six-piece 经 MCP 面 + v1 插件）；
- **C3（验证门后）**：实测 serve worker 会话工具可见性——可见 → v1 插件 `src/tools/` 六件退役（transforms/hooks/MCP 自接线保留）；不可见 → 保留 worker 路径，C2 声明改为"MCP（用户会话）+ 插件（worker）"，双源债标注为部分收敛。

## 5. 实施清单（TDD，顺序 B→A→D→C）

1. **B**：event-mapper 守卫+类型收紧+onTranslationError；normalize-messages 守卫；index.ts translationErrors 计数与暴露；conformance session-lifecycle 历史断言；测试（守卫单元 + fake 违规计数 + dry-event 回显确认）；
2. **A**：tool-classes canonical 表+overlay 扩展+canonicalToolOf；contract.canonical；enrichToolIdentity 双出口；session-ui 查找链+displayTool+多 key；collector/recap 聚合键；测试（gateway ~10 + session-ui/desktop ~8）；
3. **D**：createRuntime 收敛 + switch 特判删除；测试（runtime-switch 现有用例适配）；
4. **C1**：MCP 五工具补挂（factory 单源包装）；测试（tool-registry 形状 + handler 分发）；
5. **C2/C3**：验证门执行（worker 会话工具可见性实测）→ 按结果走退役或部分收敛；文档（SKILL/AGENTS 同批）；
6. 全量回归（gateway jest + desktop bun test + build）。

## 6. 验收

- B：transformEvent 返回字符串/抛错 → 事件 drop + ERROR 日志 + `GET /api/runtime` 计数可见，事件流不断；normalizeMessages 返回垃圾 → ERROR + 回退原文 + 计数；TS 下违反新类型的 transformEvent 编译报错；
- A：`Bash`/`command_execution`/pi `ls` 的事件与历史 → 渲染对应 bash/list 卡；`part.canonicalTool`/`toolClass` 在 live 与历史两路径都存在；TUI recap 聚合不再按别名碎片化；
- D：`POST /api/runtime/switch {plugin:'opencode'}` 走 loader 校验路径成功；createRuntime 无 opencode 硬编码分支（安全网除外）；
- C：六件套经 MCP 面可调（`opencode mcp list` + 实调）；验证门结论记录进 AGENTS.md；
- 全量：gateway + desktop 套件绿 + build exit 0。

## 7. 风险与边界

- **transformEvent 类型收紧的波及面**：内置 opencode/pi 的 transformEvent 需同批核对输出形状（预期合法；若有隐性 any 依赖由 tsc 暴露）；
- **历史 enrich 性能**：messages 出口逐 part 解析为 Map 查询（O(parts)），千级 part 历史无感；幂等字段缺失才写；
- **canonical 表策展风险**：错配别名 → 卡片渲染错位——准入规则（形状兼容）+ 表内注明依据对；
- **C3 退役风险**：worker 无 MCP 时盲切 = worker 记忆写入断（高危）——验证门硬性前置，不可见不切；
- **旧客户端兼容**：canonicalTool/toolClass 为 additive 字段，旧 desktop/TUI 忽略即可。
