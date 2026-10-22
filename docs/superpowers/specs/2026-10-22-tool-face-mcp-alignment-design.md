# 工具面 MCP 对齐（Tool Face MCP Alignment）设计

- 日期：2026-10-22（v2：builder check 四问题已并入——审批翻转风险修复、范围收紧、schema-照实原则、§5.4 撤销）
- 状态：v2（builder check 完成，裁决已并入）
- 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` Tier 1 #4（工具注解 + 结构化工具结果——MCP 2025-06-18+/11-25 与 ACP v1 双 stable spec，研究判定 MISSING/高价值）
- 前置：P0 接线修复包已合入（`c19d5765`）

## 1. 意图与为什么

MAFW 工具契约（`MafwToolRegistration`）目前只有 `name/label/description/parameters/execute`，MCP 出口的工具定义无注解、无输出声明。业界（MCP stable spec + ACP v1）已收敛的工具面能力我们缺三块：

1. **工具注解**（`annotations`：`title`/`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`）——客户端/审批面据此分类呈现与风险评估。MCP 定义为 *hints, not guarantees*（展示与启发式用，非安全边界）。
2. **结构化输出声明**（`outputSchema`：工具结果的 JSON Schema）——消费者可编程消费工具结果。
3. **结构化结果载荷**（`structuredContent`：符合 outputSchema 的 JSON，与 `content` 并存向后兼容）。

为什么现在做：缺口研究中**标准硬度最高**的一项（双 stable spec）；改动集中在工具层，不动 DTO/动词/事件骨架；已装 MCP SDK 1.30.0 原生支持全部三面（builder check 已核：`spec.types.d.ts` 的 `Annotations`/`outputSchema`/`CallToolResult.structuredContent`），零依赖升级。

## 2. 目标（v2 收紧后）

- G1 `MafwToolRegistration` 增可选 `annotations`（`MafwToolAnnotations` 类型）+ `outputSchema`（加法扩展，缺省 = 现状）
- G2 MCP 出口：44 个工具定义全量携带 annotations（构造期物化）；3 个首批工具带 outputSchema + structuredContent
- G3 annotations 解析三级：注册声明 > mafw_* 专属映射表 > TOOL_CLASS 派生（runtime 原生工具）——**审批消费的 TOOL_CLASS_TABLE 不动**（见 §5.2 v2 裁决）
- G4（v2 收窄）MCP `CallTool` 执行链支持 handler 返回 `structuredContent` 并透传到 `CallToolResult`——**仅 MCP 面**；`/api/tools/execute` 与六件套 execute 返回形状**本批不动**（无首批生产者，见 §5.4 撤销记录）
- G5 首批 structured 工具（MCP handler 面）：`mafw_search_hybrid`、`mafw_get_memory`、`mafw_list_goals`——**schema 照实声明现有返回形状**（§5.6 v2 原则）

## 3. 非目标 / 反目标

- **非目标**：改 canonical DTO/动词/事件骨架；改审批逻辑（`isReadOnlyTool` 与身份 policy 的 `TOOL_CLASS` 权威完全不动）；`/api/tools/execute` 响应扩展（撤销，无首批生产者）；六件套 execute 返回 structured（同撤）；desktop 专门 structuredContent 渲染卡（genericSections 对 JSON 已兜底）；44 工具全量手写 outputSchema（逐工具按需）；pi typebox 通道对 annotations 的消费（字段透传存在，pi 今日 fail-open 忽略——将来 pi 支持时零改动）
- **反目标**：annotations 成为第二套工具分类学权威（三级解析单源：声明 > mafw 表 > TOOL_CLASS 派生，同一工具不存在两个冲突来源）；**审批判定静默翻转**（builder check Q1：mafw_* 进共享 TOOL_CLASS_TABLE 会让 manager 的 deny file-edit 压过 allowlist → 15 个核心工具 auto-deny、curator 主职能断裂——v2 明确禁止）；破坏既有 `{text, isError}` / `{content, isError}` 消费方

## 4. 约束

- C1 方言中立：annotations/outputSchema 是可选元数据，runtime 不识别时 fail-open 忽略
- C2 MCP `Tool` 形状即 wire 形状：`toolRegistry.definitions` 直通 ListTools（两个 transport），加字段即达 wire
- C3 六件套单源：spec 与 execute 闭包同走 `runtime/mafw-tools.ts`（2026-10-15 spec 既有约定；本批六件套 spec 只加可选字段，不产出 structured）
- C4 测试基线：gateway 328 套件 / adapter 24 / desktop 1124 / tui 220（P0 后全绿基线）；desktop deep-equal part 契约必须保持（tool part 帧字节不变）

## 5. 设计

### 5.1 契约扩展（`runtime/contract.ts` + `runtime/mafw-tools.ts`）

```typescript
/** MCP stable spec 对齐的工具注解（hints, not guarantees——展示/启发式用，非安全边界）。 */
export interface MafwToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;   // readOnlyHint=false 时有意义
  idempotentHint?: boolean;    // readOnlyHint=false 时有意义
  openWorldHint?: boolean;
}

export interface MafwToolRegistration {
  // …既有字段不变…
  annotations?: MafwToolAnnotations;   // 声明优先（G3 第一级）
  outputSchema?: Record<string, any>;  // JSON Schema（object 顶层），缺省 = 无声明
}
```

`MafwToolSpec`（六件套单源）同步加两个可选字段。execute 返回形状**不变**（v2：`{text, isError?}`）。

### 5.2 annotations 解析三级（v2 重写——审批隔离）

**背景裁决（builder check Q1）**：原案"TOOL_CLASS_TABLE 补 mafw_* 条目"会让 `policyDecides` 的 **deny-class 先于 allowlist** 判定翻转——manager（deny file-edit/subagent）的 mafw_add_memory/create_goal 等 ~15 工具从 allow 变 auto-deny；curator（deny file-edit）的 mafw_add_memory 被类拒绝，主职能断裂；~13 个 readonly/search 工具在 read-only 档变自动放行。**这与 §3"审批逻辑不动"自相矛盾，撤销原案。**

v2 方案：**mafw_* 网关工具的注解走专属映射表，不进审批消费的 TOOL_CLASS_TABLE**：

```typescript
// tool-classes.ts 新增（与 TOOL_CLASS_TABLE 同文件，编译期可见，但互不消费）
const MAFW_TOOL_ANNOTATIONS: Record<string, MafwToolAnnotations> = {
  // search：只读检索
  mafw_search_hybrid: { readOnlyHint: true, idempotentHint: true },
  mafw_get_deltas:    { readOnlyHint: true, idempotentHint: true },
  mafw_get_axioms:    { readOnlyHint: true, idempotentHint: true },
  // readonly：读查询
  mafw_get_memory: {}, mafw_get_goal_status: {}, mafw_list_goals: {},
  mafw_list_automation_rules: {}, mafw_get_automation_rule: {},
  mafw_get_automation_history: {}, mafw_list_triage_items: {},
  mafw_get_triage_item: {}, mafw_list_pending_questions: {}, mafw_get_evidence: {},
  // 写网关内部状态（非破坏：不删不改既有条目的语义，幂等性存疑不声明）
  mafw_add_memory: { readOnlyHint: false, destructiveHint: false },
  mafw_update_state: { readOnlyHint: false, destructiveHint: false },
  mafw_load_state: { readOnlyHint: true },   // 读态文件
  mafw_commit_heuristic: { readOnlyHint: false, destructiveHint: false },
  mafw_merge_memory: { readOnlyHint: false, destructiveHint: false },
  mafw_resolve_merge: { readOnlyHint: false, destructiveHint: false },
  mafw_supersede_memory: { readOnlyHint: false, destructiveHint: false },  // soft（不物理删）
  mafw_pin_memory: { readOnlyHint: false, destructiveHint: false },
  mafw_record_feedback: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  mafw_answer_question: { readOnlyHint: false, destructiveHint: false },
  mafw_propose_triage_decision: { readOnlyHint: false, destructiveHint: false },
  mafw_draft_automation_rule: { readOnlyHint: false, destructiveHint: false },
  mafw_validate_rule: { readOnlyHint: true, idempotentHint: true },
  // 编排触发（子会话/自动化执行）
  mafw_create_goal: { readOnlyHint: false, destructiveHint: false },
  mafw_set_goal: { readOnlyHint: false, destructiveHint: false },
  mafw_run_automation: { readOnlyHint: false, destructiveHint: false },
  mafw_ask_user: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  mafw_get_model_route: { readOnlyHint: true, idempotentHint: true },
  // 破坏性（进程/生命周期终止）
  mafw_cancel_goal: { readOnlyHint: false, destructiveHint: true },
  mafw_restart_agent: { readOnlyHint: false, destructiveHint: true },
  // shell 等价（任意代码执行）
  mafw_python: { readOnlyHint: false, destructiveHint: true },
  mafw_python_restart: { readOnlyHint: false, destructiveHint: true },
  // 媒体（loopback A2A，不改用户环境；upload 建任务属网关内部状态）
  mafw_media_ask: { readOnlyHint: true, idempotentHint: false },
  mafw_media_upload: { readOnlyHint: false, destructiveHint: false },
  mafw_media_speak: { readOnlyHint: false, destructiveHint: false },
  // 桌面 UI 自动化（动作破坏性视目标而定，缺省不误导）
  mafw_desktop_screenshot: { readOnlyHint: true },
  mafw_desktop_navigate: { readOnlyHint: false, destructiveHint: false },
  mafw_desktop_get_ui_state: { readOnlyHint: true },
  mafw_desktop_click: { readOnlyHint: false, destructiveHint: true },
  mafw_desktop_type: { readOnlyHint: false, destructiveHint: true },
  mafw_desktop_scroll: { readOnlyHint: false, destructiveHint: false },
};

/** 三级解析：声明覆盖 > mafw 专属表 > TOOL_CLASS 派生（runtime 原生）。 */
export function annotationsForTool(
  name: string,
  declared?: MafwToolAnnotations,
  toolClass?: TOOL_CLASS,
): MafwToolAnnotations | undefined;
```

TOOL_CLASS 派生表（runtime 原生工具用，mafw_* 永不走到这级）：

| TOOL_CLASS | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|---|---|---|---|---|
| readonly | true | — | true | — |
| search | true | — | true | — |
| file-edit | false | true | false | — |
| shell | false | true | false | — |
| subagent | false | false | false | — |
| web | false | false | — | true |
| plan | true | — | true | — |
| other | —（全部缺省） | | | |

**为何这不是"第二权威"**：TOOL_CLASS_TABLE 的语义域是 *runtime 原生工具的环境交互分类*（审批消费）；mafw_* 是 *网关内部服务调用*，其身份授权早已按名字 allowlist 走（manager/curator policy），与类 deny 无交集。两表输入域不相交，无漂移可能。单一来源原则以新形式保持：每个 mafw 工具的注解只有这一张表 + 注册声明覆盖。

### 5.3 MCP 出口（`mcp/tool-registry.ts` + 两个 transport）

**定义面**：`definitions` 构造期物化 annotations——每工具 `annotations: annotationsForTool(name)`（registry 侧无手工声明时走 mafw 表）。裁决：物化在构造期，ListTools 请求路径零开销。`title` 取定义已有字段或工具名。

**执行面（G4 v2）**：`ToolHandler` 返回形状扩展为 `{ content?, isError?, structuredContent? }`（mcp 层内部形状，非 runtime 契约）；两个 transport 的 `CallToolRequestSchema` handler 把 `structuredContent` 透传进 `CallToolResult`（`content` 仍带——MCP spec 要求双载荷向后兼容）。三处 handler（search_hybrid/get_memory/list_goals 的 Services 注入实现）返回完整载荷的 structuredContent（§5.6）。

### 5.4 ~~`/api/tools/execute` structured~~（v2 撤销）

原案让 execute 响应加 `structured` 并合入 `state.output` JSON。builder check Q2/Q4：首批三工具全部活在 MCP handler 面（`routes/tools.ts` 只执行六件套，其余 404）——该通道**无首批生产者**，纯属死管线；且 `state.output` 现为非 JSON 裸文本（`"记忆已保存：mem_xxx"`），"合并进 JSON 顶层键"对非 JSON 文本未定义，包装会翻转 desktop 工具卡渲染形态（code-block → kv-table），碰 deep-equal part 契约。**撤销**：本批 `/api/tools/execute` 与 tool part 帧字节不变。六件套将来需要 structured 时再立独立切片（届时执行面生产者存在，才有接线意义）。

### 5.5 六件套 runtime 注册透传

- **契约面**：`MafwToolRegistration.annotations/outputSchema` 字段存在（G1）——pi registry stash 透传携带；pi typebox 通道今日只消费 parameters，字段 fail-open 忽略（C1），将来 pi 支持时零改动。
- **opencode v1 插件路径**：六件套由 v1 插件承载（不走 RuntimeTools），本设计不改（文档债已登记，v2 迁移统一）。
- **claude adapter**：builder check 核实 repo 无此路径，§5.5 原表述有误——MCP annotations 对 claude adapter 的 mcpServers 透传天然兼容，无需处理。

### 5.6 首批 structured 工具（G5，v2 原则重写）

**原则：schema 照实（schema documents reality, never aspires）**——outputSchema 声明 handler **现有**返回形状，不裁剪不臆想。builder check Q3：原案的 slim projection（丢 `state`/`canExpand` 迭代协议、丢 `memory_value`）会让消费者无法执行工具描述里强制的迭代扩展，等于声明了一个不可用的契约。

| 工具 | structuredContent 来源 | 备注 |
|---|---|---|
| mafw_search_hybrid | 完整现有返回 `{results, canExpand, state, round, count, fok, hint}`（results 含 memory_value） | 迭代协议字段全保留 |
| mafw_get_memory | 完整现有信封 `{success, memory, latest?, source?}` | 不压平 |
| mafw_list_goals | 现有返回形状照实 | 若 handler 不返回 title，schema 不写 title（加字段是 handler 改动，builder 按 §8 判断值不值） |

text 载荷（`content`）保持现状人类可读摘要——structured 是加法不是替换。

## 6. 测试策略（TDD）

1. `annotationsForTool` 三级解析单测（声明覆盖 > mafw 表命中 > TOOL_CLASS 派生 > undefined）
2. **mafw 表覆盖测试**：MCP registry 全部工具名 ∈ MAFW_TOOL_ANNOTATIONS（新工具漏登记即 fail）
3. TOOL_CLASS 派生表单测（8 类）
4. MCP definitions 物化测试（每工具带 annotations；构造期一次性）
5. CallTool `structuredContent` 透传测试（双载荷：content + structuredContent 都在）
6. 三个 handler structured 测试（形状对齐现有返回——schema 照实）
7. **审批零翻转回归**：`isReadOnlyTool`/`policyDecides` 对 mafw_* 的判定在改动前后逐工具一致（钉扎测试，防未来误把 mafw_* 塞回 TOOL_CLASS_TABLE）
8. 四套全量回归（desktop deep-equal part 契约天然保持——本批不碰 part）

## 7. 裁决记录（v2，builder check 四问的处置）

1. **Q1 审批翻转（Critical）**：mafw_* 不进 TOOL_CLASS_TABLE，走专属 MAFW_TOOL_ANNOTATIONS 表（§5.2 v2）。审批语义零改动；两表输入域不相交（runtime 原生 vs 网关内部），无第二权威漂移。
2. **Q2 执行面归属（Critical）**：首批三工具全部 MCP handler 面；`/api/tools/execute` 与六件套 execute 本批不动（§5.4 撤销）——无生产者的管线不建。
3. **Q3 schema 形状**：照实原则——outputSchema 声明完整现有返回（含迭代协议字段），不 slim projection（§5.6）。
4. **Q4 state.output 合并**：随 Q2 撤销而消解——tool part 帧字节不变，deep-equal 契约平凡成立。
5. （承 v1）派生在 registry 构造期物化，ListTools 零运行时开销。
6. （承 v1）审批逻辑不动：MCP spec 明示 annotations 是 hints 非保证；`isReadOnlyTool` 的 TOOL_CLASS 权威保持。

## 8. 留给 builder 的

- §5.2 MAFW_TOOL_ANNOTATIONS 逐条语义核对（我按工具行为直觉标注，builder 对照 handler 实现修正——特别是 desktop_* 破坏性分级与 media_ask 的 readOnlyHint）
- §5.6 三个 outputSchema 的具体 JSON Schema 撰写（对齐 handler 实际返回；list_goals 是否补 title 由 builder 评估 handler 改动成本）
- `annotationsForTool` 的落点文件（tool-classes.ts 单文件 vs 新文件——倾向同文件，编译期可见）
- pi stash 透传的具体接线点（`pi-runtime.ts` registry `setToolFactory`）
