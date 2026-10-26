# Batch 4 — Durable Task 实体（Design）

> 日期：2026-10-26 · 状态：待实施
> 上游：Batch 3 的子代理 parent/depth；Batch 1 的 structured output；Batch 2 的 input_required 表单。

## 1. 意图与为什么

2.1 已有可查询的 background shell（`POST /api/shell` + `GET /api/shell/:id` + output cursor）和 background subagent，但 MAFW 没有**跨回合/跨重启的任务实体**：

- 现有的 desktop BackgroundDock 从 tool part/synthetic message 推导，只有本地状态；
- TUI/gateway 无法查询“这个长命令/子代理还在吗、结果在哪、能否取消”；
- gateway 重启后任务可见性丢失；
- 没有五态（working/input_required/completed/failed/cancelled）与统一 `task.*` 事件。

本批把 background shell + subagent 收编为 gateway 一等 `TaskEntity`，持久化到 `~/.mafw/tasks/*.json`，由 poller 维护状态并广播 `task.updated`；桌面 BackgroundDock 增加网关任务区。

## 2. 目标 / 非目标

**目标**

1. `TaskEntity`：id/kind(shell|subagent)/parentSessionID/childSessionID|shellID/title/status/createdAt/updatedAt/finishedAt/exitCode/error/directory。
2. 五态：`working | input_required | completed | failed | cancelled`。
3. API：`POST /api/tasks`（submit）、`GET /api/tasks`（list/filter）、`GET /api/tasks/:id`、`POST /api/tasks/:id/cancel`、`POST /api/tasks/:id/message`、`GET /api/tasks/:id/output?cursor=&limit=`。
4. 文件持久化 + gateway 启动 reconcile：shell 查 `/api/shell/:id`，subagent 查 session；缺失 → failed（`lost_after_restart`），终态保留。
5. Poller 2s：状态迁移时 emit canonical `task.updated`；subagent 有 pending question/permission → `input_required`。
6. 桌面：SDK tasks 命名空间 + preload；`task.updated` dispatcher；BackgroundDock 显示网关任务（状态/取消/结果入口）。
7. 工具面（可选最小）：`mafw_task_submit` / `mafw_task_list` / `mafw_task_cancel` / `mafw_task_message`，让 agent 自己不依赖 UI 也能用 durable task。

**非目标**

- 不替代 native `subagent`/shell 工具；任务是**可观测/可查询/可取消**的持久投影。
- 不做跨机器/云任务、不做 7 天恢复、不做任务依赖图。
- 不做 shell stdin 写入；只读 output cursor。
- 不做任务历史清理/压缩（保留全部 JSON；后续可加 retention）。
- 不改 2.1。

## 3. 2.1 实证

- `POST /api/shell {command,cwd?,timeout?,metadata?}`（location-scoped）→ `Shell.Info`；后台运行，输出落文件。
- `GET /api/shell/:id` → 含 status/exit；`GET /api/shell/:id/output?cursor=&limit=` → `{output,cursor,size,truncated}`。
- `DELETE /api/shell/:id` → 终止并移除。
- `POST /api/session/:sid/shell` 是同步执行（204 + shell.started/ended），**不是** durable shell；任务用 `/api/shell`。
- background subagent = child session + `turn.*`；Batch 3 已有 spawn/list/result。
- `POST /api/session/:sid/background` 把当前 blocking 工具转后台（UI 转后台入口，非任务创建）。

## 4. 设计

### 4.1 TaskEntity + 状态机

```ts
type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
interface TaskEntity {
  id: string; kind: 'shell'|'subagent';
  parentSessionID: string; childSessionID?: string; shellID?: string;
  title: string; status: TaskStatus;
  directory?: string; createdAt: number; updatedAt: number; finishedAt?: number;
  exitCode?: number; error?: string; metadata?: Record<string, unknown>;
}
```

迁移：
- shell: `running → working`；`exited && exit===0 → completed`；`exited && exit!==0 → failed`；`timeout → failed`；`killed → cancelled`；404 → failed(`lost_after_restart`)。
- subagent: no idle → working；pendingInput → input_required；idle + outcome succeeded → completed；failed → failed；interrupted → cancelled；session 404 → failed(lost)。
- cancel：shell DELETE / subagent abort → cancelled。
- 终态不再回退；input_required 可回到 working（pending 解决）。

### 4.2 `TaskService` + `TaskStore`

- `TaskStore`（`runtime/task-store.ts`）：`~/.mafw/tasks/<id>.json` 原子写（tmp+rename），loadAll 扫描；坏文件跳过。
- `TaskService`（`runtime/task-service.ts`）deps：
  - `shell`（adapter 新增可选 shellApi：create/get/output/remove）
  - `spawnSubagent`、`cancelSubagent`、`messageSubagent`、`getSession`、`pendingInput?`
  - `emit(task)`、`now?`
- `init()`：loadAll + 对 active 任务 reconcile；`start()` 2s interval（unref）；`dispose()`。
- `submit`：先分配 task id；shell 创建带 `metadata.taskID/parentSessionID`；subagent 用 Batch 3 spawn（background:true）。
- `get/list` 返回内存态；`output` 透传 shell output；`message` 只允许 subagent。
- 状态变化才写盘 + emit；poll 不刷事件。

### 4.3 事件 / API / SDK

- `MAFW.taskUpdated = 'task.updated'`；载荷 `{task}`；顶层 `sessionID = parentSessionID`。
- SDK `RUNTIME_EVENT_TYPES` 加 `task.updated`；desktop dispatcher 顶层 `tasks.onEvent(task)`。
- route-catalog + wave1 handlers + SDK `tasks` 命名空间（list/get/submit/cancel/message/output）；preload/main IPC。
- `task.updated` 由 gateway `broadcast` 发出，不经 runtime 事件表。

### 4.4 Shell adapter

`RuntimeClient.shell?`：
```ts
create({command,cwd?,timeout?,metadata?,directory?}): Promise<ShellInfo>
get({shellID,directory?}): Promise<ShellInfo>
output({shellID,directory?,cursor?,limit?}): Promise<{output,cursor,size,truncated}>
remove({shellID,directory?}): Promise<void>
```
opencode adapter 用 `directNative('/shell',...)` + `x-opencode-directory`；缺能力时 shell submit 503。

### 4.5 桌面

- `tasks` 命名空间 + `task-store.ts`（signal + ingest + fetch）。
- BackgroundDock 增加「网关任务」区块：kind/status/title/时间；working/input_required 显示取消；subagent 可跳 child；shell 可显示最近 output（按需）。
- `task.updated` 立即更新；mount/SSE reconnect fetch 全量；15s 兜底轮询（可选）。
- 保留现有本地 background rows（原生 subagent/shell 推导）作为 fallback，不删除。

### 4.6 工具（最小）

`mafw_task_submit`（kind/command|prompt/…）、`mafw_task_list`、`mafw_task_cancel`、`mafw_task_message`；父 session 从 ctx。用于 pi/TUI/agent；opencode 仍可直接用原生 background shell/subagent。

## 5. 失败模式 / 风险

- gateway 重启时 serve 也重启：shell 丢失 → failed(`lost_after_restart`)，不是假 working。
- 任务文件损坏：跳过并 warn；不阻塞启动。
- 并发 poll/取消：Map 单线程；cancel 先置 cancelled 再调用底层，底层失败保留 cancelled + error。
- 重复 task.id：时间戳+随机；写文件覆盖前检查。
- subagent pendingInput 查询失败：fail-open 保持 working。
- shell output 超出：cursor/size/truncated 透传；不整段读入内存。
- 任务 API 被非父会话调用：message/cancel 校验 parentSessionID；不信任 body。
- 旧 desktop 本地 rows 与网关任务重复：separate section，不合并去重（v1）。

## 6. 验收

1. `POST /api/tasks {kind:'shell', command:'echo task-ok'}` → working；2s 内 completed；output 含 task-ok。
2. `sleep 30` 任务 cancel → cancelled；shell 被终止。
3. `POST /api/tasks {kind:'subagent', prompt:'...'}` → child 任务；完成后 status completed；可用 Batch 3 result 取文本。
4. gateway 重启后 list 仍含终态任务；active 任务 reconcile 为真实状态或 failed(lost)。
5. `task.updated` 在 submit/终态/cancel 时到达桌面；BackgroundDock 显示并可取消。
6. 单测：store atomic/load、service 状态机/五态/reconcile/cancel/message/output、routes、SDK、dispatcher、task-store；全量不回归。
