# MAFW Plugin 架构

> OpenCode 插件，注册 Tools/Skills/Hooks，管理记忆、检索、压缩、成本追踪。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [核心模块](#核心模块)
- [Tools 清单](#tools-清单)
- [记忆系统](#记忆系统)
- [压缩管线](#压缩管线)
- [成本追踪](#成本追踪)
- [质量门禁](#质量门禁)

## 代码位置

```
src/
├── plugin.ts                           # 插件入口
├── tools/
│   ├── run-review.ts                   # Review 执行 + SCORE 支持
│   ├── run-ask-user.ts                 # v6.0: mafw_ask_user
│   └── run-record-feedback.ts          # v6.0: mafw_record_feedback
├── cost/
│   ├── types.ts                        # v6.0: CostRecord/CostSummary
│   ├── cost-estimator.ts               # v6.0: 成本估算器
│   └── cognitive-router.ts             # v6.0: 认知路由
├── compression/
│   ├── compression-pipeline.ts         # 压缩管线（dedup → classify → compress → merge）
│   ├── compression-strategy-selector.ts# 策略选择（diff/zero-token/template/rule-based）
│   ├── rule-based-compressor.ts        # v6.0: 规则压缩器（原 LLMCompressor）
│   ├── zero-token-compressor.ts        # 0-token 规则压缩
│   ├── diff-compressor.ts              # Diff 压缩
│   ├── observation-classifier.ts       # 观察分类器
│   ├── observation-deduplicator.ts     # SHA-256 去重
│   ├── token-budget-allocator.ts       # Token 预算分配
│   ├── memory-index.ts                 # BM25 索引
│   ├── vector-index.ts                 # Vector 索引（Xenova/all-MiniLM-L6-v2）
│   └── rrf-fusion.ts                   # RRF 融合
├── memory/
│   ├── store.ts                        # 参数化记忆存储
│   ├── energy-system.ts                # 能量系统（衰减+反馈）
│   └── privacy-filter.ts               # 隐私过滤（JWT/API Key/Password）
├── engine/
│   ├── loop-state-machine.ts           # 12 状态状态机
│   ├── state-lock.ts                   # Wave 级锁
│   ├── optimistic-sync.ts              # 乐观锁 + 因果上下文（v6.0）
│   ├── wave-dependency.ts              # Wave 依赖图
│   └── phase-orchestrator.ts           # Phase 编排
├── hooks/
│   ├── hook-manager.ts                 # Hook 注册+执行
│   └── session-ending.ts               # Session 结束 Hook
├── storage/
│   ├── sqlite-storage.ts               # SQLite 存储 + cost_logs 表
│   ├── file-storage.ts                 # 文件存储回退
│   └── types.ts                        # StorageBackend 接口
├── graph/
│   ├── knowledge-graph-manager.ts      # 知识图谱管理器
│   ├── entity-extractor.ts             # 实体提取
│   ├── relation-inferencer.ts          # 关系推断
│   └── graph-searcher.ts               # BFS 图谱搜索
└── utils/
    ├── state.ts                        # StateFile 读写（原子写入）
    ├── config-loader.ts                # 分层配置加载
    ├── retry.ts                        # 指数退避重试
    ├── circuit-breaker.ts              # 熔断器
    └── fallback.ts                     # 降级策略
```

## 生命周期

```
opencode 启动 → 加载插件 → MafwPlugin()
    │
    ├── ensureMafwDirectories()       ← 创建 .opencode/mafw/
    ├── ConfigLoader.load()           ← 加载分层配置
    ├── registerWithGateway()         ← 探测 Gateway 端口并注册
    │
    ├── 初始化子系统：
    │   ├── ParametricStore           ← L3 参数化记忆
    │   ├── MemoryIndexManager        ← BM25 索引
    │   ├── VectorIndex               ← 向量索引
    │   ├── KnowledgeGraphManager     ← 知识图谱
    │   ├── HookManager               ← Hook 注册
    │   ├── CostEstimator             ← v6.0: 成本估算
    │   └── CognitiveRouter           ← v6.0: 认知路由
    │
    └── 返回 Plugin 对象：
        ├── config                    ← agent 配置
        ├── command                   ← goal/status/mafw-loop/triage 命令
        ├── tool                      ← 7 个 Tool
        ├── hooks                     ← session.end / tool.execute.after
        └── event                     ← 外部事件
```

## Tools 清单

| Tool | 参数 | 用途 |
|---|---|---|
| `mafw_search_hybrid` | `goalId`, `query`, `maxResults`, `tokenBudget` | BM25+Vector+RRF 混合检索 |
| `mafw_get_deltas` | `goalId`, `phase`, `maxResults` | 获取 L3 参数化约束 |
| `mafw_update_state` | `goalId`, `patch` | 原子更新状态文件 |
| `mafw_load_state` | `goalId` | 读取状态文件 |
| `mafw_ask_user` | `question`, `goalId`, `options?`, `priority?` | 非阻塞提问（v6.0） |
| `mafw_record_feedback` | `targetId`, `type`, `goalId`, `comment?` | 记录反馈（v6.0） |

## 记忆系统

### 4 层记忆 (T1-T4) + L3

| 层级 | 内容 | 存储 |
|---|---|---|
| **T1 工作记忆** | 原始 Tool/File/LLM 观察 | 内存 |
| **T2 情景记忆** | Loop 叙事摘要 | SQLite + JSON |
| **T3 语义记忆** | Facts / Concepts | SQLite + FTS5 |
| **T4 过程记忆** | 工作流模式 | SQLite |
| **L3 参数化约束** | 必须/禁止规则 | YAML 文件 |

### 能量系统

```
E(t+1) = E(t) + ΔE

有用反馈:    ΔE = +0.1
无用反馈:    ΔE = -0.05
自然衰减:    ΔE = -0.01 × Δt_days
被检索:      ΔE = +0.02
被引用:      ΔE = +0.05

约束:
- E < 0.3 → 清理候选
- E > 0.8 → 关键记忆（Pre-compact 保护）
- 用户点赞: ΔE = +0.2 (v6.0)
- 用户点踩: ΔE = -0.1 (v6.0)
```

## 压缩管线

```
Raw Observations (T1)
    │
    ├─ [Deduplicate] ── SHA-256, 5min 窗口
    ├─ [Privacy] ───── JWT/API Key/Password 脱敏
    ├─ [Classify] ──── tool_use/file_edit/llm_call/error
    ├─ [Select] ────── 策略选择
    │       ├─ diff          → 全文件修改
    │       ├─ zero-token    → 规则匹配 > 80%
    │       ├─ template      → 简单观察 < 3
    │       └─ rule-based    → 能量门控规则提取 (v6.0)
    ├─ [Merge] ─────── Jaccard 相似合并
    └─ [Store] ────── T2/T3/T4
```

## 成本追踪

v6.0 新增：

```
Tool Call
    │
    ▼
CostEstimator.recordToolCall()
    │
    ├─ estimateTokens(toolName, input)    ← 按工具类型估算
    ├─ estimateCost(tokens, model)         ← 按模型费率计算
    └─ 写入 CostRecord
        │
        ├─ 内存 (CostEstimator.records[])
        └─ 持久化 .opencode/mafw/cost/{goalId}.json
              │
              └─ Dashboard API 读取展示
```

### 估算系数

| Tool | 估算 Tokens |
|---|---|
| `file_edit` / `file_write` | 0 |
| `mafw_observe` | 0 |
| `mafw_search_hybrid` | 0 |
| LLM 调用 | `inputChars / 4` |

| Model | 费率 |
|---|---|
| Sonnet | `$3/1K tokens` ($0.003/1K) |
| Haiku | `$1.5/1K tokens` ($0.0015/1K) |

## 质量门禁

### AGENTS.md 强制规范

1. **RS256 加密** — 所有生产认证系统必须使用
2. **测试覆盖率 ≥ 80%** — 低于 80% 标记 DEGRADED
3. **边界测试** — 空值、超长输入、特殊字符、时序攻击

### 测试策略

```bash
npm test              # 全量 420 测试
npx jest --verbose    # 详细输出
npx jest --coverage   # 覆盖率报告
```

当前：**45 suites，420 tests，100% 通过**。
