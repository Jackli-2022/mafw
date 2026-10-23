# Task part metadata + `/api/shell` 两态实证（B 线 Task 0）

> 日期：2026-10-23 · 环境：opencode 2.1.0 serve（gateway :3000，`serveRunning=true`，active runtime `opencode`，dialect `v1`）
> 方法：scratch 会话 `ses_e992b287affeGa4Lr5AcArUQDh` → `promptAsync` 要求派一个子代理 → `GET /api/sessions/:id/messages?limit=50` 抓 task/subagent part → 探 `/api/shell`。

## 1. 任务 part wire 形状（关键）

父会话里派子代理的 part 原始形状：

```jsonc
{
  "type": "tool",
  "id": "call_aaf137c55430457089beaa5e",
  "name": "subagent",          // ← 没有 tool 字段
  "executed": false,
  "state": {
    "status": "completed",
    "input": { "agent": "general", "description": "...", "prompt": "..." },
    "metadata": {
      "sessionID": "ses_e992a6916ffeUVkLF7Kx88SC72",   // ← 大写 ID
      "status": "completed",
      "truncated": false
    }
  },
  "toolClass": "other"         // ← gateway enrich 读 part.tool（undefined）→ other
}
```

- **`metadata.sessionID`**（不是 `sessionId`）是子会话 id 的唯一键。
- **`part.name = "subagent"`**，不是 `part.tool = "task"`；历史路由的 `enrichHistoryParts` 只读 `part.tool`，因此 `toolClass` 落 `"other"`、`canonicalTool` 缺失。
- 子会话在 `/api/sessions/:id/children` 里**看不到**（返回 `items: []`），与六方调研的「subagent sessions hidden」一致；跳转只能靠 part metadata。
- 同一父会话这次实际派了两个子代理（模型没遵守「exactly one」），不影响 wire 结论：
  - `ses_e992a87a0ffe0rHx0OMFkDcPI5`
  - `ses_e992a6916ffeUVkLF7Kx88SC72`

## 2. `/api/shell` 两态

| 路径 | 结果 |
|---|---|
| `GET http://127.0.0.1:3000/api/shell`（经 gateway 反代） | **401 Unauthorized** |
| `GET http://127.0.0.1:3000/api/runtime` | `active.name = "opencode"`，`dialect = "v1"`，`serveRunning = true` |
| `GET http://127.0.0.1:3000/health` | `serveRunning = true` |

结论与 `2026-10-22-background-wire-probe.md` 一致：**反代没有注入 v2 Basic 鉴权**，B3 的 `backgroundRestAvailable()` 在当前环境应为 `unavailable`；REST 三件（输出/终止/全部转后台）不可用是预期，不是前端 bug。B3 只需把 `unavailable` 说明出来，并把 60s 重探接好。

## 3. 对 B 线的影响（裁定输入）

1. **B1 子代理跳转**：`taskChildSessionID` 三键兼容仍然做（`sessionID` 命中）；但更上游的是 **tool part 名称归一化**——v2.1.0 的 `name:"subagent"` 没有 `tool`，session-ui 的 task 卡注册在 `"task"` 下，`resolveToolRender` 找不到 → 退 GenericTool，卡片没有跳转入口。必须在 desktop 侧把 `tool = tool ?? name` 归一化，并给 session-ui 加 `subagent → task`、`shell → bash` 别名。
2. **B3 后台任务**：`background-detect.ts` 现在 `TARGET_TOOLS.has(part.tool)`；v2.1.0 shell part 同样只有 `name:"shell"` → 后台检测全灭。归一化 + `part.tool ?? part.name` 兜底同时修 B3 的核心面（不只是 REST 提示）。
3. **历史与 live 两条路径**：历史入口是 `MafwShell.loadSessionHistory` / `ChatPane.loadOlder`（parts 原样入 store）；live 入口是 `sse/chat-reducers.ts:applyPartUpsert`。三处都要过 `normalizeToolPart`。
4. **未动 gateway**：`enrichHistoryParts` 的盲区属于用户并行 v2 兼容工作；desktop 归一化是防御性、幂等，gateway 修好后自动重合。

## 4. 交付状态

- scratch 会话已删除（`DELETE /api/sessions/ses_e992b287affeGa4Lr5AcArUQDh`）。
- 本文件是 Task 1 扩容（desktop part 归一化）与 B3 检测修复的依据。
