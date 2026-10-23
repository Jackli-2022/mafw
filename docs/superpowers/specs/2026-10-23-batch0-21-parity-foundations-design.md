# Batch 0 — 2.1 适配收口与地基（Design）

> 日期：2026-10-23 · 状态：待实施（用户已批准批次顺序）
> 上游：本会话路线图（Batch 0/1/2/3/4/5）。本设计只覆盖 Batch 0，不碰后续批次。

## 1. 意图与为什么

opencode 2.1.0 适配主体已完成，但四类“小口子”仍在漏：子代理树只有历史快照没有实时行、agent/model 选择要等下一条消息才生效、回合终态缺少可解释的 stop reason、2.1 已发的 diff/compaction/inbox/retry/interrupted 事件没有进入 canonical 管线。

这四类都是**低改动、高杠杆**：

- 子代理树给后续 subagent 全栈 / durable task 提供父子真值；
- sticky 切换给 session config 族提供即时动词；
- StopReason 给 outputSchema 重试、durable task 终态、重试/降级决策提供依据；
- SSE 补漏让桌面/EventInspector 不再对 2.1 的关键事件失明。

## 2. 目标 / 非目标

**目标**

1. `GET /api/sessions/:id/children` 返回真实子会话（不再恒空）；桌面 SubagentDock 能出历史行与实时行。
2. `POST /api/sessions/:id/agent` / `/model` 即时切换；桌面选择后立刻生效，失败回滚。
3. `turn.completed/failed/aborted` 携带 `stopReason`（canonical 枚举），`PromptResultEnvelope` 同步。
4. 2.1 事件进入 canonical：`session.diff`、`session.compaction.failed`、`session.execution.interrupted`、`session.retry.scheduled`、`session.inbox.*`。

**非目标**

- 不做 outputSchema / elicitation / durable task / subagent spawn 动词（后续批次）。
- 不做 per-turn diff 语义（B3.1 并行 spec 负责；这里只透传 `session.diff` 事件）。
- 不做队列 UI（只把事件映射成 `queue.updated`；UI 在 Batch 5）。
- 不改 `task.*` 词汇；不新增 canonical 事件类型（复用现有 `session.diff` / `queue.updated` / `message.updated`）。

## 3. 关键契约（2.1.0 实证）

- `GET /api/session?parentID=<id>` 返回 `{data: Session.Info[], cursor}`；`Session.Info.parentID` 存在。**不需要 SQLite / 新路由。**
- `POST /api/session` body 接受 `parentID`（用于后续 spawn；本批只在契约里预留）。
- `POST /api/session/{id}/agent {agent}`、`POST /api/session/{id}/model {model:{id,providerID,variant?}}` 存在，返回 204。
- `POST /api/session/{id}/prompt` body **无** `format` / `outputSchema`；本批不碰。
- `Assistant.finish` 枚举：`stop | length | tool-calls | content-filter | error | unknown`；`Idle.outcome`：`succeeded | failed | interrupted`。
- 2.1 事件：`session.diff`、`session.compaction.failed`、`session.execution.interrupted`、`session.retry.scheduled`、`session.inbox.enqueued/delivered/update/cancel/cancelled/delivery.changed`。

## 4. 设计

### 4.1 Children / parentage

- `RuntimeClient.session.children` 保留；opencode adapter 改为：

```ts
async children(opts: { sessionID: string }) {
  const body = await directNative(`/session?parentID=${encodeURIComponent(opts.sessionID)}&limit=100`, 'GET');
  return unwrapNative<any[]>(body) ?? [];
}
```

- `SessionCreateOpts` 增 `parentID?: string`；adapter `create` 仅在存在时写入 body（2.1 不接受 `null` 以外的空串）。
- 桌面实时行：`sse/handlers/subagents.ts` 增 `mapSubagentToolPart(event)`：
  - `event.type === 'part.updated'` 且 `part.type === 'tool'`；
  - 工具名 `subagent` 或 `task`（大小写不敏感）；
  - `state.metadata.sessionID` = childID，`part.sessionID` = parentID；
  - `state.input.description` = title，`state.input.agent` = agent；
  - 输出 `{kind:'session-created', info:{id:childID,parentID,title,agent}}`。
  - handler 不消费 `part.updated`（返回 false），chat-stream 继续正常处理。
- Tracker `session-created` 增可选 `agent`；`parseAgentFromTitle` 支持 `(<desc> @<agent> subagent)` 与尾部 `@agent` 两种历史标题。

### 4.2 Sticky agent/model

- 契约：`RuntimeClient.session.switchAgent?` / `switchModel?`（可选；缺实现 → 503）。
- Adapter：直接 `directNative` 调 2.1 两个端点；`switchModel` 复用现有 `{id, providerID, variant?}` 映射。
- Gateway 路由 `routes/session-switch.ts`：`POST /api/sessions/:id/agent` / `/model`，200 `{ok:true}`（避免 SDK 204 JSON 解析问题），失败 500/503。
- SDK `sessions.switchAgent/switchModel` + preload + `MafwAPI` 类型。
- 桌面：`onModelSelect` / `applyAgentSwitch` 先乐观更新 pick，再调用；失败回滚并 toast。

### 4.3 StopReason

canonical 枚举（新增类型 `StopReason`）：

```ts
type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal' | 'cancelled' | 'error' | 'unknown'
```

映射：`stop→end_turn`、`length→max_tokens`、`tool-calls→tool_use`、`content-filter→refusal`、`error→error`、`unknown→unknown`；`interrupted→cancelled`。

- `PromptResultEnvelope` 增 `stopReason?`；adapter `prompt` 从 `info.finish` 映射。
- 事件：`session.step.ended` 记录 per-session `lastFinish`；`session.execution.succeeded` 从映射表移入 `translateOpencode21Event`，输出 `turn.completed` + `stopReason`（优先 `data.finish`，否则 lastFinish，否则 `unknown`）；`session.execution.failed` 输出 `turn.failed` + `errorCode`；`session.execution.interrupted` 输出 `turn.aborted` + `stopReason:'cancelled'`。
- `session-ui` 增 `util/stop-reason.ts`（label/是否异常），`SessionTurn` 在非 `end_turn` 时显示一行轻提示；历史 `finish` 与 live `step-finish.reason` 都可作为来源。

### 4.4 SSE 补漏

| 2.1 事件 | canonical | 载荷 |
|---|---|---|
| `session.diff` | `session.diff` | `{sessionID, diff: data.diff ?? data.files ?? []}` |
| `session.compaction.failed` | `session.compacted` | `{sessionID, status:'failed', error, reason}` |
| `session.execution.interrupted` | `turn.aborted` | `{sessionID, stopReason:'cancelled'}` |
| `session.retry.scheduled` | `message.updated` | `{info:{id:assistantMessageID, sessionID, role:'assistant', retry:{attempt,at,error}}}` |
| `session.inbox.*` | `queue.updated` | `{sessionID, item?, id?, action}`；无 item 时桌面按需拉 inbox |

从 `NOISE_TYPES` 移除 `session.inbox.enqueued/delivered`、`session.retry.scheduled`。

## 5. 失败模式 / 风险

- children 端点 404/超时：adapter 返回 `[]`，桌面保持“无子代理”空态，不抛错。
- 子会话已删：`children` 快照不含；tracker 的 `session.deleted` / 探针收敛为 aborted。
- 实时 tool part 无 metadata（input.started 阶段）：跳过；called/progress/success 阶段再建行，幂等去重。
- sticky 切换失败：本地 pick 回滚，不能留下“显示已切换但服务端没切”的假状态。
- 2.1 204：gateway 路由统一返回 200 JSON；adapter 内部 204 不解析。
- `session.diff` 形状漂移：同时接受 `data.diff` / `data.files`；空数组是合法值。
- 旧缓存：已缓存的 tool part 可能无 metadata；历史 `children` 快照会补 completed 行，实时行只信事件。

## 6. 验收

1. 打开有历史子代理的父会话，SubagentDock 出历史行；新派子代理后 2s 内出 running 行，终态后变 completed/failed。
2. 切换 agent/model 后不发送消息，重新打开会话仍显示新选择；另一客户端收到 `session.updated`。
3. 一轮正常对话 `turn.completed.stopReason === 'end_turn'`；中断为 `cancelled`；`length` 回合桌面出现“达到输出上限”提示。
4. EventInspector 能看到 `session.diff` / `queue.updated` / `message.updated(retry)`；无 `unhandled SSE event` 告警。
5. gateway/desktop/session-ui 全量测试通过，build 通过，本机部署后真机冒烟。
