# Code Mode × desktop ChatView 渲染调研（2026-10-28）

> 范围：opencode 2.1 Code Mode（`execute`）里调用 gateway MCP 时，desktop 能否渲染子工具调用；以及 ChatView 在「工具执行等待结果」期间拖累其他流式输出的原因与优化方向。
> 方法：opencode 2.1 / dev 源码核对 + 本机 gateway 2.1 真实 SSE 抓帧 + MAFW session-ui 代码与 `markdown-stream` 微基准。
> 结论先行：**子工具调用数据已经在 `execute` part 的 `metadata.toolCalls` 里，desktop 只缺一张 `execute` 卡；每个子调用的 output 不在 metadata（opencode 刻意不回传），所以 v1 只能做「调用列表 + 最终输出」，做不到每个 gateway MCP 的完整结果卡。第二个问题的主因是单条全局 SSE 上的 progress 突发 + 同步 store patch + prose Markdown 的 O(n²) 投影，三者叠加会挤占其他流式渲染。**

## 1. 数据链路：Code Mode 子调用到底在哪

### 1.1 opencode 侧

- `execute` 是 Code Mode 唯一的 model-facing tool；脚本内部的 MCP 调用是嵌套调用，**不会产生独立的 tool part**（`packages/core/src/codemode/tool.ts`、`packages/opencode/src/tool/code-mode.ts`）。
- 运行期通过 `context.progress({ toolCalls })` 发布 `session.tool.progress`（ephemeral），`toolCalls[]` 元素形状：
  ```ts
  { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }
  ```
  终态 `execute` 的 `metadata.toolCalls` 是同一数组的最终快照；**没有 per-call output**。官方设计说明见 `packages/codemode/codemode.md`：「Nested call statuses are returned as final `execute` metadata for the TUI」「nested calls ... do not independently run registry hooks or model-output bounding」。
- 上游把这条数据用于 TUI/Web 的 execute 行（PR #55649：列出子调用、失败调用标红、最终 output 单独展示）；per-call output / 独立 invocation identity 仍是 open issue #54812 的诉求，当前版本没有。

### 1.2 gateway 侧（已接线，无需改）

`gateway/src/runtime/opencode-21-events.ts` 已把 2.1 事件翻译成 canonical：

- `session.tool.progress` → `part.updated`，`state = { status: "running", input, metadata }`（行 322-329）
- `session.tool.success/failed` → `part.updated` 终态（行 330-358）
- `part.updated` 经 `handleOpencodeEvent` 进入 enrich / trajectory / 广播；desktop 收到的是标准 tool part。

### 1.3 本机真实抓帧（2026-10-28）

会话 `ses_e7d126aacffeEHwzXeCm1jowfb`，prompt 明确要求 Code Mode 并行调用 `mafw_get_axioms` / `mafw_list_pending_questions`。gateway `/api/events` 原样抓到的关键帧：

```text
t=4285  part.updated  tool=execute status=running  partID=call_00_...  calls=[search running]
t=4285  part.updated  tool=execute status=running  partID=call_00_...  calls=[search completed]
t=4285  part.updated  tool=execute status=running  partID=call_00_...  calls=[search completed, search running]
t=4285  part.updated  tool=execute status=running  partID=call_00_...  calls=[search completed, search completed]
t=4285  part.updated  tool=execute status=completed partID=call_00_...  calls=[search completed, search completed] output=7485 chars
t=4285  part.delta     (execute 之后的第一段文本)
...
t=4439  part.updated  tool=execute status=running  calls=[mafw.mafw_get_axioms running]
t=4439  part.updated  ... calls=[mafw.mafw_get_axioms running, mafw.mafw_list_pending_questions running]
t=4451  ... calls=[mafw.mafw_get_axioms completed, mafw.mafw_list_pending_questions running]
t=4451  ... calls=[... both completed]
t=4455  part.updated  tool=execute status=completed output=558 chars
```

历史出口同样保留 metadata（`GET /api/sessions/:id/messages`）：

```json
{
  "type": "tool",
  "name": "execute",
  "state": {
    "status": "completed",
    "input": { "code": "..." },
    "metadata": {
      "toolCalls": [
        { "tool": "mafw.mafw_get_axioms", "status": "completed" },
        { "tool": "mafw.mafw_list_pending_questions", "status": "completed" }
      ],
      "truncated": false
    }
  },
  "toolClass": "other"
}
```

实现要点：

- `toolCalls[].tool` 可能是 **裸名**（`mafw_get_axioms`）或 **命名空间名**（`mafw.mafw_get_axioms`，取决于模型写法），也可能是 Code Mode 内置的 `search`（以及 `browser.*` 等）。渲染前需要归一化：按 `.` 取最后一段，再匹配现有 `TOOL_SPECS` / `ToolRegistry`。
- `input` 可能缺省（空对象不写字段），不要假设存在。
- 同一批并行调用的 progress 帧可能**同一毫秒连续到达**（本机实证 6 帧），不是逐帧间隔渲染。

## 2. desktop 当前为什么看不到

1. `ToolRegistry` 没有注册 `execute`；`resolveToolRender()` 依次尝试原生名 / alias / canonical / class family，全部 miss 后落 `GenericTool`（`packages/session-ui/src/components/tool-canonical.ts:31-44`）。
2. `GenericTool` 只有 `BasicTool` 外壳，**没有 children**（`packages/session-ui/src/components/basic-tool.tsx:322-341`）。因此：
   - `state.metadata.toolCalls` 完全不读；
   - `state.output` 完全不显示；
   - 运行中只显示一行 `Called execute`（且 `BasicTool` 在 pending 时隐藏 subtitle/args）；
   - 完成后也看不到子调用和结果。
3. `BasicTool` 在 `pending` 时 `handleOpenChange` 直接 return，箭头也不显示（`basic-tool.tsx:178-182, 250-252`）。即使加一张卡，**运行中默认无法展开看进度**——必须用 `defaultOpen + defer={false}`，或给 `BasicTool` 补上游同款 `allowOpenWhilePending`。
4. gateway 的 `toolClass` 对 `execute` 是 `other`（`TOOL_CLASS` 没有 Code Mode 条目），class family 兜底也不会命中。

## 3. 能渲染到什么程度（能力边界）

| 信息 | 是否可得 | 说明 |
|---|---|---|
| 子调用工具名 | ✅ | `metadata.toolCalls[].tool`，需归一化 |
| 子调用输入 | ✅ | `input?`，可能缺省；可能很大（如 add_memory 的 content） |
| 子调用状态 | ✅ | running / completed / error，progress 实时更新 |
| 子调用输出 / 错误文本 | ❌ | metadata 不带；错误只体现在 status，最终 `execute.output` 是整段脚本结果 |
| 脚本代码 | ✅ | `state.input.code` |
| 脚本最终输出 | ✅ | `state.output`（成功/失败都可能带） |
| 每个 gateway MCP 的专属结果卡 | ❌（v1） | 没有 per-call output，现有 39 张卡无法填结果区 |

因此有三条路线：

### A. desktop 新增 `execute` 卡（推荐 v1）

- 标题 `Code Mode / 执行`，badge 显示 call 数 / 失败数；默认展开。
- 子调用行：图标 + 名称 + `key=value` 参数摘要 + 状态（running 用 shimmer，completed ✓，error ✗）；点击展开完整 input JSON。
- 终态追加「输出」行：`state.output` 容错 JSON parse（复用 `genericSections`），失败显示 `metadata.error` / error 文本。
- 代码不内联，避免把整段脚本塞进 trigger；需要时后续再加「查看代码」。
- 名字归一化：`mafw.mafw_get_axioms` → `mafw_get_axioms`；`search` 保留；`browser.*` → `browser`。可复用 `TOOL_SPECS` 的 icon/title 做行标题。
- 风险：子调用 output 不可得，这是 opencode 当前设计边界，不是 MAFW 能补的；不要从最终 output 猜测映射。

### B. `mafw` MCP server 设 `codemode: false`

- 在当前 `opencode.jsonc` 的 `mcp.mafw` 条目加 `"codemode": false`（2.1 的 per-server 字段；部分版本/文档写作 `mcp.servers`），gateway 39 个工具恢复为**直连 tool part**（`mafw_mafw_*`），现有全部专属卡片、output、审批、失败卡原样工作。
- 代价：这些工具重新进入模型工具目录（context 成本），失去 Code Mode 的并行编排/中间值不进上下文；只建议作为过渡开关或按项目配置。
- 可作为 desktop MCP 配置页的一个「Code Mode」开关后续补（B4 已有配置写入能力）。

### C. 改 opencode / gateway 合成子 tool part（不建议 v1）

- 需要 opencode core 给嵌套调用独立 part / output，属于上游 #54812 的范畴；在 gateway 侧伪造子 part 会与上层 `execute` part 重复、缺少稳定 callID/权限语义，且插件/历史会分叉。暂不做。

## 4. 第二个问题：工具等待为什么会拖累其他流式输出

### 4.1 共享单线程 + 同步 dispatcher

- desktop 只有一条全局 SSE（`MafwShell.tsx:1023, 1057-1062`），所有会话/所有 part 的事件都在 renderer 主线程同步 `dispatchShellEvent`。
- 任意一个会话的 execute progress 突发（实测 6 帧同一毫秒）都会排队进同一条主线程；如果这一批事件触发了昂贵的 tool card / Markdown 重渲染，**其他会话的 `part.delta` 也会一起被推迟**。这正好对应「一个工具在等结果，其他流式输出受影响」的现象。
- `part.updated` 每帧都会 `patchStore(applyPartUpsert(...))`（`sse/handlers/chat-stream.ts:88-98`），`applyPartUpsert` 复制整个 `parts` 桶并 map 该消息的数组（`sse/chat-reducers.ts:94-115`）。单帧成本不高，但 burst + 全量重算会叠加。

### 4.2 prose Markdown 的 O(n²) 投影

MAFW 的 `markdown-stream.project()` 只有「尾部是未闭合 code fence」才原地增长；prose / list / table 的 live tail 每次都重新 `marked.lexer` 整个已累积文本（`packages/session-ui/src/components/markdown-stream.ts:93-110`）。`PacedMarkdown` 只是把**显示更新**限流到 24ms（`message-part.tsx:267-268, 351-362`），并不改变单次投影的 O(当前长度)。

本机微基准（只测 `project()` CPU，不含 DOM/worker/SSE）：

| workload | deltas | chars | project() CPU |
|---|---:|---:|---:|
| 单段长 prose | 2000 | 10,337 | **7,377 ms** |
| 多段 prose（空行边界） | 2000 | 10,541 | **17,233 ms** |
| growing list | 2000 | 11,289 | **11,428 ms** |

这条路径在长回答（尤其是 Code Mode 返回后模型写长总结）时会把主线程吃满；如果同时还有 execute progress burst，其他流式输出就会明显卡顿。上游已用增量 live-tail 投影修过（PR #55857 的基准 15.9×–114.3×，最终 #57016 落地）；MAFW 目前还是旧实现，可直接移植同思路。

### 4.3 工具卡在 running 时不可展开

`BasicTool` 的 pending 门（见 §2）使「等待结果」阶段只能看到标题，看不到任何进度；用户很容易把「没有内容」感知成「流式输出被阻塞」。execute 卡默认展开 + 子调用行实时更新，能直接消除这个感知。

## 5. 建议的优化顺序

1. **P0：execute 卡 v1**（§3A）
   - 新增 `tool-cards/execute.tsx` + 纯函数 `execute-model.ts`（calls 解析、名字归一化、参数摘要、输出段）。
   - `defaultOpen` + `defer={false}` 让运行中也能看到子调用；或给 `BasicTool` 补 `allowOpenWhilePending`（上游 parity）。
   - 用真实 wire fixture（dotted 名 / 裸名 / search / 空 input / error / truncated）做单测。
2. **P0：tool part 事件合并**
   - 在 desktop 的 chat-stream 对 `part.updated` 的 **running tool** 按 `part.id` 保留最新快照，`requestAnimationFrame`（测试可用 32–50ms 假调度器）flush；completed/error 立即 flush 并取消 pending；`turn.completed` 前 flush 全部。
   - 只合并 tool part，不合并 text `part.delta`，避免文本快照乱序覆盖。
3. **P1：Markdown live-tail 增量投影**
   - 移植上游思路：prose/list/table 的 live tail 原地追加，只有空行边界 / 非追加更新 / open fence / refs 等 fallback 才重 lex；tail 设字符上限；heal 只处理 tail。
   - 这是长回答卡顿的根治项，和 execute 卡无关但会明显改善「工具结束后长总结」的体验。
4. **P1：execute 终态输出限幅**
   - `state.output` 可能很大；parse/渲染前做字符/行数上限，超出显示「已截断 + 查看全文」或 code 折叠，避免工具完成瞬间的主线程尖峰。
5. **P2（可选）：`codemode:false` 开关**
   - 需要每个 gateway MCP 完整结果卡时，先在 Config/MCP 管理里提供 per-server Code Mode 开关，作为过渡。

## 6. 附带发现（与本题无关，但会挡住 GUI 验证）

本机 desktop 当前复现顶层「MAFW 渲染出错」：

```text
[kobalte]: `useMenuItemContext` must be used within a `Menu.Item` component
  ... DropdownMenuItemLabel2 (packages/ui/src/components/dropdown-menu.tsx)
  ... MenuHost (packages/desktop/src/renderer/mafw/context-menu/MenuHost.tsx)
```

高度怀疑是 `MenuHost.tsx` 的 submenu 分支在 `DropdownMenu.SubTrigger` 内使用 `DropdownMenu.ItemLabel`（Kobalte 要求 Item 上下文；SubTrigger 不是 Item）。这会令任何带 submenu 的右键菜单把整页打进 ErrorBoundary。建议单独开一个小修：把 SubTrigger 内的 label 改成普通 `span`（或 Kobalte 对应的 SubTrigger 文本节点），并补一个「菜单含 submenu」的回归测试。此项未在本次调研中改代码。

## 7. 待拍板

- v1 是否按 §3A 做「调用列表 + 最终输出」？还是先接受 `codemode:false` 换回完整 39 张卡？
- P0 是否同时做「running tool part 合并」？它直接对着第二个问题，且改动面小。
- P1 的 Markdown 增量投影是否本批一起做？如果不做，长回答卡顿仍会存在，但 execute 卡能先解决「等待期间看不到进度」。
- §6 的菜单渲染错误是否本批顺手修？（建议单独修，避免和本调研混在一起。）
