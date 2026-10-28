# Code Mode × desktop ChatView 渲染调研（2026-10-28）

> 范围：opencode 2.1 Code Mode（`execute`）里调用 gateway MCP 时，desktop 能否渲染子工具调用；以及 ChatView 在「工具执行等待结果」期间拖累其他流式输出的原因与优化方向。
> 方法：opencode 2.1 / dev 源码核对 + 本机 gateway 2.1 真实 SSE 抓帧 + MAFW session-ui 代码与 `markdown-stream` 微基准。
> 结论先行：**子工具调用数据已经在 `execute` part 的 `metadata.toolCalls` 里，desktop 只缺一张 `execute` 卡；每个子调用的 output 不在 metadata（opencode 刻意不回传），所以 v1 只能做「调用列表 + 最终输出」，做不到每个 gateway MCP 的完整结果卡。第二个问题的主因是单条全局 SSE 上的 progress 突发 + 同步 store patch + prose Markdown 的 O(n²) 投影，三者叠加会挤占其他流式渲染。另：Edit/Write 卡片在 opencode 2.1 下空白是确定的字段漂移（`path`/`metadata.files[]` vs `filePath`/`metadata.filediff`），可直接修。**

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

## 3.5 Edit / Write 工具「没有输出」：opencode 2.1 wire shape 漂移

这是另一个独立但确定的 bug，和 Code Mode 无关。

### 现场证据

最新 2.1 会话 `ses_e7d324d21ffemqN3O7AJSjPpYR` 的真实 edit part：

```json
{
  "type": "tool",
  "name": "edit",
  "state": {
    "status": "completed",
    "input": {
      "newString": "...",
      "oldString": "...",
      "path": "C:\\work\\world\\docs\\2026-10-28-3d-megastructure-platform-research.md"
    },
    "content": [{ "type": "text", "text": "Edited docs/... (1 replacement)" }],
    "metadata": {
      "files": [{
        "file": "docs/2026-10-28-3d-megastructure-platform-research.md",
        "patch": "Index: ...",
        "status": "modified",
        "additions": 27,
        "deletions": 0
      }],
      "truncated": false
    }
  }
}
```

opencode 2.1 的 edit 实现（`packages/core/src/tool/plugin/edit.ts`）：

- 输入字段是 `path`（不是 `filePath`）；
- content 是 `Edited <file> (N replacements)`；
- metadata 是 `{ files: FileDiff.Info[] }`（不是 `filediff`，也没有顶层 `diff`）；
- 没有 `state.output`（output 在 content 里，由 gateway 的 live 翻译补成 `output`；历史出口仍是 content）。

### MAFW 卡片为什么空白

`packages/session-ui/src/components/message-part.tsx` 的 edit 卡：

- `props.input.filePath` 取文件名 / 目录（行 2268-2269）→ 2.1 只有 `path`，所以为空；
- `props.metadata?.filediff` 取 diff（行 2273、2300-2305）→ 2.1 只有 `metadata.files[]`，所以为 undefined；
- `<Show when={path()}>` 因此不渲染 diff body（行 2341-2360）；
- 结果：只剩一行「Edit」标题，文件名、diff、`Edited ...` 文本全部不显示。

`write` 卡同样受影响：`props.input.filePath`（行 2374）在 2.1 应为 `path`，所以 `<Show when={props.input.content && path()}>` 不渲染内容。

### 修复方向（小、确定性高）

1. 统一路径读取：所有文件类卡片用 `readPathInput(props.input)`（已支持 `filePath ?? path ?? file_path`），不要直接点 `input.filePath`。
2. 增加 `normalizeFileDiffs(metadata)`：
   - 2.1：`metadata.files[]`；
   - legacy：`metadata.filediff`；
   - 兜底：`metadata.diff` 字符串 + `readPathInput(input)`。
3. edit 卡取 `diffs[0]` 作为 `fileCompProps` 的 `{ file, patch }`；`resolveFileDiff` 已能只靠 patch 解析（`session-diff.ts:30-31`）。
4. 标题文件名/目录用归一化后的 path；`DiffChanges` 用 `files[0]` 的 `additions/deletions`。
5. 可选：把 `state.content` 的 `Edited ...` 文本作为 trigger subtitle / 空 diff 时的 fallback，保证「至少有输出」。
6. 回归 fixture 直接使用上面这份 2.1 wire 形状 + 一份 legacy `filePath/filediff` 形状，防止只修一边。

`read` 卡已经用 `readPathInput`，不受影响；`patch` 卡读 `metadata.files`，也不受影响。**这是 edit/write 两个卡片的字段映射问题，不是 gateway 丢数据。**

### 3.6 更广的历史输出缺口：content vs output

同一个 2.1 会话里，history 的 shell part 形状是：

```json
{
  "name": "shell",
  "state": {
    "status": "completed",
    "input": { "command": "ls -la" },
    "content": [{ "type": "text", "text": "..." }],
    "metadata": { "status": "...", "exit": 0, "truncated": false }
  }
}
```

没有 `state.output`。而 desktop 的 `ToolPartDisplay` 只把 `part().state.output` 传给卡片（`message-part.tsx:1667-1683`），所以：

- **live** 路径：gateway 的 2.1 翻译会从 content 合成 `output`，正常；
- **history** 路径：`state.content[]` 的文本没有被映射，shell/python/execute 等依赖 `props.output` 的卡片在历史里只剩标题/参数，没有结果。

建议一并加纯函数：

```ts
export function partOutputText(state: any): string | undefined {
  if (typeof state?.output === "string") return state.output
  if (Array.isArray(state?.content)) {
    const text = state.content.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n")
    return text || undefined
  }
  return undefined
}
```

在 `ToolPartDisplay` 单点传入 `output={partOutputText(part().state)}`，所有卡片（含 execute）的历史/live 行为一致。此项和 edit 的 diff 修复独立，但同属「输出看不到」的 P0 清理。

## 4. 第二个问题：工具等待为什么会拖累其他流式输出

### 4.1 共享单线程 + 同步 dispatcher

- desktop 只有一条全局 SSE（`MafwShell.tsx:1023, 1057-1062`），所有会话/所有 part 的事件都在 renderer 主线程同步 `dispatchShellEvent`。
- 任意一个会话的 execute progress 突发（实测 6 帧同一毫秒）都会排队进同一条主线程；如果这一批事件触发了昂贵的 tool card / Markdown 重渲染，**其他会话的 `part.delta` 也会一起被推迟**。这正好对应「一个工具在等结果，其他流式输出受影响」的现象。
- `part.updated` 每帧都会 `patchStore(applyPartUpsert(...))`（`sse/handlers/chat-stream.ts:88-98`），`applyPartUpsert` 复制整个 `parts` 桶并 map 该消息的数组（`sse/chat-reducers.ts:94-115`）。单帧成本不高（本机 500-part 消息 fixture 约 **0.009ms/次**，30KB text delta 约 **0.001ms/次**），但 burst + 下游重算会叠加——**瓶颈在渲染，不在 reducer**。

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

### 4.4 解决方法（按收益/成本排序）

| 方案 | 作用 | 成本 | 建议 |
|---|---|---|---|
| **A. tool part 事件合并** | 把同一 part 的 running 快照按 rAF/50ms 合并成一次 store/render，burst 从 N 次变 1 次 | 小；纯调度器 + 测试 | **P0** |
| **B. execute 卡增量渲染** | 子调用行 keyed、只更新状态；running 时不解析最终 output；输出限幅 | 小-中；新卡 + 纯函数 | **P0** |
| **C. prose Markdown live-tail 增量投影** | 消除 O(n²)，长回答/多段/列表不再随长度变慢 | 中；移植上游算法 + 测试 | **P1（根治长文本卡顿）** |
| **D. 终态大输出限幅/按需渲染** | 避免工具完成瞬间 parse/渲染巨大 JSON/patch 造成尖峰 | 小；卡内截断 + 展开 | P1 |
| **E. `content-visibility` / 虚拟化** | 降低离屏 turn/card 的 layout/paint | 中；滚动高度与测试复杂 | P2，先测再上 |
| **F. gateway 侧 progress 节流** | 减少广播帧 | 小；但会影响 TUI/SDK 的实时粒度，且 gateway 是共享源 | 不优先；desktop 侧合并更可控 |

#### A 的具体设计（推荐先做）

新增纯模块 `packages/desktop/src/renderer/mafw/sse/tool-part-scheduler.ts`：

```ts
type Scheduler = {
  queue(part: any): void        // running tool part → 同 id 最新快照
  flush(): void                 // 一次性 apply，Solid batch()
  drop(id: string): void
}
```

- 只合并 `part.type === "tool" && state.status === "running"`；completed/error **立即 apply**，并丢弃该 id 的 pending。
- 调度用 `requestAnimationFrame`；测试注入 32–50ms 假调度器（避免依赖浏览器）。
- `turn.completed/failed/aborted` 到达时先 `flush()` 再 seal；`part.delta` 不进入此队列，保持文本顺序。
- apply 时用 Solid `batch()` 包住多次 `patchStore`，让下游只跑一轮渲染。
- 预期：本次实测 6 帧同毫秒 burst → 1 次 execute 卡渲染 + 1 次 text delta 渲染；对多会话共享主线程同样生效。

#### B 的具体设计

- `execute` 卡用 `calls = createMemo(() => executeCalls(props.metadata))`；`<Index>` 按调用位置 keyed，行内 `createMemo` 解析 input 摘要。
- running 阶段不 parse `props.output`；只有 `status === "completed"` 才 parse/限幅。
- 行内参数摘要过滤 `content/code/oldString/newString` 等大字段，截断到 ~120 字符；完整 input 只在展开时 `JSON.stringify`。
- 失败状态只标记对应行，不在每次 progress 时重建错误卡。

#### C 的具体设计（移植上游）

- `project(previous, text, live)` 在 `tail.mode === "live"` 时原地追加 `suffix`，保留已完成 blocks 的对象身份；
- 仅在以下情况 fallback 全量 `stream()`：空行边界（含跨 delta 的 `\n` + `\n`）、非追加/截断更新、open fence、reference definition、`tail.raw` 超上限；
- `heal` 只处理最后一个空行边界之后的 tail；
- 基准/测试参考上游 PR #55857 的 `markdown-stream` 用例；MAFW 现有 `markdown-stream.test.ts` 可扩展同款 workload。
- 预期：本机 10KB prose 从 7.4–17.2s 降到几十~几百 ms 量级（上游同类 workload 15.9×–114.3×）。

#### D 的具体设计

- `execute` 最终 output 超过 e.g. 8KB / 200 行 → 只渲染首段 + 「已截断，展开查看」；展开时仍用 code 段，不一次性 parse 成 KV。
- edit/patch 的 diff 已经 `defer`，保持默认折叠；`DiffChanges` 计数不解析全文。
- 工具完成时如果卡片不在视口内，延迟到可见再挂载（可复用 `BasicTool` 的 `defer` / IntersectionObserver）。

#### 如何验证（避免只凭感觉）

1. **复现 burst**：用 Code Mode 让模型并行调用 4–8 个 gateway MCP 工具，gateway `/api/events` 记录同一毫秒的 execute progress 帧数。
2. **埋点**：dev 构建在 `dispatchShellEvent`、`markdown-stream.project()`、`ToolPartDisplay` 外层加 `performance.mark/measure`；或直接用 DevTools Performance 录一次 burst，找 >50ms 的 long task。
3. **合并后计数**：在 `applyPartUpsert` 或 scheduler 的 apply 回调计数；同一 burst 应只产生 1 次 tool part apply（+ 独立的 text delta apply）。
4. **Markdown 回归基准**：把 §4.2 的三组 workload 固化成 `markdown-stream` 性能/正确性测试，目标从秒级降到百毫秒内；同时保留 partition 不丢字符的断言。
5. **GUI 验证**：先修 §6 的菜单渲染错误，否则 ChatView 进不去；再跑「一个会话长工具 + 另一个会话流式文本」的双会话场景，观察另一会话是否仍被拖慢。

## 5. 建议的优化顺序

1. **P0：execute 卡 v1**（§3A）
   - 新增 `tool-cards/execute.tsx` + 纯函数 `execute-model.ts`（calls 解析、名字归一化、参数摘要、输出段）。
   - `defaultOpen` + `defer={false}` 让运行中也能看到子调用；或给 `BasicTool` 补 `allowOpenWhilePending`（上游 parity）。
   - 用真实 wire fixture（dotted 名 / 裸名 / search / 空 input / error / truncated）做单测。
2. **P0：Edit / Write + 历史输出缺口**（§3.5 / §3.6）
   - edit/write 改用 `readPathInput`；新增 `normalizeFileDiffs(metadata)` 兼容 `files[]` / `filediff` / `diff`；edit 取 `files[0]` 喂 `resolveFileDiff`。
   - 新增 `partOutputText(state)`，在 `ToolPartDisplay` 单点把 history 的 `content[].text` 映射为 `output`；修复 shell/python/execute 等历史无输出。
   - 用 2.1 wire fixture + legacy fixture 双回归，避免只修一边。
3. **P0：tool part 事件合并**
   - 在 desktop 的 chat-stream 对 `part.updated` 的 **running tool** 按 `part.id` 保留最新快照，`requestAnimationFrame`（测试可用 32–50ms 假调度器）flush；completed/error 立即 flush 并取消 pending；`turn.completed` 前 flush 全部。
   - 只合并 tool part，不合并 text `part.delta`，避免文本快照乱序覆盖。
4. **P1：Markdown live-tail 增量投影**
   - 移植上游思路：prose/list/table 的 live tail 原地追加，只有空行边界 / 非追加更新 / open fence / refs 等 fallback 才重 lex；tail 设字符上限；heal 只处理 tail。
   - 这是长回答卡顿的根治项，和 execute 卡无关但会明显改善「工具结束后长总结」的体验。
5. **P1：execute 终态输出限幅**
   - `state.output` 可能很大；parse/渲染前做字符/行数上限，超出显示「已截断 + 查看全文」或 code 折叠，避免工具完成瞬间的主线程尖峰。
6. **P2（可选）：`codemode:false` 开关**
   - 需要每个 gateway MCP 完整结果卡时，先在 Config/MCP 管理里提供 per-server Code Mode 开关，作为过渡。

## 6. 附带发现（菜单渲染错误，已由并行提交修复）

调研时本机 desktop 复现顶层「MAFW 渲染出错」：

```text
[kobalte]: `useMenuItemContext` must be used within a `Menu.Item` component
  ... DropdownMenuItemLabel2 (packages/ui/src/components/dropdown-menu.tsx)
  ... MenuHost (packages/desktop/src/renderer/mafw/context-menu/MenuHost.tsx)
```

根因是 `MenuHost.tsx` 的 submenu 分支在 `DropdownMenu.SubTrigger` 内使用 `DropdownMenu.ItemLabel`（Kobalte 要求 Item 上下文；SubTrigger 不是 Item）。该问题已由并行提交 `d87c87b3 fix(desktop): submenu trigger must not use Menu.ItemLabel` 修复，本批未改；GUI 验证已恢复。

## 7. 待拍板

- P0 已实施（见 §8），下一步是否做 P1 的 Markdown live-tail 增量投影？它是长回答卡顿的根治项。
- Edit / Write 的 2.1 形状与 history output 已一并修复；如果还要每个 gateway MCP 的完整结果卡，是否加 `codemode:false` 开关？
- §6 的菜单渲染错误已由并行提交 `d87c87b3` 修复（本批未改）；GUI 验证已恢复。

## 8. P0 实施记录（2026-10-28）

- `2ab32bff` fix(session-ui): read opencode 2.1 edit/write shapes and history tool output
  - 新增 `tool-output.ts`（history `content[].text` → card output）与 `file-diff-shape.ts`（`files[]` / `filediff` / `diff` 归一）。
  - edit/write 卡改用 `readPathInput` + `normalizeFileDiffs`；`ToolPartDisplay` 单点传 `partOutputText(state)`。
- `51158c04` feat(desktop): render Code Mode execute child calls
  - 新增 `execute-model.ts` / `execute.tsx`：`metadata.toolCalls` 子调用行、running 状态、失败标记、最终 output；`execute` 默认展开。
- `b815a130` perf(desktop): coalesce running tool part snapshots per frame
  - 新增 `tool-part-scheduler.ts`：running tool part 按 `part.id` 合并到 rAF，completed/error 立即 apply；`turn.completed/part.complete` 前 flush。
- 门禁：session-ui **113/113**、desktop **1888/1888**、`tsgo --noEmit -p` rc=0（desktop + session-ui）、`electron-vite build` rc=0。
- GUI 冒烟：world 会话（`ses_e7d324d21ffemqN3O7AJSjPpYR`）实测 execute 卡显示「1 次调用」+ `✓ mafw_add_memory` + 参数 + 输出 KV；write 卡显示文件名。Edit 卡在该会话已超出 10 轮渲染窗口，未直接目测；形状已由 2.1 fixture 单测覆盖。

