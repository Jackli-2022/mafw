# 工具调用/结果数据模型的跨 runtime 兼容重构调研

> 日期：2026-10-12。问题：opencode 的 canonical `ToolPart` 是「call+result 融合单 part」模型，而 Claude/Codex(wire)/Kimi/pi/dsh 原生都是「call 与 result 两条独立记录、靠 id 关联」——MAFW gateway 与前端要怎样重构才能同时兼容两类。
> 前置：`docs/research/2026-10-08-agent-event-models-survey.md`（四家事件模型）、`docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md`（事件映射注册）、`docs/research/2026-10-11-tool-call-rendering-survey.md`（渲染对标）。
> 标注：[实证] = 本仓库代码/官方文档直读；[知识] = 既有知识未本次核实。

## 0. 一句话结论

**不要把 canonical 词汇表改成「分离 call/result」双 part 模型**；正确重构方向是**在 gateway 侧加一个 per-session 的 `ToolPartAssembler`（callID 键控的有状态合帧器）+ `MessageNormalizer`（历史 DTO 归一）**，让所有 runtime 的分离模型在进入 canonical 流之前就被 join 成 opencode 形状的 `ToolPart`。前端零改动，opencode 恒等通过，pi 作为 dogfood 顺带修掉「pi 工具卡在桌面从不渲染」的现存缺口。

依据：业界自己在做同样的事——Codex app-server 在适配边界把 wire 上分离的 `function_call`/`function_call_output` join 成带 status 生命周期的统一 item；Claude Code UI 把跨消息的 `tool_use`/`tool_result` 拼成一个折叠块。**join 发生在适配边界，是各家共识，不是 MAFW 特有妥协。**

## 1. 各家 call/result 模型对照

| 平台 | 数据模型 | 关联键 | 事件流形态 | 备注 |
|---|---|---|---|---|
| **opencode** | **融合**：单 `ToolPart`，`state` 判别联合 pending→running→completed/error，input/output 同体 | `part.id`（同一对象原地演进） | `message.part.updated` 多次全量快照 | canonical 现状 [实证]（SDK types.gen ToolState union） |
| **pi（pi-ai）** | **分离**：assistant `content[]` 里 `ToolCall` block（`{type:"toolCall",id,name,arguments}`）+ 独立顶层 `ToolResultMessage`（`role:"toolResult"`） | `toolCallId` | `toolcall_start/delta/end` + 高层 `tool_call`/`tool_result` | pi-ai 是 provider 无关层（包 Anthropic/OpenAI/Gemini），其模型即 Anthropic 形状 [实证]（`pi-ai/dist/types.d.ts:246,311`） |
| **Claude（Messages API / Agent SDK）** | **分离且跨消息**：`tool_use` block 在 assistant 消息；`tool_result` block 在**下一条 user 消息** | `tool_use_id === tool_use.id` | SDK `stream_event` 嵌套 Anthropic SSE（`content_block_start/delta/stop`，`index` 关联 block） | index→partId 物化需会话内状态表 [实证]（10-08 调研 §2） |
| **Codex** | wire（Responses API）：`function_call` / `function_call_output` 两 item 分离；**app-server 已在边界 join**：`ThreadItem`（`mcp_tool_call`/`command_execution` 等）带 status 生命周期 | wire 层 `call_id`；app-server 层 `itemId` | exec：`item.started/updated/completed` 快照（无 delta）；app-server：另有 per-part delta 通知 | codex 官方 `event_mapping.rs` 自述只做"无状态一对一投影"，状态归调用方 [实证]（10-08 调研 §1） |
| **Kimi Code** | **分离事件**：WS `tool.call.started` / `tool.call.delta` / `tool.progress` / `tool.result`；ACP 面 `tool_call` + `tool_call_update`（同 id，status pending→in_progress→completed） | tool call id | WS 三事件序列 / ACP 双通知 | ACP 的 update 形态最接近 opencode 快照 [实证]（10-08 调研 §3） |
| **dsh** | **分离**：append-only 轨迹日志，call/result 各自独立条目，工具调用嵌套 call tree | 事件内 id | 纯事件流，可回放 | "可回放性即设计" [知识]（10-11 调研 §一） |
| **ACP（Zed 面）** | 分离双通知：`tool_call`（创建）+ `tool_call_update`（status 演进） | toolCallId | `session/update` 变体 | 中立词汇=最小公分母 [实证] |

**分布**：原生融合的只有 opencode 一家；Codex app-server / ACP 是「边界 join 后的融合呈现」；Claude / Kimi(WS) / pi / dsh 原生分离。

## 2. MAFW 现状断层（实证）

pi 已经是一个「分离模型」runtime，且适配**未完成**——这正是未来接 Claude/Codex 时会撞上的同一堵墙：

1. **事件流**：pi 映射表把 `tool_call` → `part.type:"tool-call"`、`tool_result` → `part.type:"tool-result"`（`gateway/src/runtime/pi/pi-events.ts:17-18`）。
2. **前端渲染**：`renderable()` 只认 `part.type === "tool"`（`packages/session-ui/src/components/parts-rules.ts:16`），`PART_MAPPING` 也只注册 `"tool"`——**pi 的工具 part 在桌面被整条丢弃，从不渲染**。
3. **历史加载**：`PiSessionRegistry.messages()` 原样返回 pi 消息（`pi-session.ts:229-233`，role/content-block 形状）；桌面 `loadSessionHistory` 期望 `{info, parts}`（`MafwShell.tsx:982-992`），pi 消息无 `parts` 字段 → 历史只有文本、无工具卡。
4. **canonical facet 表不碰 tool**（`canonical-facets.ts`）：`message.part.updated` 对 tool part 是纯透传，gateway 没有任何合成点。
5. **opencode part 形状的隐性消费者清单**（重构时必须全部过一遍）：
   - desktop chat store upsert + session-ui 渲染（`PART_MAPPING["tool"]` 读 `state.status/input/output`）
   - trajectory collector（`gateway/src/trajectory/collector.ts:196` 读 `part.state.output/error`）
   - flow-card 内联锚定（`callID` 匹配）
   - media_speak 提取（从 store 读 tool part input）
   - obs/capture 与 turnCompress（事件载荷）

## 3. 设计空间

### A. 插件侧合成（join 责任全在插件）
插件 transformEvent 里自己做 callID 状态机，直接吐 opencode 形状 `ToolPart`；历史也在插件 `session.messages` 里转 DTO。
- 优：gateway/前端零改动。
- 劣：每个插件重写同一个 join（10-08 spec 已承认"跨事件状态机/增量累积"必须走逃逸口，但若每个 runtime 都手写就是 N 份重复暗知识）；opencode 形状渗漏进插件；无公共测试面。

### B. gateway 侧统一合成（**推荐**）
新增 gateway 拥有的两个组件：
- **`ToolPartAssembler`**（per-session，`callID` 键控）：插件只需经 eventMappings 声明三个原语的抽取——`tool.call`（id/name/input）/`tool.delta`（可选）/`tool.result`（id/output/isError）——assembler 维护 ToolPart 状态机，产出标准 `message.part.updated` 快照进 canonical 流。能力位 `toolDelta` 门控无 delta 的 runtime（codex exec 先例）。
- **`MessageNormalizer`**：runtime 契约加可选 `session.normalizeMessages`（缺省恒等=opencode），把各家历史消息转成 `{info, parts[]}` 的 opencode DTO。pi 版：assistant 的 `ToolCall` block + 后续 `ToolResultMessage`（toolCallId）→ 单 ToolPart。

- 优：join 逻辑一份、可单测；插件声明式覆盖 80%（纯字段抽取），逃逸口只剩真状态机（Claude index 物化）；前端/trajectory/flow-card 全不动；pi 顺手修好（现存缺口）。
- 劣：gateway 多一个有状态组件；assembler 需要会话生命周期清理（session 删除时释放）。

### C. canonical 词汇表中立化（part 拆 call/result 两类，前端适配 join）
- 否决。与 10-08 spec 已拍板决策冲突（canonical 沿用 opencode 形状）；ACP 教训（中立化=最小公分母）；且隐性消费者清单（§2.5）全要改双 part 模型，工程量大一个数量级。

## 4. 推荐方案 B 的落地切片

1. **S1 assembler 纯逻辑 + 测试**：`gateway/src/runtime/tool-part-assembler.ts`——`applyCall/applyDelta/applyResult` → opencode ToolPart 快照；状态机（pending→running→completed/error）；乱序/缺 result/重复 result 防御。
2. **S2 eventMappings 扩展**：新增三个 canonical 内部类型（`tool.call`/`tool.delta`/`tool.result`，不进 SDK 公开词汇表、不广播，仅 assembler 入口）；pi 映射表改为产三原语（`tool_call`→call、`toolcall_delta`→delta、`tool_result`→result），验证桌面 pi 工具卡首次渲染。
3. **S3 MessageNormalizer + pi 历史转换**：`session.messages` 路由层过 normalizer；pi 转换器（content block + toolResult 归并）。
4. **S4 opencode dogfood**：opencode 走恒等 assembler（事件本就融合，assembler 直通），oracle 测试断言行为等价。

**测试增量预估**：assembler 状态机 ~12 + pi 映射改造 oracle ~6 + normalizer ~6 + 契约测试 ~4 ≈ **+28**。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| assembler 有状态 → 会话泄漏/崩溃后状态脏 | per-session 持有、session.delete 联动清理；重启后历史走 normalizer 重建不依赖 assembler |
| 流式 delta 与历史快照竞态 | 沿用现有 store upsert 语义（id 幂等合并），assembler 只产全量快照不产增量 |
| Claude `content_block index` 物化复杂 | 逃逸口 per-session index→callID 表，assembler 只吃已物化的 callID |
| 与 10-08 已拍板「canonical 沿用 opencode 形状」的关系 | 本方案是**遵守**该决策的落地路径（join 在进 canonical 流之前完成），不 reopen |

## 6. 与 10-08 调研的衔接

本文档补的是该调研 §5.3 词汇表缺口清单之外的**第 7 个缺口：tool part 的 call/result 关联模型**（该调研聚焦事件类型覆盖，未触及 part 内部状态机）。建议后续「canonical 词汇表扩展立项」时把 tool 三原语 + usage/plan/question/subagent 一并评审。
