# CodeMode 工具结果可得性再调研（2026-11-19）

> 问题：CodeMode（`execute`）里嵌套调用的工具结果，desktop 是否都能拿到？
> 结论：**不能。** 子调用只有 name / status / input；没有 per-call output。只有最终 `execute.output`（脚本返回值）。
> 前置：`docs/research/2026-10-28-codemode-tool-rendering-research.md`、`docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`。

## 1. 真实数据形状（本机 gateway）

从 `GET /api/sessions/:id/messages` 取到的 execute part（`ses_e744…`，`tool_zBhg…`）：

```json
{
  "type": "tool",
  "name": "execute",
  "state": {
    "status": "completed",
    "input": { "code": "const result = await tools.mafw_python({...}); return result;" },
    "content": [{ "type": "text", "text": "keys [...] rows key rows len 40 ..." }],
    "metadata": {
      "toolCalls": [
        {
          "tool": "mafw_python",
          "status": "completed",
          "input": { "code": "import json ..." }
        }
      ],
      "truncated": false
    },
    "output": "keys [...] rows key rows len 40 ..."
  },
  "toolClass": "other"
}
```

关键点：

- `metadata.toolCalls[]` 只有 `tool` / `status` / `input`；
- 没有 `output`、`error` 文本、`callID`；
- `state.content[].text` 与 `state.output` 是**整个脚本**的最终输出，不是子调用的输出；
- `tool` 可能是裸名（`mafw_python`）或命名空间名（`mafw.mafw_get_axioms`），`input` 可能缺省。

## 2. 事件链

- opencode 2.1 通过 `session.tool.progress` / `session.tool.success` 发 execute part；
- adapter `adapters/opencode/src/events-21.ts`：
  - `session.tool.progress` → `part.updated`，透传 `data.metadata`（第 407-414 行）；
  - `session.tool.success` → `part.updated`，`output = textOfContent(data.content)`（第 415-427 行）；
  - 没有把 `metadata.toolCalls` 展开成独立 tool part。
- `session.next.tool.progress` 在 `events.ts` 里也只映射 `callID` + `kind: "output"`，没有子调用结果字段（第 136-139 行）。
- gateway 侧没有 `toolCalls` enrich；搜索 `gateway/src` 无 `toolCalls` 命中。

## 3. 能渲染到什么

| 信息 | 可得 | 说明 |
|---|---|---|
| 子调用名称 | ✅ | `metadata.toolCalls[].tool`，需归一化 |
| 子调用输入 | ✅ | `input?`，可能缺省/很大 |
| 子调用状态 | ✅ | running / completed / error |
| 子调用输出/错误文本 | ❌ | 不在 metadata；错误只体现在 status |
| 脚本最终输出 | ✅ | `state.output`（history 还可能是 `state.content[].text`） |
| 脚本代码 | ✅ | `state.input.code` |
| 每个子调用的专属结果卡 | ❌ | 没有 per-call output，无法填 |

## 4. 如果一定要每个子调用结果

### A. 保持现状（推荐 v1）

`MafwExecuteCard` 已经显示：

- 子调用列表（名称/参数摘要/状态）；
- 最终输出（`genericSections` + 8KB/200 行限幅）；
- 运行中默认展开，能看到子调用进度。

这与 opencode 当前能力边界一致，不需要伪造数据。

### B. `codemode: false`（按需开关）

给 MAFW MCP server 关掉 Code Mode：每个 gateway 工具恢复为直连 tool part（独立 `callID` / output），现有 39 张专属卡、失败卡、审批都能拿到完整结果。

代价：这些工具重新进入模型工具目录（context 成本），失去 CodeMode 的并行编排/中间值不进上下文。适合“必须看每个工具结果”的项目，作为过渡开关。

### C. gateway 侧记录 MCP 调用结果并回填（不推荐 v1）

gateway MCP server 的 `tools/call` handler 能看到每次调用的 `name` / `args` / result，理论上可以：

1. 在 MCP server 里记录 `{tool, input, output, timestamp}`；
2. 等 `execute` part 到达时，用 tool + input + 时间窗匹配 `metadata.toolCalls`；
3. 把 output 附到子调用或单独事件。

但：

- `metadata.toolCalls[]` 没有 `callID`，并行同名/同参调用无法稳定区分；
- MCP server 是共享的，request 里没有可靠的 session/turn 归属；
- 结果可能很大/敏感，会复制一份到事件流；
- 与 opencode 自己的状态可能重复/漂移。

所以只把它记为“可行但需要上游 callID”的方案，不在 v1 做。

### D. upstream opencode

给嵌套调用独立 part / callID / output（研究稿提到的 #54812 方向）是根治。MAFW 侧不应伪造子 part。

## 5. 对 ToolPresentation 的影响

- `execute` 是 **rich** 卡：`collapsed` = 标题 + 最近/失败子调用摘要 + `N 次调用`；`expanded` = 子调用列表 + 最终输出；
- `renderBody` 保留现有 `MafwExecuteCard` 正文，`present` 只负责折叠字段；
- **不要**给子调用行加“结果”展开；它们只有 input/status；
- `partOutputText(state)` 负责 history 的 `content[].text`，保证最终输出在历史里也能看到；
- conformance fixture 必须包含：dotted/bare 名、空 input、running/error、无 output 子调用。

## 6. 建议

1. 先按 Plan `2026-11-19-tool-presentation-contract` 的 Task 9 把 `execute` 接 `present` + `renderBody`；
2. 保持“子调用列表 + 最终输出”，不承诺 per-call 结果；
3. 如果产品确实需要每个子调用的完整结果卡，再做 `codemode:false` 的 per-server 开关（配置页），不要走 gateway 伪造。
