# MAFW (Memory-Augmented Framework for Work) — OpenCode Plugin v5.0

> v6.0 Aligned Platform: From executor to alignment platform — balancing user preference, cost budget, and historical experience.

## 安装

```bash
# 全局安装（推荐，多项目复用）
npm install -g opencode-plugin-mafw

# 本地安装（单项目）
npm install --save-dev opencode-plugin-mafw

# 启动 Gateway
npx mafw-gateway start
```

## 配置

编辑 `opencode.json`，在 `plugin` 数组中添加 `"opencode-plugin-mafw"`：

```json
{
  "plugin": [
    "superpowers@latest",
    "opencode-plugin-mafw"
  ]
}
```

## v6.0 特性

| 阶段 | 特性 | 状态 |
|---|---|---|
| **P1 基础韧性** | Wave 级 Checkpoint + 回溯、OptimisticSync 因果上下文、Cost 估算器 + Dashboard API | ✅ |
| **P2 效率引擎** | Rule-Based 混合压缩、Agent 级 Cognitive Router、Dashboard 成本火焰图 | ✅ |
| **P3 产品化** | mafw_ask_user（非阻塞）、mafw_record_feedback、SCORE 显示、对齐仪表盘、干预时间线 | ✅ |

### 认知路由 (Cognitive Router)

Agent 级别动态模型选择，基于剩余 Token 预算自动降级：

```
Budget > 80% → Execute Agent 自动切换 Haiku（省钱）
Budget 健康 → 使用配置的默认模型（Sonnet）
```

配置文件 `.mafw/router.json`：

```json
{
  "agents": {
    "plan": { "model": "claude-sonnet-4-20250514", "priority": "quality" },
    "execute": { "model": "claude-sonnet-4-20250514", "priority": "quality" },
    "review": { "model": "claude-haiku-3-5-20241022", "priority": "cost" }
  }
}
```

### 成本追踪 (Cost Telemetry)

每次 Tool 调用的 Token/成本估算，存储在 SQLite `cost_logs` 表和 JSON 文件：

- `file_edit` / `mafw_observe` / `mafw_search_hybrid` → 0 tokens
- LLM 调用 → `inputChars / 4 * $0.003/1K` (Sonnet) 或 `$0.0015/1K` (Haiku)

### 用户反馈 (User Feedback)

Dashboard 内置 👍/👎 反馈系统，改变记忆能量值：

| 反馈类型 | Energy Δ |
|---|---|
| thumbs_up | +0.2 |
| thumbs_down | -0.1 |
| correction | 0.0 |

## 启动 Gateway

```bash
# 前台启动
npx mafw-gateway start

# 后台守护模式
npx mafw-gateway daemon

# 注册系统服务（开机自启）
npx mafw-gateway service-register

# 查看状态
npx mafw-gateway status

# 查看日志
npx mafw-gateway logs
```

## 使用

```bash
# 启动 OpenCode TUI
opencode

# 提交 Goal
/goal design a login system

# 查看状态
/status

# TUI 可以关闭，Goal 在后台自动运行
```

## 架构

```
┌─ MAFW v6.0 ──────────────────────────────────┐
│ ┌─ P3 产品化 ──────────────────────────┐    │
│ │ mafw_ask_user / mafw_record_feedback │    │
│ │ SCORE 显示 / 对齐仪表盘 / 干预时间线 │    │
│ └──────────────────────────────────────┘    │
│ ┌─ P2 效率引擎 ───────────────────────┐    │
│ │ 混合压缩器 / 认知路由 / 成本火焰图 │    │
│ └──────────────────────────────────────┘    │
│ ┌─ P1 基础韧性 ───────────────────────┐    │
│ │ Wave Checkpoint / 因果上下文 / Cost │    │
│ └──────────────────────────────────────┘    │
│ ┌─ v5.0 核心层 ──────────────────────────────┐
│ │ BM25+Vector+RRF / 隐私过滤 / SQLite+File    │
│ │ 知识图谱 / StateLock / SSE / EnergySystem   │
│ └─────────────────────────────────────────────┘
└────────────────────────────────────────────────┘
```

### 组件

| 组件 | 职责 |
|---|---|
| **Plugin** (`src/`) | OpenCode 插件，注册 Tools/Skills/Hooks，管理记忆与上下文注入 |
| **Gateway** (`gateway/`) | 常驻进程，Phase 调度、Session 管理、Dashboard 服务、SSE 事件 |
| **Dashboard** (`gateway/src/dashboard/`) | 7 视图 SPA（Overview/Sessions/Goals/Loops/Analytics/Cost/Alignment/Timeline） |
| **Storage** (`src/storage/`) | SQLite + 文件双重存储，记忆索引 FTS5 |
| **Compression** (`src/compression/`) | 4 策略压缩（diff/zero-token/template/rule-based） |
| **Cost** (`src/cost/`) | CostEstimator、CognitiveRouter、Cost 类型 |
| **Search** (`src/tools/`) | BM25 + Vector + RRF 混合检索 |
| **Memory** (`src/memory/`) | 4 层记忆（T1-T4）+ L3 参数化约束 + Energy 系统 |

### 数据流

```
Agent → Tool Call → Plugin → State File → Gateway (poll/SSE) → Scheduler → Agent
                                   ↓
                              Dashboard (SSE EventSource)
```

## Dashboard

访问 `http://localhost:3000/dashboard/`，7 个视图：

| 视图 | 内容 |
|---|---|
| Overview | KPI 卡片、Loop 阶段分布、Live 活动表 |
| Sessions | 活跃 Session 列表、SSE 事件流 |
| Goals | 活跃 Goal 详情 |
| Loops | Loop 时间线 |
| Analytics | 成功率、Agent Token 消耗 |
| Cost | 成本火焰图（By Wave / By Tool） |
| Alignment | 用户权重滑块、对齐度 |
| Timeline | 干预时间线（👍/👎/✏️） |

## 关键决策

| # | 决策 | 说明 |
|---|---|---|
| 1 | 保持 Loop/Wave 命名，不做 Spiral 重命名 | ~50 文件改造，无行为收益 |
| 2 | SCORE 0-100 仅显示，状态机仍用 PASS/FAIL/PARTIAL | 避免 ~15 文件状态机重构 |
| 3 | 向量时钟 → OptimisticSync 因果上下文 | 当前 Wave 隔离架构无并发写冲突 |
| 4 | JSON Checkpoint + 文件清单，不做 tar.gz | Windows 兼容性 |
| 5 | mafw_ask_user 非阻塞（Dashboard 通知） | opencode SDK 不支持 Agent 挂起/恢复 |
| 6 | Cost Telemetry 估算模式 | Plugin 无法拦截子进程 LLM Token |

## 文档

| 文档 | 位置 |
|---|---|
| v6.0 设计 | `docs/superpowers/specs/2026-07-02-v6.0-design.md` |
| v6.0 执行计划 | `docs/superpowers/plans/2026-07-02-v6.0-implementation.md` |
| Gateway 架构 | `docs/architecture/gateway.md` |
| Plugin 架构 | `docs/architecture/plugin.md` |

## 许可

MIT
