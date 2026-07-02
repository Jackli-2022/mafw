# MAFW Gateway 架构

> 常驻进程，负责 Phase 调度、Session 管理、Dashboard 服务、SSE 事件推送。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [核心组件](#核心组件)
- [API 端点](#api-端点)
- [数据流](#数据流)
- [配置](#配置)

## 代码位置

```
gateway/
├── src/
│   ├── index.ts              # MafwScheduler — 主调度器
│   ├── recovery.ts           # RecoveryManager — Checkpoint 保存/恢复
│   ├── session-manager.ts    # Session 生命周期管理
│   ├── dashboard/
│   │   ├── server.ts         # HTTP + SSE 服务器
│   │   ├── api.ts            # REST API 处理器（DashboardAPI）
│   │   ├── types.ts          # SchedulerState 接口
│   │   └── public/
│   │       ├── index.html    # SPA 入口（7 视图）
│   │       └── app.js        # SPA 逻辑
│   ├── health.ts             # 健康检查
│   ├── heartbeat.ts          # Agent 心跳
│   ├── poll.ts               # 状态轮询
│   ├── loop-monitor.ts       # Loop 监控
│   └── ledger.ts             # 操作日志
└── package.json
```

## 生命周期

```
启动 → 注册已安装项目 → 轮询状态文件
    → 发现 nextAction → 创建 Session → 等待完成
    → 状态变更 → SSE 广播 → Dashboard 更新
```

```
Gateway CLI
    │
    ▼
MafwScheduler.start()
    │
    ├── DashboardServer.start()      ← HTTP :3000 + SSE
    ├── registerProjects()           ← 扫描已安装 Plugin 的项目
    ├── pollLoop()                   ← 每 5s 轮询状态文件
    │
    ▼
发现 goal-xxx: nextAction = 'CREATE_EXECUTE_SESSION'
    │
    ├── SessionManager.createSession(goalId) → opencode serve session
    ├── 等待 session.destroyed
    ├── updateState(phase, nextAction)
    │
    ▼
状态文件更新 → Dashboard SSE → 用户可见
```

## 核心组件

### MafwScheduler (`index.ts`)

主调度器，管理所有 Goal 的生命周期：

```typescript
class MafwScheduler {
  activeGoals: Map<string, GoalState>;    // 运行中的 Goal
  serveProcess: ChildProcess | null;       // opencode serve 进程
  registeredProjects: Set<string>;         // 已注册的项目
  pollInterval: NodeJS.Timeout | null;     // 轮询定时器
}
```

核心方法：
- `start()` — 启动 HTTP + Dashboard + 轮询
- `stop()` — 停止所有服务
- `startNextLoop(goalId)` — 触发下一 Loop
- `archiveGoal(goalId)` — 完成/归档 Goal
- `recoverAll()` — 崩溃后恢复

### DashboardServer (`dashboard/server.ts`)

HTTP + SSE 服务器：

```typescript
class DashboardServer {
  port: number;                    // 默认 3000
  sseClients: Set<Response>;       // EventSource 连接池
  api: DashboardAPI;               // REST API 处理器
}
```

- 静态文件服务（`public/` 目录）
- API 路由代理到 `DashboardAPI.handle()`
- SSE 端点 `/api/events?stream=true`
- SPA fallback（非 API/文件路由 → index.html）

### DashboardAPI (`dashboard/api.ts`)

REST API 处理器，支持运行时数据（内存）和文件系统回退：

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/goals` | GET | 列出所有 Goal |
| `/api/goals/:id` | GET | Goal 详情 |
| `/api/goals/:id/loops` | GET | Loop 列表 |
| `/api/goals/:id/loops/:loop` | GET | Loop 回放 |
| `/api/sessions` | GET | Session 列表 |
| `/api/sessions/:id/metrics` | GET | Session 指标 |
| `/api/stats` | GET | 聚合统计 |
| `/api/memory/:goalId` | GET | 记忆浏览 |
| `/api/memory/:goalId/:tier` | GET | 指定层级记忆 |
| `/api/memory/search` | GET | 记忆搜索 |
| `/api/memory/energy-distribution` | GET | 能量分布 |
| `/api/costs/:goalId` | GET | Goal 成本（v6.0） |
| `/api/costs/summary` | GET | 成本汇总（v6.0） |
| `/api/feedback` | GET | 反馈列表（v6.0） |
| `/api/feedback` | POST | 记录反馈（v6.0） |
| `/api/user-answers/:id` | POST | 用户回答（v6.0） |

### RecoveryManager (`recovery.ts`)

Checkpoint 保存/恢复：

```typescript
class RecoveryManager {
  saveCheckpoint(goalId, loop, data, waveNum?)  → void
  findLastCheckpoint(goalId)                     → string | null
  loadCheckpoint(path)                            → any
  restoreLoop(goalId, loop, targetWaveNum?)       → boolean
  recoverAll(callback)                            → void
}
```

Checkpoint 存储路径：
```
.opencode/mafw/checkpoints/{goalId}/
├── loop-{loop}.json              ← Loop 级快照
└── wave-{loop}-{waveNum}.json    ← Wave 级快照（v6.0）
```

## API 端点

详细端点列表见 DashboardAPI 表格。所有 API 端点在 `DashboardAPI.handle()` 中注册，路径匹配模式：

```typescript
// 精确路径
if (pathname === '/api/health' && method === 'GET') { ... }

// 正则路径参数
const goalMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
```

## 数据流

```
Plugin (Tool Call)
    │
    ├── POST /api/events ─────────────── Gateway
    │                                       │
    │                                       ├── SSE push → Dashboard
    │                                       │
    │                                       ├── Scheduler 发现 nextAction
    │                                       │
    │                                       └── SessionManager 创建 Session
    │
    └── 写入 .opencode/mafw/state/{goalId}.json
                │
                ├── Gateway 轮询读取
                ├── Dashboard API 读取（文件回退）
                └── Recovery 读取（Checkpoint 恢复）
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MAFW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway API 地址 |
| `PORT` | 3000 | HTTP 端口 |
| `DASHBOARD_PORT` | 3000 | Dashboard 端口（同 HTTP） |

### 命令行

```bash
npx mafw-gateway start               # 前台
npx mafw-gateway daemon              # 后台守护
npx mafw-gateway stop                # 停止
npx mafw-gateway status              # 状态
npx mafw-gateway logs                # 日志
npx mafw-gateway service-register    # 系统服务注册
npx mafw-gateway service-unregister  # 系统服务卸载
```

### 跨平台服务注册

| 平台 | 机制 |
|---|---|
| Windows | schtasks（任务计划程序） |
| macOS | launchctl（LaunchDaemon） |
| Linux | systemd（systemctl） |
