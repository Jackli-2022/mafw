# Turn / idle 归属：业界怎么区分「上个回合的迟到 idle」和「本回合真的结束了」

日期：2026-11-05
问题：MAFW 的 NodeDriver 复用 Tech Lead 讨论会话跑 plan 节点时，讨论回合的 idle 可能排在本节点 prompt 之后到达。
我们原先靠「产物是否被重写」判断，判不出来就宽容一次 grace，等第二个 idle——但**回合真的结束却什么都没产出**时
永远不会来第二个 idle，节点挂到 30 分钟 watchdog。

## 结论先说

业界不是靠「猜产物」，而是靠**把完成信号关联回它属于哪个请求**。归结为四级阶梯，从强到弱：

| 级别 | 机制 | 谁在用 |
|---|---|---|
| 1 | **完成信号携带 turn/请求标识**，只接受属于当前派发的那个 | opencode CLI 的 tick、orca 的 `user_event_completed` marker |
| 2 | **idle 带类型**（正常结束 vs 需要人） | Claude / Qoder managed agents 的 `stop_reason.type` |
| 3 | **动作前复查活状态**，防止迟到的 idle 结束一个正忙的新回合 | opencode CLI transport |
| 4 | **超时/心跳兜底**（判不出来时按失败处理） | Temporal 的 heartbeat + start-to-close |
| ✗ | 靠猜产物 / 靠自由文本 | 业界明确反对 |

我们刚加的 `reuseGraceMs`（90s 超时 → artifact_missing）是**第 4 级**：正确，但只是兜底，不是主判据。

## 逐条证据

### 1. opencode 自己的 CLI：tick 计数 + 复查状态

`packages/opencode/src/cli/cmd/run/stream.transport.ts`（dev）注释直说：

> The tick counter prevents stale idle events from resolving the wrong turn.
> We also re-check live session status before resolving an idle event so a delayed idle from an older turn
> cannot complete a newer busy turn.

做法：
- 每次发起回合把 **tick** 自增；idle 只结算**当前 tick** 的 Wait。
- 结算前再查一次 `session.status`，确认现在真的是 idle（不是新的 busy）。

这正是我们缺的那一层：idle 没有身份，所以我们才要靠产物内容猜。

### 2. Claude / Qoder managed agents：idle 是**有类型的**

`session.status_idle` 携带 `stop_reason.type`：

| stop_reason | 含义 | 客户端该做什么 |
|---|---|---|
| `end_turn` | 回合正常结束（或被打断） | 可以发下一条 |
| `requires_action` | 卡在等人（工具确认 / custom tool result），`event_ids` 指出被谁挡住 | 先回复那些 id |

对我们最有用的是：**「结束」和「等人」是两个不同事件**，不是从「有没有产物」反推。
Qoder 的同一份文档也写明事件流顺序：
`session.status_running → … → span.model_request_end → session.thread_status_idle → session.status_idle`。

### 3. orca-agent-engine：完成标记**绑定到源事件 id**

`docs/managed-agents/event-processing-semantics.md`：

> The dispatcher records accepted turn-driving source user-event IDs FIFO for each live session…
> When SessionRunner persists a terminal `session.status_idle`, it appends an internal companion marker
> for the oldest source ID in that FIFO… `{"type":"session.user_event_completed","user_event_id":"evt_…"}`

三条可借鉴：
- 完成是**显式标记**，不是推断出来的；
- 标记 ID 与幂等键由 `(workspace, session, source event id)` **确定性派生**，重放不会重复；
- 原文特别强调：*「Correctness does not depend on the process-local LRU deduplication」* —— 幂等靠持久化事实，不靠内存集合。
（我们的 `reuseIdleGrace` 是内存 Set，重启即失效；`pod_events.dedupeKey` 走 DB，是对的方向。）

### 4. Temporal：判不出来时，超时就是唯一手段

- **Heartbeat Timeout**：worker 定期 ping，超时即判定失败并重派；「心跳超时应为心跳间隔的 2–3 倍」。
- **Start-To-Close Timeout**：必须设置——因为 *「the Temporal Server doesn't detect Worker process failures directly:
  it relies on this timeout」*。
- 社区里那条经典坑：活动实际跑超时后仍继续执行，完成时服务端拒绝（`invalid activityID or activity already timed out`）。

对我们的映射：节点级 watchdog（30 分钟）就是 Start-To-Close；我们新加的 grace 超时相当于把心跳粒度加到「宽容窗口」上，
但仍然只是兜底。

### 5. 业界明确反对「从自由文本/副作用反推状态」

SuperAgent 的域模型把这条写进了 rejected concepts：

> Inferring "waiting on a person" from a report's free text — the classification needs structured facts;
> the Executor asks through a structured field.

同理，用「waves.json 的 mtime 变没变」判断「plan 回合完没完成」是同一类错误：**把副作用当信号**。

## 对 MAFW 的建议（按性价比排序）

1. **（首选）给 idle 加归属**：NodeDriver 在派发时记 `dispatchTick++`（或 opencode 的 messageID）；
   只接受「派发之后至少有过一次本回合活动（`part.updated` / `message.updated`）」的 idle 作为完成。
   - 没有活动就来的 idle = 陈旧 → **直接忽略，且不消耗 grace**；
   - 有活动才来的 idle = 真结束 → 直接 completeNode（哪怕没产物，走 artifact_missing）。
   这比现在的「产物 mtime」判据正确得多：**无产物的完成是合法的**（结构化交卷就是），产物不是完备信号。
2. **把完成做成显式标记**（orca 模式）：节点收账只认 `submit_result` / `artifact` / 显式完成事件，
   不再从「idle + 文件变了」推断；幂等键走 DB。
3. **idle 类型化**：Adapter 把 runtime 的 idle 映射成 `end_turn` / `requires_action`，
   driver 只对 `end_turn` 收账（我们已有 `turn.completed` 三元组，缺的是 reason 维度）。
4. **保留超时兜底**（已实现 `reuseGraceMs`），并考虑把「节点无活动」也纳入 watchdog 判据（heartbeat 语义）。

现状：只做到 4。1 是真正的根因修复，改动集中在 `driver.onSessionIdle` + 事件接线，比 4 大不了多少。

## 参考

- `opencode` dev：`packages/opencode/src/cli/cmd/run/stream.transport.ts`（tick + 状态复查）
- Claude Platform：Session event stream / webhooks（`session.status_idle` + `stop_reason`）
- Qoder：`docs.qoder.com/cloud-agents/events-stream`（事件顺序与 idle 语义）
- orca-agent-engine：`docs/managed-agents/event-processing-semantics.md`（完成 marker 与幂等键）
- Temporal：Activity timeouts / Detecting Activity failures / Long-running Activity heartbeats
- dsh-superagent-prototype：`docs/001-domain.md`（Report 状态 + rejected concepts）
