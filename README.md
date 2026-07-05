# MAFW (Memory-Augmented Framework for Work) — OpenCode Plugin v6.4

> v6.4 Cognitive Deepening: Memory that actively grows — deepens, connects, crystallizes.

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

## 版本特性

| 版本 | 核心主题 | 状态 |
|---|---|---|
| **v6.0** | 基础韧性 + 效率引擎 + 产品化（Cost/Cognitive Router/User Feedback） | ✅ |
| **v6.1-v6.2** | 记忆系统数据契约固化 + 存查解耦 | ✅ |
| **v6.3 谐波记忆** | 统一五层HarmonicUnit模型、谐波索引、跨层MinHash合并、BM25纯索引检索 | ✅ |
| **v6.4 认知深化** | 显著度感知、联想网络、间隔复习、抽象蒸馏 | ✅ |

### v6.3 谐波记忆系统

五层记忆统一为单一 `HarmonicUnit` 数据模型，层级降级为标签：

```
.mafw/memory/
├── .harmonic_index.json    # 统一 BM25 倒排索引（无视层级）
├── tier2/{goalId}.json     # episodic（情景记忆）
├── tier3/{goalId}.json     # semantic（语义记忆）
├── tier4/{goalId}.json     # procedural（过程记忆）
└── l5/                      # global（预留）
```

- 检索完全无视 `memory_type`，只认 `primary_abstraction` + `cue_anchors`
- 混合压缩器直接输出 `HarmonicUnit` + 持久化到 tier 文件 + 更新索引
- MinHash 跨层自动合并（Jaccard > 0.6）
- 不需要向量数据库，不需要 LLM

### v6.4 认知深化架构

| 引擎 | 机制 | 效果 |
|---|---|---|
| **显著度感知** | 正则识别故障/常规内容 | 踩坑经验衰减慢 3 倍，常规日志快 2 倍 |
| **联想网络** | 检索时自动连接共现记忆 | 查"支付超时"自动预取"网关配置" |
| **间隔复习** | 艾宾浩斯曲线调度 (1→2→4→8→16 天) | 主动提取练习，Energy +0.05/次 |
| **抽象蒸馏** | 3 条叙事→1 条事实，5 次流程→1 条公理 | 细节褪去，原则浮现 |

### 认知路由 (Cognitive Router)

Agent 级别动态模型选择，基于剩余 Token 预算自动降级：

```
Budget > 80% → Execute Agent 自动切换 Haiku
Budget 健康 → 使用配置的默认模型（Sonnet）
```

配置 `.mafw/router.json`：

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

每次 Tool 调用的 Token/成本估算，存储在 SQLite `cost_logs` 表和 JSON 文件。

### 用户反馈 (User Feedback)

Dashboard 内置 👍/👎 反馈系统，改变记忆能量值。

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

# 打开 Dashboard
npx mafw-gateway dashboard
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
┌─ v6.4 认知深化 ──────────────────────────────────┐
│ 显著度感知 · 联想网络 · 间隔复习 · 抽象蒸馏     │
├─ v6.3 谐波记忆 ──────────────────────────────────┤
│ HarmonicUnit · 谐波索引 · MinHash 合并            │
├─ v6.0 基础层 ─────────────────────────────────────┤
│ Wave Checkpoint · Cognitive Router · Cost Telemetry│
│ mafw_ask_user · mafw_record_feedback · SCORE      │
├─ v5.0 核心层 ─────────────────────────────────────┤
│ BM25+Vector+RRF · 知识图谱 · LoopStateMachine     │
│ SQLite+File · SSE · EnergySystem · HookManager     │
└────────────────────────────────────────────────────┘
```

### 组件

| 组件 | 职责 |
|---|---|
| **Plugin** (`src/`) | OpenCode 插件，注册 Tools/Skills/Hooks，管理记忆与上下文注入 |
| **Gateway** (`gateway/`) | 常驻进程，Phase 调度、Session 管理、Dashboard 服务、SSE 事件 |
| **Dashboard** (`gateway/src/dashboard/`) | 多 Goal SPA（Overview/Goals/Loops/Sessions/Memory/Cost/Analytics/Timeline/Alignment） |
| **Storage** (`src/memory/`) | 5 层谐波记忆 + HarmonicIndex + EnergySystem |
| **Compression** (`src/compression/`) | HybridCompressor + 动态水位 Token 分配 |
| **Cognitive** (`src/memory/`) | CognitiveGraph + ReviewScheduler + SaliencePerceptor + Distiller |
| **Search** (`src/`) | 谐波 BM25 检索 + RRF 融合 + 联想预取 |

## Dashboard

访问 `http://localhost:3001/`，8 个视图：

| 视图 | 内容 |
|---|---|
| Overview | 所有 Goal 聚合 KPI + 列表 |
| Goals | 选中 Goal 详情 + 控制（Pause/Stop） |
| Loops | Loop 时间线 |
| Sessions | 活跃 Session 列表 |
| Memory | 5 层记忆分布（T1-L5） |
| Cost | 成本火焰图（By Wave / By Tool） |
| Analytics | 成功率 + Cost 趋势 |
| Timeline | 干预时间线 |

## 关键决策

| # | 决策 | 说明 |
|---|---|---|
| 1 | 保持 Loop/Wave 命名，不做 Spiral 重命名 | ~50 文件改造，无行为收益 |
| 2 | SCORE 0-100 仅显示，状态机仍用 PASS/FAIL/PARTIAL | 避免 ~15 文件状态机重构 |
| 3 | 向量时钟 → OptimisticSync 因果上下文 | 当前 Wave 隔离架构无并发写冲突 |
| 4 | JSON Checkpoint + 文件清单，不做 tar.gz | Windows 兼容性 |
| 5 | 记忆系统统一为 HarmonicUnit 模型 | 存查解耦，层级降级为标签 |
| 6 | 认知深化纯规则驱动，零 LLM 依赖 | 所有引擎正则 + MinHash + 简单算法 |

## 文档

| 文档 | 位置 |
|---|---|
| v6.0 设计 | `docs/superpowers/specs/2026-07-02-v6.0-design.md` |
| v6.3 谐波记忆 M1-M3 | `docs/superpowers/specs/2026-07-02-v6.3-harmonic-memory-m1-m3.md` |
| v6.3 谐波记忆 M4-M6 | `docs/superpowers/specs/2026-07-02-v6.3-harmonic-memory-m4-m6.md` |
| v6.4 认知深化 | `docs/superpowers/specs/2026-07-02-v6.4-cognitive-deepening.md` |
| Gateway 架构 | `docs/architecture/gateway.md` |
| Plugin 架构 | `docs/architecture/plugin.md` |

## 许可

MIT
