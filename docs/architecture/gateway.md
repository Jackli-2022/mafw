# MAFW Gateway 架构

> 常驻进程，负责事件驱动调度、LangGraph 循环编排、Session 管理、Dashboard 服务、SSE 推送。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [CLI 二进制设计](#cli-二进制设计)
- [核心架构：事件驱动 + LangGraph](#核心架构事件驱动--langgraph)
- [MafwScheduler 详细设计](#mafwscheduler-详细设计)
- [DashboardServer 详细设计](#dashboardserver-详细设计)
- [DashboardAPI 详细设计](#dashboardapi-详细设计)
- [API 端点完整列表](#api-端点完整列表)
- [数据流全景](#数据流全景)
- [配置与命令行](#配置与命令行)

---

## 代码位置

```
gateway/
├── bin/
│   └── mafw-gateway.js          # CLI 入口（进程管理）
├── src/
│   ├── index.ts                 # MafwScheduler — 主调度器 (~900 行)
│   │
│   ├── dashboard/
│   │   ├── server.ts            # HTTP + SSE 服务器 (~140 行)
│   │   ├── api.ts               # REST API 处理器 (~1100 行)
│   │   ├── types.ts             # SchedulerState 接口
│   │   └── public/
│   │       ├── index.html       # SPA 入口
│   │       └── app.js           # SPA 逻辑
│   │
│   ├── dist/
│   ├── package.json
│   └── tsconfig.json
│
src/langgraph/                    ← LangGraph 编排层（Plugin 源码目录）
├── graph.ts                     # StateGraph 定义 + retryPolicy
├── loop-state.ts                # LoopState 元数据模型
├── nodes/
│   ├── plan.node.ts             # Plan Agent 节点（interrupt）
│   ├── execute.node.ts          # Execute Agent 节点（interrupt）
│   ├── review.node.ts           # Review Agent 节点（interrupt）
│   └── archive.node.ts          # 归档节点
├── checkpointer.ts              # FileCheckpointer（文件持久化 Checkpointer）
└── index.ts
```

---

## 生命周期

### Gateway 进程生命周期

```
npx mafw-gateway start
    │
    ▼
1. CLI (bin/mafw-gateway.js)
    spawn(gateway/dist/index.js)
    │
    ▼
2. MafwScheduler.start()
    ├── startServe()
    │     spawn(opencode serve --port 4096)
    │
    ├── initClient()
    │     const client = createOpencodeClient({ port: 4096 })
    │
    ├── subscribeToEvents()
    │     client.event.subscribe() → SSE 广播（仅 Dashboard 展示）
    │
    ├── startApiServer()
    │     HTTP API on port 3000
    │
    ├── dashboard.start()
    │     Dashboard HTTP + SSE on port 3001
    │
    ├── recoverState()
    │     读 state/{goalId}.json → activeGoals Map
    │
    └── startBackupPolling()
          30s 间隔 → discoverNewGoals() + resumeStaleThreads()
```

### Loop 生命周期（LangGraph 编排）

```
POST /api/work/{goalId}/validate
  → handleValidate()
    → 写入 state/{goalId}.json (nextAction: 'GRAPH_INVOKED')
    → onGoalCreated(goalId, projectDir, mafwDir)
      → buildExecutionGraph()
      → FileCheckpointer(mafwDir)
      → graph.invoke(initialState, { thread_id: goalId, checkpointer })

LangGraph 内部:
  start → plan_node
    ├── syncToFile({ phase: 'PLANNING' })
    ├── session = createSession(projectDir)
    ├── sendPrompt(session.id, '/skill mafw-plan {goalId}')
    ├── interrupt('awaiting_plan')           ← Plugin 异步执行
    │     Gateway 收到 POST /api/events
    │     → onEvent(goalId)
    │       → graph.invoke(new Command({}))
    │       → interrupt 恢复 → 继续
    ├── check waves.json
    ├── destroySession(session.id)
    └── syncToFile({ phase: 'PLANNING_COMPLETE' })
    │
    ├── execute_node (同上模式)
    ├── review_node (同上模式)
    │
    └── routeAfterReview(state)
          ├── PASS            → archive_success → END
          ├── ERROR           → archive_fail    → END
          ├── FAIL + 未超限   → plan_node       → 重试 Loop
          └── FAIL + 已超限   → archive_max_retries → END
```

---

## CLI 二进制设计

**文件**：`bin/mafw-gateway.js`（~300 行）

| 命令 | 描述 |
|---|---|
| `start` | 前台启动 |
| `daemon` | 后台守护 |
| `stop` | kill PID |
| `status` | 检查 PID 存活 |
| `restart` | 重启 |
| `dashboard` | 打开浏览器 |
| `logs` | tail 日志 |
| `config` | 显示配置 |
| `service-register` | 系统服务注册 |
| `service-unregister` | 系统服务卸载 |

---

## 核心架构：事件驱动 + LangGraph

### 设计原则

Gateway 不做「业务判断」——所有路由决策委托给 LangGraph 的 `routeAfterReview()` 纯函数。

```
Plugin 写完 state.json
  → POST /api/events → onEvent(goalId)
    → FileCheckpointer 读取最新 checkpoint
    → graph.invoke(new Command({}), { thread_id: goalId, checkpointer })
      （LangGraph 从 interrupt 点恢复，自动决定下一步）
    → syncFromCheckpoint() 写回 state.json（Dashboard 兼容）
```

### 与旧架构的关键区别

| 方面 | 旧架构 | 当前架构 |
|------|--------|---------|
| **调度方式** | 5s 轮询 state.json + switch-case | 事件驱动 POST /api/events |
| **状态管理** | 手写 `dispatchSession`/`routeNextStep` | LangGraph `routeAfterReview` 纯函数 |
| **等待机制** | `WAIT_PHASE_COMPLETE` + `startSessionMonitor` | `interrupt()` + LangGraph 原生挂起 |
| **超时控制** | `setTimeout(10min)` 手动 destroySession | `retryPolicy: { maxAttempts: 2 }` |
| **并行 Wave** | 手写 wave 并行逻辑 | Pregel 自动 fan-out |
| **持久化** | `state.json` | `state.json`（视图）+ `FileCheckpointer`（checkpoint） |
| **崩溃恢复** | `recoverState()` + 轮询 | `recoverState()` + `resumeStaleThreads()` |

---

## MafwScheduler 详细设计

**文件**：`gateway/src/index.ts`（~900 行）

### 类结构

```typescript
class MafwScheduler {
  private serveProcess?: ChildProcess;
  private opencodeClient: any;             // @opencode-ai/sdk 客户端
  activeGoals = new Map<string, StateFile>();
  registeredProjects = new Map<string, RegisteredProject>();
  private sseClients: Set<http.ServerResponse>;
}
```

### 启动流程

```
start()
├── startServe()
│     spawn(opencode serve --port 4096)
│
├── initClient()
│     import { createOpencodeClient } from '@opencode-ai/sdk'
│
├── subscribeToEvents()
│     client.event.subscribe({}) → 转发到 SSE（仅展示）
│
├── startApiServer()
│     HTTP 端口 3000
│     ├── POST /register          → 项目注册
│     ├── POST /control           → PAUSE/ABORT/FORCE_PHASE
│     ├── POST /api/work/{id}/validate  → handleValidate → onGoalCreated
│     ├── POST /api/work/{id}/complete  → handleComplete → onEvent
│     ├── GET  /health            → 健康检查
│     ├── POST /api/events        → 状态变更回调 → onEvent
│     └── GET  /api/events        → SSE 流
│
├── dashboard.start()
│     Dashboard 端口 3001
│
├── recoverState()
│     扫描 state/{goalId}.json → activeGoals
│
└── startBackupPolling()
      30s → discoverNewGoals() + resumeStaleThreads()
```

### 核心方法

| 方法 | 行数 | 作用 |
|------|------|------|
| `onGoalCreated(goalId, projectDir, mafwDir)` | ~15 | `graph.invoke(initialState)` 启动新 goal 的 LangGraph |
| `onEvent(goalId)` | ~15 | `graph.invoke(new Command({}))` 恢复中断的节点 |
| `buildNodeOptions(mafwDir)` | ~60 | 包装 SDK 工具函数传入 LangGraph 节点 |
| `syncFromCheckpoint(goalId, cp)` | ~10 | 读 checkpoint → 写 state.json |
| `resumeStaleThreads()` | ~20 | 遍历 checkpoint 目录恢复卡死线程 |
| `createSession(projectDir)` | ~10 | SDK session.create() |
| `sendPrompt(sessionId, message)` | ~5 | SDK session.promptAsync() |
| `destroySession(sessionId)` | ~10 | SDK session.delete() |
| `archiveGoal(goalId)` | ~35 | Git tag 归档 + 状态更新 |
| `patchState(goalId, patch)` | ~35 | 原子写入 state.json + SSE 广播 |
| `handleValidate(goalId, data)` | ~45 | 初始化 state + 触发 onGoalCreated |
| `handleComplete(goalId, data)` | ~5 | 触发 onEvent |

### LangGraph 图结构

```typescript
const workflow = new StateGraph(LoopState)
  .addNode("plan", planFn, { retryPolicy: { maxAttempts: 2 } })
  .addNode("execute", executeFn, { retryPolicy: { maxAttempts: 2 } })
  .addNode("review", reviewFn, { retryPolicy: { maxAttempts: 2 } })
  .addNode("archive_success", archiveSuccessFn)
  .addNode("archive_fail", archiveFailFn)
  .addNode("archive_max_retries", archiveMaxRetriesFn)

  .addEdge("__start__", "plan")
  .addEdge("plan", "execute")
  .addEdge("execute", "review")
  .addConditionalEdges("review", routeAfterReview, {
    plan: "plan",
    archive_success: "archive_success",
    archive_fail: "archive_fail",
    archive_max_retries: "archive_max_retries",
  })
  .addEdge("archive_success", END)
  .addEdge("archive_fail", END)
  .addEdge("archive_max_retries", END);
```

### 节点模式（interrupt）

每个 Agent 节点遵循相同模式：

```typescript
async function planNode(state, options) {
  syncToFile({ phase: 'PLANNING' });

  const session = await createSession(projectDir);
  await sendPrompt(session.id, `/skill mafw-plan ${goalId}`);

  interrupt('awaiting_plan');       // 挂起，等待 Plugin 完成

  // Gateway 收到事件 → onEvent → graph.resume → 从这里继续
  if (!fs.existsSync(wavesPath)) {
    return { lastError: 'waves.json not found', reviewVerdict: 'ERROR' };
  }
  await destroySession(session.id);
  syncToFile({ phase: 'PLANNING_COMPLETE' });
  return { wavePlanPath: wavesPath };
}
```

### FileCheckpointer

LangGraph 要求持久化 Checkpointer 来支持 interrupt/resume。

```
.opencode/mafw/checkpoints/{goalId}/
├── step_0000001.json       ← 节点执行后 checkpoint
├── step_0000002.json       ← interrupt 点
└── metadata.json           ← 当前 step/retries/error
```

实现继承 `BaseCheckpointSaver`，提供 `get()`, `put()`, `list()` 方法。

### 崩溃恢复（resumeStaleThreads）

```
Gateway 重启
  → recoverState() 加载 activeGoals
  → startBackupPolling() 30s 后
    → resumeStaleThreads()
      → 遍历 .opencode/mafw/checkpoints/{threadId}/
      → 若 activeGoals 中没有 → onEvent(threadId) 恢复执行
```

---

## DashboardServer 详细设计

**文件**：`gateway/src/dashboard/server.ts`（~140 行）

### 路由

```
/api/events?stream=true   GET     SSE 事件流（EventSource 连接）
/api/*                    ALL    DashboardAPI 处理
/ 或静态文件               GET    SPA 或静态资源
```

### SSE 广播

```typescript
broadcast(event): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of this.sseClients) {
    try { client.write(data); } catch { this.sseClients.delete(client); }
  }
}
```

---

## DashboardAPI 详细设计

**文件**：`gateway/src/dashboard/api.ts`（~1100 行）

### 双路径模式

| 路径 | 数据源 | 场景 |
|------|--------|------|
| 运行时 | `scheduler.activeGoals` Map | 快速、API 端口 3000 |
| 文件系统 | `.opencode/mafw/` 目录 JSON | 完整、Dashboard 端口 3001 |

### 关键端点

| 端点 | 说明 |
|------|------|
| `GET /api/goals` | 所有 goal 状态 |
| `GET /api/goals/:id` | 单 goal 详情 |
| `GET /api/goals/:id/loops` | Loop 历史 |
| `GET /api/stats` | 聚合统计 |
| `GET /api/memory/:goalId` | 谐波记忆读取 |
| `POST /api/llm/compress` | LLM 压缩代理 |
| `POST /api/gateway/pause` | 暂停 Goal |
| `POST /api/gateway/resume` | 恢复 Goal |

---

## API 端点完整列表

### Gateway HTTP API（端口 3000）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/register` | POST | 项目注册 |
| `/control` | POST | PAUSE/ABORT/FORCE_PHASE |
| `/api/work/{goalId}/validate` | POST | 创建 goal → 启动 LangGraph |
| `/api/work/{goalId}/complete` | POST | 通知 phase 完成 → onEvent |
| `/health` | GET | 健康检查 |
| `/api/events` | POST | 状态变更回调 → onEvent |
| `/api/events` | GET | SSE 流（Dashboard） |

### Dashboard API（端口 3001）

（同上表，详见 dashboard/api.ts）

---

## 数据流全景

### Goal 从创建到完成

```
用户 /goal "设计登录系统"
  │
  ▼
Plugin mafw-goal → 写入 state/{id}.json
  → POST /api/work/{id}/validate
  │
  ▼
Gateway handleValidate()
  → 写入 state.json (nextAction: GRAPH_INVOKED)
  → onGoalCreated(id, projectDir, mafwDir)
    → graph.invoke(initialState, { thread_id: id, checkpointer })
  │
  ▼
LangGraph: plan ⟶ execute ⟶ review ⟶ (条件路由)
  │ 各节点内: createSession → sendPrompt → interrupt
  │  Plugin 完成 → POST /api/events → onEvent → graph.invoke(new Command({}))
  │
  ▼
routeAfterReview → PASS? archive_success → END
                 → FAIL? 未超限? plan → 重试
                 → FAIL? 超限? archive_fail → END
```

### 事件驱动流

```
Plugin updateState() / transitionPhase()
  ├── 原子写入 state/{id}.json
  └── POST /api/events → Gateway
                           ├── broadcast() → Dashboard SSE
                           └── onEvent(goalId)
                               → graph.invoke(new Command({}))
                               → syncFromCheckpoint() → state.json 更新
```

### 文件系统布局

```
.opencode/mafw/
├── state/{goalId}.json              ← 状态（Dashboard 只读视图）
├── memory/
│   ├── tier2.json                   ← Episodic 记忆
│   ├── tier3.json                   ← Semantic 记忆
│   ├── tier4.json                   ← Procedural 记忆
│   ├── .harmonic_index.json         ← 检索索引
│   └── .cognitive_graph.json        ← 联想图谱
├── checkpoints/{goalId}/
│   ├── step_0000001.json            ← LangGraph checkpoint
│   └── metadata.json
├── goals/{goalId}.md                ← Goal Charter
├── requests/{goalId}.json           ← 请求配置
├── waves.json                       ← Wave 计划
├── tasks/{taskId}.md                ← Task 定义
├── receipts/{goalId}/               ← 执行收据
├── reviews/{goalId}-loop{N}.md      ← Review 报告
├── cost/{goalId}.json               ← 成本记录
└── user-questions/{goalId}/         ← 用户问题
```

### LangGraph 节点详细流

```
plan_node:
  syncToFile({ phase: 'PLANNING' })
  session = createSession(projectDir)
  sendPrompt(session.id, '/skill mafw-plan {goalId}')
  interrupt('awaiting_plan')
  // Gateway 收到事件 → resume
  read waves.json → 验证 JSON
  destroySession(session.id)
  syncToFile({ phase: 'PLANNING_COMPLETE', wavePlanPath })

execute_node:
  syncToFile({ phase: 'EXECUTING' })
  session = createSession(projectDir)
  sendPrompt(session.id, '/skill mafw-execute {goalId}')
  interrupt('awaiting_execution')
  // Gateway 收到事件 → resume
  read receipts/{goalId}/loop-receipt.json
  destroySession(session.id)
  syncToFile({ phase: 'EXECUTING_COMPLETE', receiptPath })

review_node:
  syncToFile({ phase: 'REVIEWING' })
  session = createSession(projectDir)
  sendPrompt(session.id, '/skill mafw-review {goalId}')
  interrupt('awaiting_review')
  // Gateway 收到事件 → resume
  read reviews/{goalId}-loop{N}.md → parse verdict
  destroySession(session.id)
  syncToFile({ phase: 'REVIEWING_COMPLETE', verdict })
```

---

## 配置与命令行

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MAFW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway API 地址 |
| `MAFW_LLM_API_KEY` | — | LLM 压缩 API Key |
| `PORT` | 3000 | HTTP API 端口 |
| `DASHBOARD_PORT` | 3001 | Dashboard 端口 |

### 目录结构

```
~/.config/mafw/
├── gateway.pid
├── logs/
│   └── gateway.log
├── config.json
└── projects.json
```

### 跨平台服务注册

| 平台 | 机制 | 文件位置 |
|---|---|---|
| Windows | schtasks | 任务计划程序 |
| macOS | LaunchAgent | `~/Library/LaunchAgents/` |
| Linux | systemd | `~/.config/systemd/user/` |
