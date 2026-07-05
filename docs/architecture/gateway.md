# MAFW Gateway 架构

> 常驻进程，负责 Phase 调度、Session 管理、Dashboard 服务、SSE 事件推送、LLM 代理。

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
│   │       ├── index.html    # SPA 入口（8 视图）
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
Gateway CLI
    │
    ▼
MafwScheduler.start()
    │
    ├── DashboardServer.start()      ← HTTP :3001 + SSE
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
  activeGoals: Map<string, GoalState>;
  serveProcess: ChildProcess | null;
  registeredProjects: Set<string>;
  pollInterval: NodeJS.Timeout | null;
}
```

核心方法：
- `start()` — 启动 HTTP + Dashboard + 轮询
- `stop()` — 停止所有服务
- `startNextLoop(goalId)` — 触发下一 Loop
- `archiveGoal(goalId)` — 完成/归档 Goal
- `recoverAll()` — 崩溃后恢复

### DashboardServer (`dashboard/server.ts`)

HTTP + SSE 服务器，端口 3001：

- 静态文件服务（`public/` 目录）
- API 路由代理到 `DashboardAPI.handle()`
- SSE 端点 `/api/events?stream=true`
- SPA fallback（非 API/文件路由 → index.html）

### DashboardAPI (`dashboard/api.ts`)

REST API 处理器，支持运行时（SchedulerState 内存）和文件系统回退：

| 端点 | 方法 | 用途 | 版本 |
|---|---|---|---|
| `/api/health` | GET | 健康检查 | v5.0 |
| `/api/goals` | GET | 列出所有 Goal | v5.0 |
| `/api/goals/:id` | GET | Goal 详情 | v5.0 |
| `/api/goals/:id/loops` | GET | Loop 列表 | v5.0 |
| `/api/goals/:id/loops/:loop` | GET | Loop 回放 | v5.0 |
| `/api/sessions` | GET | Session 列表 | v5.0 |
| `/api/sessions/:id/metrics` | GET | Session 指标 | v5.0 |
| `/api/stats` | GET | 聚合统计 | v5.0 |
| `/api/memory/:goalId` | GET | 谐波记忆浏览 | v6.3 |
| `/api/memory/:goalId/:tier` | GET | 指定层级记忆 | v5.0 |
| `/api/memory/search` | GET | 记忆搜索 | v5.0 |
| `/api/memory/energy-distribution` | GET | 能量分布 | v5.0 |
| `/api/costs/:goalId` | GET | Goal 成本 | v6.0 |
| `/api/costs/summary` | GET | 成本汇总 | v6.0 |
| `/api/feedback` | GET/POST | 反馈列表/记录 | v6.0 |
| `/api/user-answers/:id` | POST | 用户回答 | v6.0 |
| `/api/alignment` | GET/POST | 权重对齐 | v6.0 |
| `/api/llm/compress` | POST | LLM 压缩代理 | v6.0 |
| `/api/gateway/pause` | POST | 暂停 Goal | v6.0 |
| `/api/gateway/resume` | POST | 恢复 Goal | v6.0 |
| `/api/gateway/cancel` | POST | 取消 Goal | v6.0 |
| `/api/gateway/checkpoint` | POST | 保存 Checkpoint | v6.0 |
| `/api/gateway/rollback` | POST | 回滚到 Checkpoint | v6.0 |

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

### v6.4 新增数据流

```
Search returns results
    → CognitiveGraph.addConnection()  (联想网络)
    → 更新 top_associations

ReviewScheduler 每小时 tick
    → 扫描 .harmonic_index.json entries
    → 计算逾期复习
    → 写入 .review_queue.json

HybridCompressor.compress()
    → calculateSalience()  (显著度感知)
    → 写入 tier 文件 + 更新索引
    → 触发 MinHash 合并检查
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MAFW_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway API 地址 |
| `PORT` | 3000 | HTTP 端口 |
| `DASHBOARD_PORT` | 3001 | Dashboard 端口 |
| `MAFW_LLM_API_KEY` | — | LLM 压缩 API Key |

### 命令行

```bash
npx mafw-gateway start               # 前台
npx mafw-gateway daemon              # 后台守护
npx mafw-gateway stop                # 停止
npx mafw-gateway status              # 状态
npx mafw-gateway dashboard           # 打开 Dashboard
npx mafw-gateway logs                # 日志
npx mafw-gateway service-register    # 系统服务注册
npx mafw-gateway service-unregister  # 系统服务卸载
```
