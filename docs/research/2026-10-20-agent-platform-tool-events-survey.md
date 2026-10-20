# 各 Agent 平台工具事件调研：注册 ≠ 显示，执行侧发射的先例与形状

> 日期：2026-10-20。背景：v4.30 工具注册契约（`tools.registerTools` spec+execute 单源推送）打通了**执行链**，但**显示链**无保证——runtime 注册了工具不等于前端能看到工具调用（事件侧适配缺失：out-of-process 通道不发事件、第三方 in-process 需自配映射、conformance 无工具可见性场景）。本文为「gateway 是否/如何适配工具事件」提供业界依据。
> 标注：[实证] = 当日实读（代码/规范文档）；[实证-既有] = 引用本仓库既有调研且当日未重验；[知识] = 未能当日核实。

## 0. 一句话结论

**业界双轨**：工具**生命周期锚点**（started/completed）几乎都在**调用侧**（agent runtime 包住调用发事件）；**进度/流式细节**在**执行侧**上报（MCP `notifications/progress`、Codex `commandExecution/outputDelta`、Kimi `tool.progress`）。没有任何一家把完整生命周期放在执行侧——因为终态要由拿到结果回填 LLM 的调用侧确认。**MAFW 的 out-of-process 场景是合理例外**：调用侧（agent 进程）没有通往 gateway 事件流的通道，gateway 是唯一能发 canonical 事件的实体——方案 A 的合成发射成立，但须两帧终态（running→completed/error，对齐 opencode ToolState）+ 防双发；进度帧（python 180s 长执行）对标 MCP progress 留作后续。

## 1. 既有调研索引（避免重复覆盖）

| 文档 | 覆盖 | 与本文关系 |
|---|---|---|
| `2026-10-08-agent-event-models-survey.md` | Codex/Claude/Kimi/ACP 四家**事件模型全量**（信封形状、词汇、delta 双模、approval 反向 RPC） | 本文工具事件细节大量引其 [实证-既有] 结论 |
| `2026-10-12-tool-call-result-model-compat.md` | call/result **数据模型**七平台对照 + ToolPartAssembler 设计依据 | 本文 §3 表合并其结论；注意其中 §2 对 pi 映射的描述（`tool-call`/`tool-result` part）**已过期**——assembler 切片已落地，现行映射产三原语（本文 §3 复核） |
| `2026-10-11-tool-call-rendering-survey.md` | 六家**渲染**对标（工具卡 v8 依据） | 显示链最后一环，不重复 |
| `2026-10-13-tool-identity-layer-research.md` | 工具**命名/类别**五层隐式契约 | toolClass 层依据，不重复 |

**本文增量**：① 执行侧发射（executor-side emission）的系统性对照（谁发、发什么、何时停）；② MCP progress 规范当日实读；③ 对 v4.30 显示链缺口三方案（A 合成发射/B 仅文档/conformance/C 默认开+去重）的判定。

## 2. 各平台工具事件全景（合并 + 当日复核）

| 平台 | 数据模型 | 生命周期事件 | 进度/流式 | 执行侧上报 | 当日复核 |
|---|---|---|---|---|---|
| **opencode** | 融合：单 `ToolPart`，`ToolState = pending→running→completed\|error`，input/output 同体 | `message.part.updated` 全量快照多次演进 | 无独立进度事件 | —（runtime 即执行者） | [实证] SDK `types.gen.d.ts`：四态联合均携带 `input` |
| **pi（pi-ai）** | 分离：`ToolCall` block + `ToolResultMessage`（`toolCallId` 关联） | 高层 `tool_call`/`tool_result` | `toolcall_start/delta/end` | — | [实证] `pi-events.ts:18-22` 现行映射产 `tool.call`/`tool.result` 三原语（assembler 合帧） |
| **Claude（Agent SDK）** | 分离跨消息：`tool_use`（assistant）+ `tool_result`（下一条 user），`tool_use_id` 关联 | `stream_event` 嵌套 Anthropic SSE（`content_block_start/delta/stop`，index 关联） | `tool_progress` SDK 消息（执行中上报）+ `tool_use_summary` | `tool_progress` 存在 | [实证-既有] 10-08 §2.1 |
| **Codex** | wire 分离（`function_call`/`function_call_output`）；app-server **边界 join** 为 ThreadItem（status: in_progress/completed/failed/declined） | exec：`item.started/updated/completed` 快照；app-server：`item/started`/`item/completed` | app-server `item/commandExecution/outputDelta`（执行器 stdout 流） | `outputDelta` 是执行侧流 | [实证-既有] 10-08 §1.1 |
| **Kimi Code** | WS：call/result 分离事件；ACP 面 `tool_call` + `tool_call_update` | WS `tool.call.started` → `tool.result`；ACP status pending→in_progress→completed | WS `tool.call.delta` + **`tool.progress`**（执行中上报，volatile 不回放） | `tool.progress` 存在 | [实证-既有] 10-08 §3.2 |
| **ACP** | 分离双通知：`tool_call`（创建）+ `tool_call_update`（status 演进），`toolCallId` 关联 | 同左 | 无 | — | [实证-既有] 10-08 §4 |
| **dsh** | append-only 轨迹，call/result 各自条目，嵌套 call tree | 纯事件流可回放 | — | — | [知识] 10-12 §1 |
| **MCP** | **纯请求-响应**：`tools/call` → `{content[], isError}`；无执行期生命周期事件 | 无（调用侧 client 自己发 UI 事件） | **`notifications/progress`**：请求带 `_meta.progressToken` → 执行侧发 `{progressToken, progress, total?, message?}`，**MUST 递增、完成即停** | progress 即执行侧上报 | [实证] 2025-06-18 spec `server/tools` + `basic/utilities/progress` 当日实读 |
| **OpenAI Responses** | items 分离：`function_call` / `function_call_output`（`call_id` 关联）；**托管工具**（web_search/code_interpreter）服务端执行，item 带 status | 流事件 `response.output_item.added` / `response.*.completed` 等按 item 类型分发 [知识] | 托管工具执行期事件（`response.web_search_call.in_progress` 等）[知识]；background 响应 status `queued/in_progress/terminal` | 托管工具 = 服务端执行 + 服务端事件 | [实证] Azure Responses 文档（code_interpreter container、status 轮询、`response.output_text.delta`）；具体托管工具流事件名 [知识]（platform.openai.com 403） |

**MCP 补充**（长时任务的新答案）：2025-11-25 起 MCP 有 **Tasks 扩展**（SEP-1686/2663，异步任务化长时操作）[实证-目录]——方向是把"长执行"从 progress 通知升级为一等任务对象，与 MAFW 的 goal/node 异步模型同构。

## 3. 执行侧发射的系统对照（本文核心）

把"谁发事件"拆成两个正交维度：

**3.1 生命周期锚点（started/terminal）——全部在调用侧**

七家无一例外：opencode/pi/Claude/Codex/Kimi/ACP/dsh 的 started 与 terminal 事件都由**拥有 agent 循环的一方**发——因为它要拿结果回填 LLM、驱动下一轮。执行侧（MCP server、OpenAI 托管工具除外——它们是服务端本身就是"平台"）不发终态。

**3.2 进度/流式细节——执行侧上报是通行做法**

- MCP `notifications/progress`：执行侧、token 关联、递增、完成即停（规范明文）[实证]
- Codex `commandExecution/outputDelta`：执行器 stdout 逐块上抛 [实证-既有]
- Kimi `tool.progress`：volatile、不回放 [实证-既有]
- Claude Agent SDK `tool_progress`：SDK 消息类型 [实证-既有]

**3.3 服务端托管工具 = 调用侧与执行侧合一的特例**

OpenAI Responses 的 web_search/code_interpreter：执行在服务端，事件也从服务端流出来（`response.output_item.added` → `*.in_progress` → `*.completed`）[知识]。此时"调用侧"（客户端 SDK）只做透传渲染。**这正是 MAFW `/api/tools/execute` 合成发射的同构先例**——gateway 既是执行者又是事件源。

## 4. 对 MAFW 三方案的判定

| 判定 | 依据 |
|---|---|
| **方案 A 成立且应修正两处**：① `/api/tools/execute` 合成发射 = §3.3 服务端托管工具同构（gateway 是唯一 canonical 事件源）；② factory 事件包装 opt-in = 调用侧发射的 gateway 代劳，pi/opencode 已自发（防双发必须 opt-in） | §3 对照 |
| **修正 1——终态两帧制**：合成事件发 `running`（含 input）→ `completed/error`（含 output）两帧快照，对齐 opencode `ToolState` 四态的子集（pending 可省——HTTP 请求到达即 running）；不要发 pending | opencode ToolState [实证]；desktop tool-cards 消费 `state.status` |
| **修正 2——进度帧对标 MCP progress 留后续**：python（180s 超时）/media（多步 a2a）执行期可发 `tool.delta`（part.text 追加），形状对标 `notifications/progress` 的"递增 + 完成即停"；首版不做（YAGNI，六件套多为秒级） | MCP progress [实证]；Kimi volatile 先例 |
| **防双发契约**：out-of-process runtime 若同时自己映射了 canonical 工具事件 → 双卡。约定：`POST /api/tools/execute` 的调用方 = 放弃自发事件（文档写死 + conformance 校验）；未来需要共存时再加请求级 `emit: false` 开关 | 方案 C 否决理由（去重靠自觉易生隐性 bug） |
| **normalizeMessages 必须写进 4.8 文档的显示链清单**：历史侧各家都有等价物（ACP `session/load` 回放复用 update；Codex item 快照天然可回放；pi 有 `pi-message-normalize`）——第三方不实现则历史工具块不渲染 | 10-08 §5.2-3；10-12 §3 S3 |
| **conformance `tool-visibility` 场景**：注册 → 执行 → 断言广播流出现 tool part（runtime 自发或 gateway 合成二选一）——把"注册了但隐形"变成激活期可测 | 既有 5 场景无工具维度（当日实读 conformance-scenarios.ts） |

## 5. 文档过期勘误（本次复核发现）

`2026-10-12-tool-call-result-model-compat.md` §2.1 描述 pi 映射产 `part.type:"tool-call"`/`"tool-result"`——这是 **assembler 改造前**的状态；现行 `pi-events.ts:18-22` 已产 `tool.call`/`tool.result` 三原语经 `ToolPartAssembler` 合帧。该文档作为设计依据仍然有效（其推荐方案 B 已落地），但现状描述以本文 §2 表为准。

## 6. 结论

1. **业界无"注册即显示"的免费午餐**：所有平台的工具显示都要求事件侧配套（调用侧生命周期 + 可选执行侧进度）——v4.30 只做注册链不是缺陷，是切片边界；现在补显示链正是时候。
2. **gateway 合成发射有同构先例**（OpenAI 托管工具）且是 out-of-process 场景的唯一解；调用侧代劳（factory 包装）须 opt-in 防双发。
3. **两帧终态制 + 进度帧留后续**是对业界形状的最小对齐；防双发用通道约定（execute 端点调用方 = 放弃自发）而非运行时去重。
4. 下一步：按方案 A（含两处修正）走 brainstorm → spec → plan。
