# MAFW Plugin 架构

> OpenCode 插件，注册 Tools/Skills/Hooks，管理谐波记忆、检索、压缩、认知深化。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [核心模块](#核心模块)
- [谐波记忆系统](#谐波记忆系统)
- [认知深化引擎](#认知深化引擎)
- [压缩管线](#压缩管线)
- [Tools 清单](#tools-清单)
- [质量门禁](#质量门禁)

## 代码位置

```
src/
├── plugin.ts                           # 插件入口
├── tools/
│   ├── run-review.ts                   # Review 执行 + SCORE 支持
│   ├── run-ask-user.ts                 # mafw_ask_user
│   └── run-record-feedback.ts          # mafw_record_feedback
├── cost/
│   ├── types.ts                        # CostRecord/CostSummary
│   ├── cost-estimator.ts               # 成本估算器
│   └── cognitive-router.ts             # 认知路由
├── compression/
│   ├── compression-pipeline.ts         # 压缩管线
│   ├── compression-strategy-selector.ts# 策略选择
│   ├── hybrid-compressor.ts            # v6.3: 输出 HarmonicUnit
│   ├── zero-token-compressor.ts        # 0-token 规则
│   ├── diff-compressor.ts              # Diff 压缩
│   ├── observation-classifier.ts       # 观察分类器
│   ├── observation-deduplicator.ts     # SHA-256 去重
│   ├── token-budget-allocator.ts       # v6.0: 动态水位分配
│   └── rrf-fusion.ts                   # RRF 融合
├── memory/
│   ├── harmonic-types.ts               # v6.3: HarmonicUnit 模型
│   ├── harmonic-index.ts               # v6.3: 谐波索引管理器
│   ├── migrate-v6.1.ts                 # v6.3: 数据迁移脚本
│   ├── cognitive-graph.ts              # v6.4: 联想网络邻接表
│   ├── review-scheduler.ts             # v6.4: 间隔复习调度器
│   ├── salience-perceptor.ts           # v6.4: 显著度感知
│   ├── abstraction-distiller.ts        # v6.4: 抽象蒸馏器
│   ├── minhash-merger.ts               # v6.3: MinHash 跨层合并
│   ├── energy-system.ts                # 能量系统（v6.4: 显著度加权衰减）
│   ├── store.ts                        # 参数化记忆存储
│   └── privacy-filter.ts               # 隐私过滤
├── engine/
│   ├── loop-state-machine.ts           # 12 状态状态机
│   ├── state-lock.ts                   # Wave 级锁
│   ├── optimistic-sync.ts              # 乐观锁 + 因果上下文
│   ├── wave-dependency.ts              # Wave 依赖图
│   └── phase-orchestrator.ts           # Phase 编排
├── hooks/
│   ├── hook-manager.ts                 # Hook 注册+执行
│   └── session-ending.ts               # Session 结束 Hook
├── storage/
│   ├── sqlite-storage.ts               # SQLite 存储
│   ├── file-storage.ts                 # 文件存储回退
│   └── types.ts                        # StorageBackend 接口
├── graph/
│   ├── knowledge-graph-manager.ts      # 知识图谱管理器
│   ├── entity-extractor.ts             # 实体提取
│   ├── relation-inferencer.ts          # 关系推断
│   └── graph-searcher.ts               # BFS 图谱搜索
└── utils/
    ├── state.ts                        # StateFile 读写
    ├── config-loader.ts                # 分层配置加载
    ├── retry.ts                        # 指数退避重试
    ├── circuit-breaker.ts              # 熔断器
    └── fallback.ts                     # 降级策略
```

## 生命周期

```
opencode 启动 → 加载插件 → MafwPlugin()
    │
    ├── ensureMafwDirectories()
    ├── ConfigLoader.load()
    ├── registerWithGateway()
    │
    ├── 初始化子系统：
    │   ├── HarmoniIndexManager        ← v6.3 谐波索引
    │   ├── CognitiveGraphManager      ← v6.4 联想网络
    │   ├── ReviewScheduler            ← v6.4 间隔复习
    │   ├── CostEstimator              ← v6.0 成本估算
    │   ├── CognitiveRouter            ← v6.0 认知路由
    │   ├── HookManager                ← Hook 注册
    │   └── MemoryIndex                ← BM25 索引
    │
    ├── 自动迁移旧数据 (migrateV61)
    │
    └── 返回 Plugin 对象：
        ├── config                     ← Agent 配置
        ├── command                    ← goal/status/mafw-loop/triage
        ├── tool                       ← 7 个 Tool
        ├── hooks                      ← session.end / tool.execute.after
        └── event                      ← 外部事件
```

## 谐波记忆系统

### 数据模型（v6.3）

所有层级统一为 `HarmonicUnit`：

```typescript
interface HarmonicUnit {
  id: string;
  goal_id: string | null;
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;    // 6-8 词核心摘要，BM25 索引键
  cue_anchors: string[];          // 多跳线索
  memory_value: string;           // 完整内容
  energy: number;
  salience?: number;              // v6.4
  abstraction_level?: number;     // v6.4
  review_count?: number;          // v6.4
  last_reviewed?: string;         // v6.4
  top_associations?: string[];    // v6.4
  merged_from?: string[];
  created_at: string;
  updated_at: string;
}
```

### 检索

```
查询 → BM25 扫描 .harmonic_index.json（仅 primary_abstraction + cue_anchors）
     → 无视 memory_type（跨层统一）
     → 按 energy × BM25 排序
     → 联想预取 top_associations
     → 按需从 tier 文件加载完整 memory_value
```

### 存储结构

```
.mafw/memory/
├── .harmonic_index.json      # 统一 BM25 倒排索引
├── .cognitive_graph.json     # v6.4: 联想邻接表
├── .review_queue.json        # v6.4: 复习任务队列
├── tier2/{goalId}.json       # episodic
├── tier3/{goalId}.json       # semantic
├── tier4/{goalId}.json       # procedural
└── l5/                       # global（预留）
```

## 认知深化引擎（v6.4）

### 显著度感知

```typescript
// src/memory/salience-perceptor.ts
function calculateSalience(text: string): number
// 故障/错误 → 1.5，常规日志 → 0.5，默认 → 1.0
// 影响：日衰减 = 0.01 × (1 / salience)
```

### 联想网络

```typescript
// src/memory/cognitive-graph.ts
class CognitiveGraphManager {
  addConnection(idA, idB)    // 检索共现时 +1
  getTopAssociations(id, k)  // 返回 Top-K 关联 ID
  prune(threshold)           // 剪枝弱连接
}
```

### 间隔复习

```typescript
// src/memory/review-scheduler.ts
class ReviewScheduler {
  start(periodMs?)           // 后台定时器
  getNextInterval(reviewCount) // 1→2→4→8→16 天
}
```

### 抽象蒸馏

```typescript
// src/memory/abstraction-distiller.ts
function runDistillation(indexManager, baseDir)
// 规则一：≥3 条 T2 → 1 条 T3
// 规则二：≥5 条 T4 → 1 条 L5（预留）
```

### MinHash 跨层合并

```typescript
// src/memory/minhash-merger.ts
class MinHashMerger {
  generateSignature(text)    // 4 哈希 MinHash 签名
  similarity(sigA, sigB)     // Jaccard 近似
  merge(unit, tier, index, baseDir)  // >0.6 时合并
}
```

## 压缩管线

```
T1 Raw Observations
    │
    ├─ [Deduplicate] ── SHA-256, 5min 窗口
    ├─ [Privacy] ────── JWT/API Key/Password 脱敏
    ├─ [Select] ─────── 策略选择
    │       ├─ diff          → 全文件修改
    │       ├─ zero-token    → 规则匹配
    │       ├─ template      → 简单观察
    │       └─ hybrid        → Gateway LLM + 规则回退
    │                          输出 HarmonicUnit
    │                          写入 tier 文件 + 更新索引
    │                          触发 MinHash 合并
    └─ [Store] ────── T2/T3/T4 (谐波单元格式)
```

## Tools 清单

| Tool | 参数 | 用途 |
|---|---|---|
| `mafw_search_hybrid` | `goalId`, `query`, `maxResults` | 谐波 BM25 检索 + 联想预取 |
| `mafw_get_deltas` | `goalId`, `phase`, `maxResults` | 获取 L3 参数化约束 |
| `mafw_update_state` | `goalId`, `patch` | 原子更新状态文件 |
| `mafw_load_state` | `goalId` | 读取状态文件 |
| `mafw_ask_user` | `question`, `goalId` | 非阻塞提问 |
| `mafw_record_feedback` | `targetId`, `type`, `goalId` | 记录反馈+能量调整 |
| `mafw_get_model_route` | `taskType`, `remainingBudget` | 动态模型选择 |

## 质量门禁

### AGENTS.md 强制规范

1. **RS256 加密** — 所有生产认证系统必须使用
2. **测试覆盖率 ≥ 80%** — 低于 80% 标记 DEGRADED
3. **边界测试** — 空值、超长输入、特殊字符、时序攻击

### 测试策略

```bash
npm test              # 全量 483 测试
npx jest --verbose    # 详细输出
npx jest --coverage   # 覆盖率报告
```

当前：**57 suites，483 tests，100% 通过**。
