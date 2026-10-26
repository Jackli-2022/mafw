# T2-2 回合级软暂停（RunState）Design

> 日期：2026-10-26 · 状态：草案（待 builder check）
> 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` §3 Tier 2「暂停-恢复 RunState」
> 现实约束：opencode/pi 均无进程级挂起原语（只有 abort/interrupt）——本设计做**诚实的软暂停**：暂停=中止当前回合+保存续跑简报；恢复=合成"继续"提示开启新回合并追踪状态。不假装挂起进程。

## 1. 意图

research 判断："暂停-恢复"正在取代"打断-重来"（OpenAI RunState / MCP tasks / ACP v2 / pi-durable / dsh 四源同向）。我方 abort 是终态、fork 是历史分叉，都不是"暂停后恢复同一 run"。

本轮落地：用户可在一个长回合中途**暂停**（例如准备改配置、开会、避免烧预算），之后**恢复**继续；暂停点有摘要可见，恢复后自动续跑。跨 runtime 可移植，零 runtime 新动词（组合既有 abort/messages/promptAsync/queue）。

## 2. 现状（2026-10-26 侦察）

- `session.abort` 在契约与 opencode/pi 双实现（opencode 走 `/interrupt`；pi `AgentSession.abort`）
- `session.messages` 返回 `{info, parts}`（含文本 parts）→ 可离线抽取续跑简报
- `busySessions`（gateway 内存）在 turn.started 置位、三终态清除；**清除时 `flushSessionQueue` 自动续发一条排队消息**——暂停必须在 abort 前挂起队列闸门，否则暂停会立刻被队列"续命"
- 队列（Batch 5）在内存 `SessionQueue`；`queueList/cancel/clear` 已有 HTTP/SDK/桌面
- 无任何 run/suspend/resume 实体或事件（全仓 grep 零命中）

## 3. 目标

1. `run_states` 实体（gateway.db）：`suspended → resumed → completed|failed|cancelled` 状态机；每会话同时最多一个活跃 run
2. `POST /suspend`（忙时）+ `POST /resume`（闲时）+ `GET /run` + `POST /run/discard`
3. 暂停时保存**续跑简报**：最后 user 文本、最后 assistant 文本尾（≤1200 字符）、锚点消息 id、队列项数
4. 恢复时合成续跑提示（简报 + "从断点继续，不重复已完成工作"）并发送
5. 暂停期间队列闸门关闭（不发下一条）；恢复后正常排空
6. canonical `run.updated` 事件 + SDK/preload + 桌面暂停按钮/暂停条（跨客户端经 store 同步）

## 4. 非目标

- 进程级挂起/续跑（runtime 无原语；不伪造"同一进程内存"）
- 工具调用级断点续传（中止即丢在飞工具；简报只描述断点，不重放）
- shell durable task 的暂停（进程不可续；另行处理）
- TUI 暂停 UI（只认事件，后续批次）
- 自动暂停（预算/时间阈值触发）——后续可挂 BudgetGuard

## 5. 设计

### 5.1 数据模型（gateway.db `run_states`）

```sql
id TEXT PRIMARY KEY,             -- run_<uuid>
session_id TEXT NOT NULL,
project_dir TEXT NOT NULL,
status TEXT NOT NULL,            -- suspended | resumed | completed | failed | cancelled
reason TEXT,                     -- 用户暂停备注（可选）
brief_json TEXT NOT NULL,        -- { lastUserText, lastAssistantTail, anchorMessageID, queuedCount }
created_at TEXT NOT NULL,
suspended_at TEXT NOT NULL,
resumed_at TEXT,
finished_at TEXT
-- INDEX (session_id, created_at)
```

- 每会话最多 1 个活跃（suspended/resumed）：suspend 前查；有则 409
- 保留：每会话 20 条（创建/终结时修剪最老终态）
- 会话删除联动清理（复用 session.delete cleanup 链）

### 5.2 RunStateService（`gateway/src/core/run/`）

deps 注入、纯核心：

```ts
export type RunStatus = 'suspended' | 'resumed' | 'completed' | 'failed' | 'cancelled'
export interface ResumeBrief {
  lastUserText: string
  lastAssistantTail: string
  anchorMessageID: string
  queuedCount: number
}
export interface RunState { id; sessionID; projectDir; status; reason?; brief; createdAt; suspendedAt; resumedAt?; finishedAt? }
// buildResumeBrief(messages: any[], queuedCount): ResumeBrief | null  —— 纯函数
// suspend({sessionID, projectDir, reason?}): RunState
// resume(id, {promptText}): RunState
// finish(sessionID, outcome: 'completed'|'failed'|'cancelled'): RunState | null
// active(sessionID): RunState | null
// discard(id): RunState
// deleteForSession(sessionID): void
```

`buildResumeBrief`：按 `time.created` 升序，取最后一条 user 的 text parts join（≤600 字符）、最后一条 assistant 的最后一个 text part 尾部（≤1200 字符）、user 消息 id；无 user → null。

续跑提示模板（服务端生成，`composeResumePrompt(brief)` 纯函数）：

```
[MAFW 续跑] 你在上一回合被用户暂停，现在恢复。
暂停前用户请求（截断）：<lastUserText>
暂停前你的最后输出（截断）：<lastAssistantTail>
请从断点继续完成任务；不要重复已完成的步骤；如上下文不足，先简要说明再继续。
```

### 5.3 暂停/恢复流程

**suspend**（route → gateway 编排 → service）：
1. 能力门：`runStateApi` 且 `runtime.session.abort` 存在，否则 503
2. 会话忙门：`busySessions.has` 优先；不在 map 也**仍尝试 abort**（busy 是事件派生 + 15min 清扫，长回合可能失明）——abort 抛"已空闲"→ 409 `session is not running`
3. 预取 messages（limit 200）确认有 user 锚点（避免 abort 后无简报可存）
4. `suspendedSessions.add(sessionID)` **先于 abort**（队列闸门）
5. `runtime.session.abort()`；失败 → 清闸门 + 502
6. **等终态落定**（busy 清除或该会话终态事件，≤5s；超时视为落定）——避免 resume 抢跑
7. **abort 后重取 messages**（部分输出已 settle）→ `buildResumeBrief(messages, queue.size)`（纯函数；忽略 `[MAFW 续跑]` 开头的合成 user 消息）
8. `service.suspend(...)` 落库（status=suspended, settled=true 视步骤 6）+ `run.updated` 广播
9. 返回 `{ run }`（含 brief 供 UI 展示）

**resume**：
1. 会话必须**非** busy（否则 409 `session is still stopping; retry`）
2. `service.active(sessionID)` 必须 suspended（或 body.runId 指向的 run），否则 404/409
3. **先标记 resumed（落库 + 事件）**，再清闸门——pi 的 `promptAsync` 会阻塞到回合结束，若先发后标，终态事件会早于 resumed 状态而丢失（builder #2）
4. 生成续跑提示（`composeResumePrompt(brief)`），**fire-and-forget** 发送：`rt.session.promptAsync(...)` 不 await（opencode 立即返回；pi 的阻塞语义不再拖住 HTTP）
5. 发送异步失败 → `service.reopen(run.id)`（resumed→suspended）+ 重新挂闸门 + 广播
6. 立即返回 `{ run, prompted: true }`
7. 恢复提示先于队列中的既有消息（promptAsync 立即起回合；队列在下一终态才续发）

**finish**：`handleRuntimeEvent` 三终态：
- 有 `resumed` run → completed / failed / cancelled（aborted），广播
- 有 `suspended` run（本次 abort 的终态）→ 只清 settled 标记，不 finish

**discard**：允许 suspended 或"resumed 但当前 idle"；→ cancelled + 清闸门 + **`flushSessionQueue`**（不吞用户已排队消息）；resumed 且 busy → 409。

**settle 竞态**（builder #4）：resume 前必须 settled（内存标记，suspend 的 abort 终态到达或 5s 超时置位）。避免延迟的 abort 终态把刚恢复的新回合成 `cancelled`。

### 5.4 HTTP API

| 路由 | 语义 |
|---|---|
| `POST /api/sessions/:id/suspend` | body `{reason?}`；忙/可 abort → 200 `{run}`；已空闲 → 409 |
| `POST /api/sessions/:id/resume` | body `{runId?}`；闲+suspended+settled → 200 `{run, prompted:true}`；忙/未落定 → 409；无 run → 404 |
| `GET /api/sessions/:id/run` | 200 `{run: RunState|null}`（活跃 run） |
| `POST /api/sessions/:id/run/discard` | body `{runId?}`；suspended / resumed-idle → 200 `{run}`；resumed-busy → 409 |

- 能力位 `runStateApi?: boolean`（opencode/pi 均 true；缺 → 503）
- 路由 `routes/session-run.ts`，wave1 绑定，`isBusy` 复用 T2-1 模式
- 队列闸门在 gateway：`private suspendedSessions = new Set<string>()`；`flushSessionQueue` 首行早退
- **其它发入口**（builder #1）：`POST /api/session/:id/promptAsync` 与 prompt/command 路由在 `busySessions.has` 之外同时判定 `suspendedSessions.has`——暂停中一律入队（不直发）。内部 noReply 通知（milestone/budget/self-update）不启模型回合，保持放行；其余内部直发为已知边界（manager/goal 会话极少被暂停）

### 5.4a 启动恢复（builder #5）

- 启动时 `reconcileRuns()`：
  - `suspended` → 重新挂 `suspendedSessions`（暂停跨重启保留）
  - `resumed` → `cancelled`（reason `gateway restarted`）——避免"永久活跃、无法再暂停"
- 运行期兜底：`discard` 接受 resumed-idle，用户可手动清理
- busy 时间戳在会话任意事件上刷新（防 15min 清扫误删长回合，builder #3）

### 5.4b 续跑提示表示（builder #7）

- 文本前缀 `[MAFW 续跑]`；`buildResumeBrief` 跳过此前缀的 user 消息（防第二次暂停引用模板）
- 不加合成 part 标记（opencode prompt 输入不接受 synthetic；改动面大于收益）——提示会作为普通 user 消息进入历史/UI/observation，作为可审计的暂停-恢复记录；文档明示


### 5.5 事件

- canonical `run.updated`（信封 `mafwBroadcast`）：`{sessionID, run}`，suspend/resume/finish/discard 时广播
- 词汇六处同步（SDK events / MAFW / matrix / TUI KNOWN / desktop 覆盖）；桌面 dispatcher 新增 `run` dep → `run-store`（per-session active run），ChatPane 消费

### 5.6 桌面

- ChatPane：忙时工具条新增「暂停」（ButtonV2，调 `sessions.suspend`）；暂停条（composer 上方）显示摘要 + 「恢复」「放弃」
- 会话切换/打开时拉 `GET /run`；`run.updated` 经 dispatcher 更新 store
- 能力门：`caps.runStateApi !== true` 时隐藏

### 5.7 测试

- 纯函数：`buildResumeBrief`（parts 抽取/截断/无 user/跳过 `[MAFW 续跑]` 前缀）、`composeResumePrompt`
- service：状态机（suspend→resume→finish；重复 suspend 409；discard 状态限制；resumed-idle discard；20 条修剪；删除联动；reopen）
- routes：能力门 503 / 忙闲门 409 / 未落定 409 / 404 / 成功链路（resume 先落库再发送）
- gateway 编排：suspend 先挂队列闸门；暂停中 promptAsync 入队；discard 后 flush；终态 finish 只作用于 resumed（abort 终态只清 settled）
- 启动恢复：suspended 重挂闸门 / resumed→cancelled
- 桌面：run-store、暂停条渲染/动作、能力门
- 真机冒烟：full-access 会话跑 sleep 命令中途 suspend → run suspended + 队列不续跑 → resume → completed；重复 suspend 409 / 闲时 suspend 409 / 暂停中发消息入队

## 6. 风险

| 风险 | 处置 |
|---|---|
| abort 与自然完成竞态 | abort 抛"已空闲"→ 409；预取 user 锚点失败则在 abort 前退出 |
| abort 终态延迟 → resume 抢跑 | settled 标记（终态或 5s 超时）+ resume 门；延迟终态只清 settled 不 finish |
| pi promptAsync 阻塞 / 终态早于状态 | **先标 resumed 再 fire-and-forget 发送**；发送失败 reopen→suspended |
| busy 15min 清扫误删长回合 | 任意会话事件刷新 busy 时间戳；suspend 对不在 map 的会话仍尝试 abort |
| gateway 重启留下 resumed 僵尸 | 启动 reconcile：suspended 重挂、resumed→cancelled |
| 暂停期间其它发入口启动回合 | 公共 prompt 路由把 suspended 当 busy 入队；内部 noReply 通知放行；其余内部直发为已知边界 |
| 暂停时在飞工具副作用已发生 | 简报注明"暂停点之前的工具结果保留在历史"；不做回滚 |
| 队列闸门泄漏（进程内 Set） | 启动 reconcile 按 run 表重挂；discard/resume 失败路径显式清理 |
| 续跑提示进入 observation/历史 | 作为可审计 user 消息接受；brief 构建跳过前缀；文档明示 |

## 7. 我的裁量（builder check 后更新）

- 暂停只允许"可 abort"的会话（busy 优先，失明时仍尝试 abort）
- 每会话单活跃 run；discard 允许 resumed-idle 兜底清理
- 简报 **abort 后**构建（取 settle 后的部分输出），预取仅用于确认 user 锚点
- 恢复用 fire-and-forget + 先落状态，HTTP 不被 pi 的阻塞语义拖住
- 恢复不重发原始 user 消息（避免重复副作用），只发续跑提示
- 暂停中公共 prompt 一律入队；内部 noReply 通知放行
- discard 清闸门后 flush 队列（不吞用户消息）
- 事件只加 `run.updated` 一条；TUI 本批不做 UI
