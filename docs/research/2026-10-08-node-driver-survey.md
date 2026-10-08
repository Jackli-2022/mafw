# 节点驱动器调研：现状驱动链与会话驱动模式盘点（2026-10-08）

> P1 设计输入。方法：explore 代理全链路走查（行号级）+ 先例交叉验证。
> 姊妹篇：`2026-10-08-goal-loop-enablement-survey.md`（六断点）、`2026-10-08-node-execution-runtime-survey.md`（NodeSpec/身份）。

## 核心发现

### 1. promptAsync 的 runtime 语义分歧是现状断点的真正根因

| runtime | promptAsync 语义 |
|---|---|
| opencode | 恒 fire-and-forget（opencode-adapter.ts:94-105 立即返回） |
| pi | idle 会话上**阻塞到回合结束**（pi-session.ts:117-120：`await s.prompt + waitForIdle`）；busy 会话才排队 |

后果：`plan.node.ts:43-46`「promptAsync 后立即查 waves.json」只在 pi 下碰巧成立，opencode 下**结构性失败**。MediaRuntimeExecutor 的 `fetchLatestAssistant`（media-runtime-executor.ts:114-121）是同一分歧的另一个受害者（opencode 下拉到旧消息/空）——顺带发现的存量 bug。

### 2. prompt() 是唯一两 runtime 语义一致的通道，但不适合节点

- `prompt()` 两 runtime 都同步等完成（opencode-adapter.ts:107-141 返回 PromptResultEnvelope{parts,finish,usage,error}；pi-session.ts:123-149）
- 但 execute 回合可能几十分钟：opencode 下 HTTP 连接挂几十分钟不可靠；无内置超时必须自包（MemoryWorker 120s 模板）
- **结论：长 agentic 节点走事件驱动重入；prompt() 留给 btw 式短问答**

### 3. 事件侧语义统一：session.idle 两 runtime 都保证发出

- opencode：serve 原生；pi：`agent_end/agent_settled → session.idle`（pi-events.ts:22，PI_EVENT_MAPPINGS 表）
- `handleOpencodeEvent`（index.ts:967-1116）是中心分发点，现有 12 步消费链；**session.idle 目前无 goal 图推进消费者**（正是要补的洞）
- 现成 per-session 挂点模式：`eventTaps`（index.ts:1412-1417 一次性注销式）+ `internalSessionRoles` map——泛化为常驻 `goalNodeListeners: Map<sessionID, callback>` 即可
- session.error：opencode 有（facets chatError），pi 无独立映射（错误走 prompt throw / waitForIdle 挂起）——驱动器 error 分支要做双形态兜底

### 4. langgraph 三件套可整体退役

- 图路由 = 两个纯函数（graph.ts:4-15 `routeAfterPlan`/`routeAfterReview`）——直接搬走
- FileCheckpointer：state 文件即真相源，退役（过渡期 getCurrentState 保留）
- interrupt/Command resume：askUser 改 state 驱动（answer 写 state → 驱动器 advance），question 路由 index.ts:3964-4016 只改 resume 段

## 可复用件清单（重写不从零开始）

| 件 | 位置 | 用途 |
|---|---|---|
| `NODE_CONFIGS`（skillCommand/结果文件/parseResult） | node-runner.ts:31-73 | 原样保留，结果文件契约不变 |
| per-session event tap 模式 | index.ts:1412-1417 | 泛化为常驻节点完成监听 |
| `SessionWorkerPool.runExclusive` | session-worker-pool.ts:100-109 | per-goal 互斥（防 resume 竞态双跑） |
| MemoryWorker 超时+失效重建模板 | memory-worker.ts:109-142 | watchdog 参考 |
| `attachBudgetGuardForGoal` | index.ts:1883-1907 | 原样（onSessionCreated 签名不变） |
| `recordSessionInDb`（goal_sessions） | index.ts:6434-6439 | 原样 |
| state 原子写 + patchState 广播 | index.ts:6214-6248 | 写规范照抄 |
| `resumeStaleThreads` 周期扫描 | index.ts:6571-6587 | 扩展为节点 watchdog |
| milestone stateVersion 持久化去重 | milestone-push.ts:23-28 | 事件重放幂等参考 |
| `expectReply:false` noReply 通知 | index.ts:6971-6973 | 驱动器通知 manager 继续用 |

**零迁移约束**：`syncToFile` 的 `phase_transition` 事件签名不动（milestone-push 依赖）。

## 推荐驱动骨架（P1 第 2 节设计的基础）

```
state 文件（真相源）: { goalId, phase, round, nodeSession:{id,phase,startedAt}, pendingQuestion, lastError, ... }

advance(goalId): 读 state → 路由纯函数定下一节点 → create session（绑身份+BudgetGuard+DB记录）
  → promptAsync（fire/阻塞无所谓）→ 写 state → 注册 per-session 完成监听

onSessionIdle(sessionID): 读结果文件（NODE_CONFIGS）→ 写 state → session.delete → advance
onSessionError: lastError + ERROR verdict → advance（archive_fail 路由）

watchdog: nodeSession.startedAt 超时 → session.abort + 重试一次或 ERROR
崩溃恢复（扩 recoverState）: 扫带 nodeSession 的非终态 goal → 会话死则重建或标 ERROR
askUser: pendingQuestion 落盘 → 应答写 state.userResponse → advance
```
