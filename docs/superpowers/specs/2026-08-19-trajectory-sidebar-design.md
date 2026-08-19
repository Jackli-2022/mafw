# Agent 轨迹统计 + 桌面侧边栏（Trajectory Sidebar）设计

日期：2026-08-19
状态：待审查

## 1. 目标

在 gateway 端累积 opencode 的 agent 轨迹（回合分组 + 工具调用状态/耗时 + 推理段 + 模型/agent 切换 + 真实 tokens/cost），持久化到 SQLite，暴露 HTTP API；desktop 以右侧固定 dock（TaskList 同款）展示完整事件时间线，实时更新。

## 2. 背景事实（调研结论）

- 网关已通过 `subscribeToEvents()`（`gateway/src/index.ts:638`）订阅 opencode serve 的 `/global/event`，`handleOpencodeEvent()`（`index.ts:663`）收到全部事件后原样广播给桌面。
- 主事件源（opencode ≥1.18，已停发 `session.next.step.ended`）：
  - `message.part.updated` → ToolPart（`tool`、`callID`、`state: pending/running/completed/error`、`time.start/end`、input/output/error）+ StepFinishPart（`reason`、`cost`、`tokens{input,output,reasoning,cache}`）
  - `message.updated` → AssistantMessage（`tokens`、`cost`、`finish`、`modelID`、`providerID`）
  - `session.idle` → 回合边界
- v2 `session.next.reasoning.*` / `session.next.tool.*` 事件仍会发出（插件 hook `src/plugin.ts:203` 已在使用）。
- 桌面 `MafwShell.tsx` 已通过 EventSource 直连 `/api/events`，`store.part[msgId]` 持有全部 ToolPart 数据，但**没有聚合展示**；TaskBar 只显示最后一条 assistant 消息的 token 数（`taskMetrics`，`MafwShell.tsx:1437`）。
- 现有可复用模式：TaskList dock（`.mafw-tasklist-dock` fixed right 320px，`mafw.css:2117`）、Rail 的 `ResizeHandle` + localStorage 持久化（`MafwShell.tsx:1361`）。

## 3. 数据模型（网关）

统一数据库 `~/.mafw/memory/gateway.db`（`GatewayDatabase`）新增两张表：

### 3.1 `trajectory_events`（append-only 事件流水）

```sql
CREATE TABLE IF NOT EXISTS trajectory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL,            -- 网关回合号（对齐 t1_observations 语义）
  seq INTEGER NOT NULL,                -- 回合内事件序号
  event_type TEXT NOT NULL,            -- 'tool_start'|'tool_update'|'tool_end'|'reasoning_start'|'reasoning_end'|'agent_switch'|'model_switch'|'step_finish'|'turn_start'|'turn_end'|'text_start'|'text_end'
  tool_name TEXT,                      -- tool_start/update/end
  call_id TEXT,                        -- 工具调用 callID
  tool_state TEXT,                     -- 'running'|'completed'|'error' (tool_end)
  agent TEXT,                          -- agent_switch
  model TEXT,                          -- model_switch / step_finish
  input_summary TEXT,                  -- 工具输入摘要（截断 500 字符）
  output_summary TEXT,                 -- 工具输出摘要/错误（截断 500 字符）
  error TEXT,                          -- tool_end error
  tokens JSON,                         -- step_finish: {input,output,reasoning,cache:{read,write}}
  cost REAL,                           -- step_finish
  finish TEXT,                         -- step_finish: 'stop'|'tool-calls'|...
  time_ms REAL,                        -- 事件时间戳(ms, epoch)
  duration_ms REAL,                    -- tool_end/reasoning_end: 本次耗时
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_traj_evt_session ON trajectory_events (session_id, turn_id, seq);
CREATE INDEX idx_traj_evt_ttl ON trajectory_events (created_at);
```

### 3.2 `trajectory_turns`（回合聚合，`session.idle` 时 upsert）

```sql
CREATE TABLE IF NOT EXISTS trajectory_turns (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id INTEGER NOT NULL,
  turn_start_ms REAL NOT NULL,         -- 首事件时间
  turn_end_ms REAL,                    -- session.idle 时间
  duration_ms REAL,
  tool_count INTEGER DEFAULT 0,
  tool_error_count INTEGER DEFAULT 0,
  reasoning_count INTEGER DEFAULT 0,
  agent_switch_count INTEGER DEFAULT 0,
  tokens JSON,                         -- 回合累计 {input,output,reasoning,cache}
  cost REAL DEFAULT 0,
  finish TEXT,                         -- 回合结束原因
  model TEXT,                          -- 回合内最后模型
  agent TEXT,                          -- 回合内最后 agent
  user_text TEXT,                      -- 用户消息摘要（截断 300）
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, turn_id)
);
CREATE INDEX idx_traj_turn_ttl ON trajectory_turns (created_at);
```

### 3.3 数据流

`handleOpencodeEvent` → 新增 `TrajectoryStore`（`initServices` 注册）三个 hook 点。事件来自 GlobalEvent `{ directory, payload }`，**`project_id` 取 `evt.directory`**（index.ts:669 同源）。

1. `message.part.updated`：
   - ToolPart → `tool_start`（pending/running 去重，按 callID）/ `tool_end`（completed/error，写 duration_ms = time.end - time.start）
   - StepFinishPart → `step_finish`（tokens/cost/finish；**按 assistant messageID 去重**，同一 step 只写一次）
   - reasoning part → `reasoning_start` / `reasoning_end`（**按 part id 首末次出现判定**：reasoning part 无显式 end 信号，首见写 start、末见写 end 并计算 duration）
2. `message.updated`：
   - role=user → `turn_start`（分配 turn_id，写 user_text）
   - role=assistant → `model_switch`（modelID 变化时）+ **step_finish 兜底**：仅当该 assistant messageID 还没有 step_finish 事件时才写（防止与 hook 1 双重计数；`message.updated` 携带的是聚合后的消息级 tokens/cost，兜底场景下直接作为回合汇总）
3. `session.idle` → `turn_end` + `trajectory_turns` upsert（聚合 tokens/cost/tool_count/duration）

要点：
- turn_id 复用现有 `GatewayDatabase.nextTurnId` 分配机制，与 t1_observations 不冲突（同 max+1 算法）
- **turn_start 缺失兜底**：`session.idle` 到达时若无进行中 turn（网关中途订阅/事件丢失），用 `currentTurnId` 隐式开新回合再收尾
- seq 保证回合内时间线顺序
- 所有写入走 `GatewayDatabase` 单连接（WAL）
- 写失败 try/catch 日志，**不影响 `handleOpencodeEvent` 主流程**（轨迹是增强数据）

## 4. 网关 API

```
GET /api/sessions/{id}/trajectory?limit=50&before_turn=123&rebuild=1
→ { turns: TrajectoryTurn[], events: TrajectoryEvent[] }
```

- 默认返回最近 `limit`（默认 50）回合 + 这些回合的全部事件（按 `(turn_id, seq)` 升序）
- `before_turn`：向前翻页（老回合）
- `rebuild=1`：轨迹为空时，从 `GET /api/sessions/{id}/messages` 历史重建（ToolPart → tool 事件、StepFinishPart → step_finish；reasoning/model 切换不可恢复则跳过）；只对**网关启动前**的旧会话需要
- 404/会话不存在 → `{turns: [], events: []}`（fail-open，与 `/api/recall/context` 一致）
- 路由正则遵循 AGENTS.md §6.5（`(?:\?|$)` 锚定）
- 会话删除 `DELETE /api/session/{id}` → 联动删除该 session 轨迹行

### 实时推送（复用全局通道）

`handleOpencodeEvent` 各 hook 点写 SQLite 后同步 `broadcast()` 新增归一化事件：

```
{ type: 'opencode_event', data: { type: 'trajectory.event', properties: TrajectoryEvent, sessionID } }
```

- 不新建 SSE 通道；桌面 EventSource 已连 `/api/events`，按 `type === 'trajectory.event'` 过滤 + `sessionID` 路由
- 现有 `session.idle` → `message.complete` 归一化不变

### TTL 清理

每次写轨迹行时顺带 `DELETE FROM trajectory_* WHERE created_at < now() - 14d`（幂等批量）。

### API 返回类型（gateway-sdk 暴露）

```ts
interface TrajectoryTurn {
  turn_id: number; turn_start_ms: number; turn_end_ms: number | null;
  duration_ms: number; tool_count: number; tool_error_count: number;
  reasoning_count: number; agent_switch_count: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  cost: number; finish: string | null; model: string | null; agent: string | null;
  user_text: string;
}
interface TrajectoryEvent {
  seq: number; turn_id: number; event_type: string;
  tool_name?: string; call_id?: string; tool_state?: 'running'|'completed'|'error';
  agent?: string; model?: string;
  input_summary?: string; output_summary?: string; error?: string;
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  cost?: number; finish?: string;
  time_ms: number; duration_ms?: number;
}
```

新模块：`gateway/src/trajectory/trajectory-store.ts`、`trajectory-api.ts`（与 memory/ 平行）。

## 5. 桌面 UI（TaskList dock 模式）

### 5.1 形态

- **统一右侧 dock 容器** `.mafw-right-dock`（新增，替换独立 TaskList dock 与轨迹 dock 的分裂）：`position: fixed; top: 38px; right: 0; bottom: 0; width: 320px`（默认），`border-left: 1px solid var(--border-subtle)`、`background: var(--bg-base)`、`z-index: 70`——样式延续 `.mafw-tasklist-dock`（`mafw.css:2117`），不挤压聊天列
- dock 顶部为 **tab 栏**（`TabsV2` 或同款 tab strip）：`📋 任务` / `📊 轨迹` 两个 tab，点 tab 切换 dock 内容；**同一时刻只有一个 dock 容器，内部 tab 切换内容**（类似 chat 的 TabStrip 语义）
- 宽度可调：dock 左缘加 `ResizeHandle direction="horizontal" edge="start"`（**注意：宽度调整必须用 `horizontal`**——该组件 X 轴是 col-resize 宽度，`vertical` 是 Y 轴 row-resize 高度；Rail 先例 `MafwShell.tsx:1526` 即 `horizontal`），min 280 / max 420，localStorage `mafw-right-dock-width`
- 折叠：dock 整体关闭后完全隐藏（无 Rail 式 32px 抓手；通过 titlebar 按钮/Ctrl+T 恢复）；折叠时记住当前 tab，重开回到该 tab

### 5.2 切换

- 每个 ChatPane titlebar（`mafw-session-titlebar-inner`，`ChatPane.tsx:1312`）新增**两个按钮**（`ButtonV2 ghost size=small` + `TooltipV2 openDelay={300}`），位于现有 TaskBar 之后：
  1. `📋 任务` → 打开统一 dock 并切到「任务」tab（等价现有 TaskList dock）
  2. `📊 轨迹` → 打开统一 dock 并切到「轨迹」tab
  - 再次点击当前 tab 的按钮 → 关闭 dock；点击另一 tab 按钮 → dock 保持打开、仅切 tab
- `Ctrl/Cmd+T` 快捷键 toggle dock（切到上次 tab，仿 Ctrl+J，`MafwShell.tsx:1398`；跳过 INPUT/TEXTAREA）
- 窄视口（<1200px）自动降级 overlay（Esc/点外关闭，仿 TaskList dock，`MafwShell.tsx:1380`）
- state + localStorage：`mafw-right-dock-open` / `mafw-right-dock-tab` / `mafw-right-dock-width`

### 5.3 内容

dock 内按当前 tab 渲染两个内容组件（新组件 `RightDock.tsx` 容器 + `TrajectoryDock.tsx` / `TaskList` 复用）：

- **tab 栏**（dock 顶部）：`📋 任务` / `📊 轨迹`（`ButtonV2` 或 `TabsV2`，当前 tab 高亮）
- **任务 tab**：复用现有 `TaskList`（`placement="dock"`，props 不变：todos/tokens/started/onClose/onPin）——**不破坏现有 TaskList dock 行为**；`tasksPlacement` 的 `"bar"`（titlebar 内联 TaskBar 进度条）保留不变，`"dock"` 语义改为"统一 dock 的 tab=任务"
- **轨迹 tab**（`TrajectoryDock.tsx`）：
  - header：`回合 {n} · 工具 {m}` 小统计 + 刷新按钮（ButtonV2 ghost）
  - 主体：**回合列表**（TrajectoryTurn 数据）
    - 每回合可展开行：`user_text 摘要` + KPI 行（工具次数、耗时、tokens、cost、finish 徽标）
    - 展开 → 该回合**事件时间线**（TrajectoryEvent，按 seq）：
      - tool：图标 + 工具名 + 状态（✓/✗/⟳）+ 耗时 ms + input/output_summary 可展开
      - reasoning：🧠 推理 + 耗时 + 可展开文本
      - model/agent 切换：`模型 → xxx` / `Agent: xxx` 分隔条
      - step_finish：回合 tokens/cost 汇总行
    - 当前进行中回合："运行中"脉冲点 + 实时追加
  - 空态："暂无轨迹数据" + 提示
  - 拉取失败：`无法加载轨迹` + 重试按钮（ButtonV2），不阻塞聊天区

### 5.4 数据接入

- 拉取：`window.api.mafw.sessions.trajectory(sessionID)`（新增 gateway-sdk 方法 + IPC 通道）
- 实时：现有 EventSource `onmessage` 加 `type === 'trajectory.event'` 分支 → 按 sessionID upsert 到 dock 本地 store（`createStore`，**不放进全局 store**，避免污染 SessionTurn 渲染）
- 会话切换：`currentSessionID` 变化 → 重新拉取；dock 显示当前 pane 会话
- 滚动到顶 → `before_turn` 分页拉老回合（复用 ChatPane.loadOlder 模式）

### 5.5 样式约定

- 全 `mafw-*` 类 + theme tokens；数字 `font-variant-numeric: tabular-nums`
- 无裸 button/input/title；一律 `ButtonV2`/`TooltipV2`（openDelay 300）

## 6. 错误处理与恢复

| 场景 | 行为 |
|---|---|
| 网关写轨迹失败 | try/catch 日志，不阻塞聊天主流程 |
| serve 重启/事件流断开 | 现有 watchdog 重连；丢失窗口期事件不补（桌面拉历史重建） |
| 桌面拉取失败/网关不可达 | dock 显示错误 + 重试按钮 |
| 会话删除 | 联动删除轨迹行 |
| TTL | 写时顺带清理 14 天前数据 |
| 网关重启 | 轨迹已在 SQLite，桌面重连直接恢复 |
| 网关启动前的旧会话 | 首拉取轨迹为空 → `?rebuild=1` 从历史消息重建 |

## 7. 测试

- 网关单测（`tests/unit/gateway/`）：
  - `trajectory-store.test.ts`：事件写入 → turn 聚合正确（tokens/cost/耗时/tool_count）；TTL 清理；会话删除联动；幂等 upsert
  - `trajectory-api.test.ts`：endpoint 分页（limit/before_turn）、404 fail-open、rebuild=1 从 mock messages 重建
  - `trajectory-from-events.test.ts`：喂模拟 `message.part.updated`（ToolPart/StepFinishPart）/`session.idle` 事件序列 → 验证时间线顺序、turn_id 分配、seq
- 桌面：`TrajectoryDock` 纯函数（格式化耗时/tokens、事件分组）单测
- 手动验证：真实会话 → dock 显示回合+工具+推理+模型切换；刷新/重启 gateway 后轨迹仍在；滚动翻页

## 8. 落地顺序

1. M1 网关：`TrajectoryStore` + 表结构 + 事件 hook 累积 + turn 聚合
2. M2 网关：API endpoint（list + rebuild）+ TTL 清理 + 会话删除联动
3. M3 SDK/IPC：`sessions.trajectory()` 类型 + IPC 通道
4. M4 桌面：TrajectoryDock + 标题栏按钮 + Ctrl+T + EventSource 分支 + 分页
5. M5 测试 + 手动验证
