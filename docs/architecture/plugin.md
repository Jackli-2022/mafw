# MAFW Plugin 架构

> OpenCode 插件，注册 Tools/Skills/Hooks，管理谐波记忆、检索、压缩、认知深化。

## 目录

- [代码位置](#代码位置)
- [生命周期](#生命周期)
- [OpenCode API 格式](#opencode-api-格式)
- [Plugin 初始化流程](#plugin-初始化流程)
- [核心模块](#核心模块)
- [Tool 系统详解](#tool-系统详解)
- [Event/Hook 系统](#eventhook-系统)
- [命令系统](#命令系统)
- [谐波记忆系统](#谐波记忆系统)
- [认知深化引擎](#认知深化引擎)
- [压缩管线](#压缩管线)
- [状态机](#状态机)
- [数据流全景](#数据流全景)
- [质量门禁](#质量门禁)

## 代码位置

```
src/
├── plugin.ts                           # 插件入口（~800 行）
├── index.ts                            # 导出
│
├── tools/                              # Tool 处理函数
│   ├── run-review.ts                   # Review 执行 + SCORE 解析
│   ├── run-ask-user.ts                 # 向用户提问
│   └── run-record-feedback.ts          # 记录点赞/点踩
│
├── cost/                               # 成本与路由
│   ├── types.ts                        # CostRecord, CostSummary
│   ├── cost-estimator.ts               # 每次 Tool 调用估算成本
│   └── cognitive-router.ts             # 基于预算选择模型
│
├── compression/                        # 压缩管线
│   ├── compression-pipeline.ts         # 主管道（dedup→classify→compress→merge）
│   ├── compression-strategy-selector.ts# 策略选择器
│   ├── hybrid-compressor.ts            # 输出 HarmonicUnit
│   ├── zero-token-compressor.ts        # 正则模式匹配（0 成本）
│   ├── diff-compressor.ts              # 文件修改 Diff 提取
│   ├── observation-classifier.ts       # 按 type/phase 分组
│   ├── observation-deduplicator.ts     # SHA-256 5min 窗口去重
│   ├── token-budget-allocator.ts       # 动态水位 Token 分配
│   └── rrf-fusion.ts                   # RRF 融合排序
│
├── memory/                             # 记忆与认知系统
│   ├── harmonic-types.ts               # 统一数据模型
│   ├── harmonic-index.ts               # BM25 索引 CRUD
│   ├── energy-system.ts                # 能量衰减+事件
│   ├── migrate-v6.1.ts                 # 旧→新格式迁移
│   ├── cognitive-graph.ts              # 联想邻接表
│   ├── review-scheduler.ts             # 间隔复习
│   ├── salience-perceptor.ts           # 显著度计算
│   ├── abstraction-distiller.ts        # 叙事→事实蒸馏
│   ├── minhash-merger.ts               # 跨层 MinHash 合并
│   ├── store.ts                        # L3 参数化存储
│   ├── privacy-filter.ts               # JWT/API Key 脱敏
│   ├── injector.ts                     # 上下文注入
│   ├── extractor.ts                    # 记忆提取
│   ├── matcher.ts                      # 约束匹配
│   ├── merger.ts                       # 旧合并逻辑
│   └── validator.ts                    # 约束验证
│
├── engine/                             # 执行引擎
│   ├── loop-state-machine.ts           # 12 状态状态机
│   ├── state-lock.ts                   # Wave 级悲观锁
│   ├── optimistic-sync.ts              # 乐观锁+因果上下文
│   ├── wave-dependency.ts              # Wave DAG
│   ├── phase-orchestrator.ts           # Phase 转换
│   ├── degradation.ts                  # 降级策略
│   ├── task-branch-manager.ts          # Task 分支管理
│   ├── goal-worktree-manager.ts        # Goal Worktree
│   ├── wave-executor.ts                # Wave 执行器
│   ├── report-generator.ts             # Receipt 生成
│   └── lesson-manager.ts               # Lesson 管理
│
├── hooks/                              # Hook 系统
│   ├── hook-manager.ts                 # 注册/执行/优先级
│   └── session-ending.ts               # Session 结束 Hook
│
├── storage/                            # 存储抽象层
│   ├── sqlite-storage.ts               # SQLite (better-sqlite3)
│   ├── file-storage.ts                 # 文件系统
│   └── types.ts                        # StorageBackend 接口
│
├── graph/                              # 知识图谱
│   ├── knowledge-graph-manager.ts      # 图管理器
│   ├── entity-extractor.ts             # 实体提取
│   ├── relation-inferencer.ts          # 关系推断
│   └── graph-searcher.ts               # BFS 搜索
│
└── utils/                              # 工具
    ├── state.ts                        # StateFile 读写（原子 tmp+rename）
    ├── status.ts                       # STATUS.md 读写
    ├── config-loader.ts                # 4 层配置加载
    ├── retry.ts                        # 指数退避
    ├── circuit-breaker.ts              # 熔断器
    ├── fallback.ts                     # 降级策略
    ├── git.ts                          # Git 操作
    └── github.ts                       # GitHub API
```

## 生命周期

```
opencode CLI 启动 → 加载 MAFW 插件 → MafwPlugin()
     │
     │  (同步阶段)
     ├── 1. ensureMafwDirectories()
     │      创建 .opencode/mafw/{state,goals,reviews,receipts,...}
     │
     ├── 2. ConfigLoader.getInstance().getAll()
     │      加载: 默认→全局~/.config/mafw→项目.mafw/config.json→环境变量
     │
     ├── 3. registerWithGateway()
     │      探测 3000-3010 端口, POST /register {projectDir, mafwDir}
     │
     │  (初始化阶段)
     ├── 4. 初始化 ParametricStore (L3 参数化记忆)
     ├── 5. 初始化 MemoryIndexManager (BM25 索引)
     ├── 6. 初始化 VectorIndex (@xenova/transformers)
     ├── 7. 初始化 KnowledgeGraphManager
     ├── 8. 初始化 TokenBudgetAllocator
     ├── 9. 初始化 SessionPruner
     ├── 10. 初始化 HookManager + 注册 4 个 Hook
     ├── 11. 初始化 CostEstimator
     ├── 12. 初始化 HarmoniIndexManager  (v6.3)
     ├── 13. 初始化 CognitiveGraphManager  (v6.4)
     ├── 14. 初始化 ReviewScheduler → start()  (v6.4)
     │
     │  (迁移阶段)
     ├── 15. 自动迁移: migrateV61() 若无 .harmonic_index.json
     │
     │  (返回阶段)
     └── 16. 返回 Plugin 契约对象:
              ├── config      → Agent 模型映射
              ├── command     → goal / status / mafw-loop / triage / ...
              ├── tool        → 7 个 Tool 定义
              ├── hooks       → session.end / tool.execute.after
              └── event       → 外部事件处理器
```

## OpenCode API 格式

MAFW Plugin 遵循 OpenCode v5.0 Plugin 格式，返回一个包含 5 个部分的契约对象：

```typescript
export default async function MafwPlugin({ directory }: { directory: string }) {
  // ... 初始化 ...
  return {
    // 1. config — 配置 Agent→模型映射
    config: async (config: any) => {
      config.mafw = {
        agents: {
          plan: 'mafw-plan',
          execute: 'mafw-execute',
          review: 'mafw-review'
        },
        // v6.0: 认知路由配置
        cognitiveRouter: { budget: { total: 1000000, threshold: 0.8 } }
      };
    },

    // 2. experimental.chat.messages.transform — 上下文注入
    'experimental.chat.messages.transform': async (input, output) => {
      // 解析 goalId + phase
      // 执行混合检索 (BM25 + Vector + Graph + Harmonic)
      // 分配 Token 预算
      // 注入 L3 约束 + T4 模式 + T3 事实 + T2 叙事
      // 返回增强后的 messages
    },

    // 3. command — CLI 命令
    command: {
      goal: { /* 创建 Goal */ },
      status: { /* 显示状态 */ },
      'mafw-loop': { /* 手动触 Loop */ },
      triage: { /* 诊断 */ },
      'triage-confirm': { /* 确认 */ },
    },

    // 4. tool — Agent 可调用的工具
    tool: {
      mafw_search_hybrid: { /* 谐波 BM25 检索 + 联想预取 */ },
      mafw_get_deltas: { /* L3 约束检索 */ },
      mafw_update_state: { /* 原子状态更新 */ },
      mafw_load_state: { /* 读状态 */ },
      mafw_ask_user: { /* 非阻塞提问 */ },
      mafw_record_feedback: { /* 记录反馈 + 能量调整 */ },
      mafw_get_model_route: { /* 预算→模型决策 */ },
    },

    // 5. hooks — 事件回调
    hooks: {
      'session.end': (ctx) => hookManager.execute('session.end', ctx),
      'tool.execute.after': (ctx, result) => hookManager.execute('tool.execute.after', ctx, result),
    },

    // 6. event — 外部事件
    event: async ({ event }: any) => { /* 处理外部事件 */ }
  };
}
```

## Plugin 初始化流程

### 1. 目录结构初始化 (`ensureMafwDirectories`)

```typescript
async function ensureMafwDirectories(mafwDir: string): Promise<void> {
  const dirs = [
    'state', 'goals', 'reviews', 'receipts', 'requests',
    'lessons', 'parametric', 'cost', 'memory',
    'checkpoints', 'user-questions', 'user-feedback'
  ];
  for (const dir of dirs) {
    const p = path.join(mafwDir, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}
```

### 2. 配置加载 (`ConfigLoader`)

```
加载顺序（后者覆盖前者）:
  1. 内置默认配置 (defaultConfig)
  2. 用户全局配置 ~/.config/mafw/config.json
  3. 项目配置 .mafw/config.json
  4. 环境变量 MAFW_*
```

### 3. Gateway 注册

```typescript
async function registerWithGateway(directory: string, mafwDir: string) {
  // 探测端口: 尝试 3000→3010
  for (let port = 3000; port <= 3010; port++) {
    try {
      await withRetry(() => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));
      // 发送注册请求
      await fetch(`http://127.0.0.1:${port}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: directory, mafwDir, pluginVersion: '6.4' })
      });
      console.log(`[MAFW] Registered with Gateway @ localhost:${port}`);
      return;
    } catch { continue; }
  }
  console.warn('[MAFW] ⚠️ Gateway not running');
}
```

### 4. Hook 注册

Plugin 启动时注册 4 个核心 Hook：

| Hook | Event | 优先级 | 职责 |
|---|---|---|---|
| `session-ending` | `session.end` | 100 | Session 结束时兜底状态更新 |
| `tool-executed` | `tool.execute.after` | 50 | 记录 Tool 执行到观察 |
| `cost-recording` | `tool.execute.after` | 40 | 每次 Tool 调用估算成本 |
| `cost-threshold` | `session.start` | 10 | 检查总成本是否超阈值 |

### 5. 自动迁移

```typescript
if (!fs.existsSync(path.join(mafwDir, 'memory', '.harmonic_index.json'))) {
  const result = await migrateV61(mafwDir, harmonicIndex);
  // 将旧 lessons/ → tier2, parametric/ → tier3
}
```

## Tool 系统详解

### mafw_search_hybrid — 谐波检索

**接口**：
```typescript
{
  goalId: string;
  query: string;
  maxResults?: number;   // 默认 10
  tokenBudget?: number;  // 默认 2000
}
```

**执行流程**：
```
1. 读取 Goal Charter + state.json → 获取目标上下文
2. BM25 检索 memory-index.ts → {id, score, text}
3. 向量检索 vector-index.ts → {id, score, text}  (v5.0 兼容)
4. 谐波索引检索 harmonic-index.ts → {id, energy, abstraction, anchors}  (v6.3)
5. 读取 L3 参数化约束 parametric-store
6. 读取 Lessons (L2) + Reviews (T2)
7. RRF 融合 (k=60) + Session 去重 (max 3/loop)
8. ★ 联想网络: CognitiveGraphManager.addConnection()  (v6.4)
9. Token 预算分配 → 按 energy 排序截断
10. 返回 { semantic, procedural, parametric, episodic }
```

**返回值结构**：
```typescript
interface HybridSearchResult {
  semantic: Array<{ id, score, facts, concepts, energy }>;
  procedural: Array<{ id, score, pattern, successRate, energy }>;
  parametric: Array<{ id, score, content, energy, type }>;
  episodic: Array<{ id, score, summary, verdict, energy }>;
  totalTokens: number;
}
```

### mafw_update_state — 原子状态更新

**接口**：`{ goalId, patch: Partial<StateFile> }`

**执行流程**：
```
1. 读取 state/{goalId}.json
2. 合并 patch
3. 写入 .tmp 文件
4. rename (原子操作)
5. POST /api/events 通知 Gateway
```

### mafw_ask_user — 非阻塞问答

**接口**：`{ question, goalId, options?, priority? }`

**执行流程**：
```
1. 写 .opencode/mafw/user-questions/{goalId}/{id}.json
2. 返回 { success, questionId, questionPath }
3. Dashboard SSE 接收 → 展示浮层
4. 用户回答 → POST /api/user-answers/{id}
5. 下次 Loop 注入时读取
```

### mafw_record_feedback — 反馈记录

**接口**：`{ targetId, type (thumbs_up|down|correction), goalId, comment? }`

**执行流程**：
```
1. 计算能量变化: thumbs_up=+0.2, thumbs_down=-0.1
2. 写 .opencode/mafw/user-feedback/{goalId}/{id}.json
3. 返回 { success, feedbackId, energyDelta }
4. Dashboard SSE 接收 → 展示时间线
```

### mafw_get_model_route — 认知路由

**接口**：`{ taskType, remainingBudget }`

**执行逻辑**：
```
if usage > 80% && taskType === 'execute' → haiku
else → 配置文件中的默认模型
```

## Event/Hook 系统

### HookManager

```typescript
class HookManager {
  private hooks: Map<string, HookRegistration[]>;

  register(hook: HookRegistration): void;
  // 按 event 分组，同 event 内按 priority 排序

  async execute(event: string, ctx: any): Promise<void>;
  // 按优先级顺序执行，failBehavior=continue 则错误不中断链
}
```

### SSE 事件流

Plugin 通过 POST `/api/events` 向 Gateway 推送事件，Gateway 通过 SSE 广播到 Dashboard：

```typescript
// Plugin 端（state.ts）
fetch(`${gatewayUrl}/api/events`, {
  method: 'POST',
  body: JSON.stringify({ type: 'state_change', goalId, patch })
});

// Gateway 端（server.ts）
// /api/events?stream=true → EventSource
// broadcast() → 遍历 sseClients Set → res.write(`data: ${json}\n\n`)
```

### 事件类型

| 事件类型 | 触发时机 | 消费者 |
|---|---|---|
| `state_change` | updateState() 调用 | Dashboard 刷新 |
| `feedback` | recordFeedback() | Dashboard 时间线 |
| `user.question` | askUser() | Dashboard 浮层 |

## 命令系统

| 命令 | 用途 | 参数 |
|---|---|---|
| `/goal` | 创建新 Goal | 任意描述文本 |
| `/status` | 显示当前运行状态 | 无 |
| `/mafw-loop` | 手动触发下一 Loop | `{goalId}` |
| `/triage` | 诊断系统状态 | 无 |
| `/triage-confirm` | 确认诊断结果 | `{goalId}` |

## 谐波记忆系统

### 数据模型 (v6.3 HarmonicUnit)

```typescript
interface HarmonicUnit {
  id: string;                    // mem_{timestamp}_{random}
  goal_id: string | null;       // L5 为 null
  memory_type: 'episodic' | 'semantic' | 'procedural' | 'global';
  primary_abstraction: string;  // 6-8 词核心摘要 → BM25 索引键
  cue_anchors: string[];        // 多跳线索 (max 8)
  memory_value: string;         // 完整内容
  energy: number;               // 0.0 ~ 1.0
  salience?: number;            // v6.4: 0.5~1.5
  abstraction_level?: number;   // v6.4: 0=T1, 1=T2, 2=T3/T4, 3=L5
  review_count?: number;        // v6.4: 复习次数
  last_reviewed?: string;       // v6.4: ISO 日期
  top_associations?: string[];  // v6.4: 联想预取 ID
  merged_from?: string[];       // 合并来源 ID
  created_at: string;
  updated_at: string;
}
```

### 谐波索引管理器

```typescript
class HarmonicIndexManager {
  constructor(baseDir: string);
  // 加载/创建 .harmonic_index.json

  addEntry(unit: HarmonicUnit, tier: string): void;
  // 追加 entry 到 index.entries + 原子保存

  removeEntry(id: string): void;
  // 过滤删除

  updateEnergy(id: string, delta: number): void;
  // 直接修改 energy 值

  search(query: string, topK?: number): HarmonicIndexEntry[];
  // 分词 → BM25 扫描 primary_abstraction + cue_anchors
  // 按 energy × keyword_matches 排序
  // 完全无视 memory_type

  getIndex(): HarmonicIndex;
  // 返回深拷贝
}
```

### 存储结构

```
.mafw/memory/
├── .harmonic_index.json      # 统一 BM25 倒排索引
├── .cognitive_graph.json     # v6.4: 联想权重邻接表
├── .review_queue.json        # v6.4: 复习任务队列
├── tier2/{goalId}.json       # episodic (情景记忆)
├── tier3/{goalId}.json       # semantic (语义记忆)
├── tier4/{goalId}.json       # procedural (过程记忆)
└── l5/                       # global (预留)
```

### 检索流程

```
用户查询 "JWT 超时配置"
    │
    ▼
1. 分词: ["jwt", "超时", "配置"]
    │
2. BM25 扫描 .harmonic_index.json
    │  - 匹配 primary_abstraction: "JWT token expiry" (score 2.1)
    │  - 匹配 cue_anchors: ["jwt", "auth"] (score 1.5)
    │  - 匹配 primary_abstraction: "Fixed JWT timeout" (score 1.8)
    │  ★ 完全不关心 memory_type = semantic vs episodic
    │
3. 按 energy × BM25 得分排序
    │  - "JWT token expiry" (energy 0.8 × 2.1 = 1.68)
    │  - "Fixed JWT timeout" (energy 0.6 × 1.8 = 1.08)
    │
4. 联想预取 top_associations
    │  - "JWT token expiry" → preload "Gateway timeout config" (关联权重 12)
    │
5. 从 tier3/g1.json / tier2/g1.json 加载完整 memory_value
    │
6. 返回结果 + 预取联想
```

## 认知深化引擎 (v6.4)

### 1. 显著度感知 (Salience Perceptor)

```typescript
function calculateSalience(text: string): number {
  const HIGH = [/error|crash|fail|宕机|critical|严重/i];
  const LOW  = [/info|success|完成|正常|debug|trace|verbose/i];
  if (HIGH.some(p => p.test(text))) return 1.5;  // 故障 → 3x 慢遗忘
  if (LOW.some(p => p.test(text))) return 0.5;  // 常规 → 2x 快遗忘
  return 1.0;                                    // 默认
}
```

**调用链**：
```
HybridCompressor.makeUnit()
    → calculateSalience(allContent)
    → unit.salience = result
    → persistUnit() → 写入 tier 文件 + 索引
```

**能量衰减影响**：
```
日衰减 = 0.01 × (1 / salience)
salience=1.5 (宕机) → 0.0067/天  → 150 天才到 0
salience=0.5 (INFO) → 0.02/天    → 50 天就到 0
salience=1.0 (默认) → 0.01/天    → 100 天到 0
```

### 2. 联想网络 (Cognitive Graph)

```typescript
class CognitiveGraphManager {
  constructor(baseDir: string);
  // 加载/创建 .cognitive_graph.json

  addConnection(idA: string, idB: string): void;
  // 排序 ID 防重复 → 查现有边 → weight++ 或新建 weight=1

  getTopAssociations(id: string, topK?: number): string[];
  // 查询所有 source===id OR target===id 的边
  // 按 weight 降序 → 取 TopK 的 neighbor

  prune(threshold?: number): void;
  // 移除 weight < threshold 的弱连接

  getGraph(): CognitiveGraph;
}
```

**触发时机**：每次 `mafw_search_hybrid` 返回 N>1 条结果时：
```
结果 [mem_001, mem_002, mem_003]
    → addConnection(001, 002) weight++
    → addConnection(001, 003) weight++
    → addConnection(002, 003) weight++
    → 更新三个单元的 top_associations
```

### 3. 间隔复习 (Review Scheduler)

```typescript
class ReviewScheduler {
  constructor(indexManager: HarmonicIndexManager, baseDir: string)

  start(periodMs: number = 3600000): void;
  // 每小时 tick 一次

  stop(): void;
  // clearInterval

  getReviewQueue(): ReviewTask[];
  // 读取 .review_queue.json

  private tick(): void;
  // 遍历 index.entries
  //   跳过 energy < 0.5
  //   计算 daysSinceLastReview
  //   如果 daysSince >= 1 * 2^reviewCount
  //     加入任务队列
  // 按逾期排序 → 保留 Top 3
  // 写入 .review_queue.json
}
```

**间隔曲线**：`1 → 2 → 4 → 8 → 16 → 32` 天

### 4. 抽象蒸馏 (Abstraction Distiller)

```typescript
async function runDistillation(
  indexManager: HarmonicIndexManager,
  baseDir: string
): Promise<DistillationResult>;

// 规则一: T2→T3 (≥3 条相似叙事)
//   1. 分组 T2: 按 primary_abstraction 前 3 词排序后分组
//   2. 每组 ≥3 条 → 创建 T3 HarmonicUnit
//      - primary_abstraction = A | B | C
//      - cue_anchors = dedup(all)
//      - memory_value = A\n---\nB\n---\nC
//      - energy = avg + 0.1 (max 1.0)
//      - merged_from = [旧 ID 列表]
//   3. 写入 tier3/{goalId}.json
//   4. 旧 T2 锁定 energy = 0.4 (updateEnergy(oldId, -0.5))

// 规则二: T4→L5 (≥5 次成功流程) — 预留
```

### 5. MinHash 跨层合并

```typescript
class MinHashMerger {
  generateSignature(text: string): number[];
  // 3-gram 分片 → 4 个多项式哈希 → 取最小值 → signature[4]

  similarity(sigA: number[], sigB: number[]): number;
  // 匹配位置数 / 4

  merge(unit: HarmonicUnit, tier: string,
        indexManager: HarmonicIndexManager,
        baseDir: string): Promise<HarmonicUnit>;
  // 遍历 index → 对每个 entry 计算 signature 相似度
  // >0.6 → 合并:
  //   - primary_abstraction 拼接
  //   - cue_anchors dedup
  //   - memory_value 拼接
  //   - energy +0.15
  //   - merged_from 记录
  //   - 旧 entry 从 index 移除
}
```

## 压缩管线

### 完整流程

```
T1 Raw Observations (来自 mafw_observe)
    │
    ├── [Deduplicate]
    │     SHA-256(content) → 5 分钟窗口去重
    │
    ├── [Privacy Filter]
    │     正则替换: JWT / API Key / Password / Email / IP
    │
    ├── [Classify]
    │     按 type 分组: tool_use / file_edit / llm_call / error / state_change
    │
    ├── [Strategy Select]
    │     ├─ all file_edits      → diff 策略
    │     ├─ pattern match >80%  → zero-token 策略
    │     ├─ <3 simple items     → template 策略
    │     └─ default             → hybrid 策略 (v6.3)
    │
    ├── [Hybrid Compress] (v6.3)
    │     ├─ 能量门控: 仅处理 energy > 0.6 的观察
    │     ├─ 调用 Gateway POST /api/llm/compress
    │     │    ├─ 成功 → 解析 LLM 返回 → 构建 HarmonicUnit
    │     │    └─ 失败 → 规则回退 (正则概念提取)
    │     ├─ calculateSalience()  (v6.4)
    │     ├─ persistUnit()
    │     │    ├─ 写入 tier2/tier3/tier4 JSON 文件
    │     │    ├─ HarmonicIndexManager.addEntry()
    │     │    └─ MinHashMerger.merge()  (v6.3)
    │     └─ 返回 HarmonicUnit
    │
    └── [Merge]
          Jaccard 相似度 > 0.85 同层合并
```

## 状态机

### LoopStateMachine — 12 状态

```
IDLE → PLANNING → WAVE_READY → EXECUTING → WAVE_CHECK → REVIEWING → VERDICT
                    ↑              │            │              │
                    │         ┌────┴────┐   ┌──┴───┐        ┌─┴─┐
                    │         │WAVE    │   │more  │        │auto│
                    │         │RETRY   │   │waves │        └─┬─┘
                    │         └────┬────┘   └──┬───┘         │
                    │              │           │       ┌─────┼─────┐
                    │         ┌────┴────┐   ┌──┴───┐   │     │     │
                    │         │ WAVE   │   │WAVE  │  PASS  FAIL  PARTIAL
                    │         │ READY  │   │CHECK │         │     │
                    │         └────────┘   └──────┘    LOOP_RESET WAVE_RETRY
                    │                                       │
                    └───────────────────────────────────────┘
                                  (回到 PLANNING)
```

| 当前状态 | 事件 | 条件 | 下一状态 | 动作 |
|---|---|---|---|---|
| IDLE | goal.create | — | PLANNING | 初始化 Loop 1 |
| PLANNING | plan.complete | — | WAVE_READY | 写入 waves.json |
| WAVE_READY | deps.satisfied | 有 READY Wave | EXECUTING | 分配 Agent |
| EXECUTING | wave.complete | 还有未执行 Wave | WAVE_CHECK | 更新状态 |
| EXECUTING | wave.complete | 全部完成 | REVIEWING | 触发 Review |
| EXECUTING | wave.fail | retry < max | WAVE_RETRY | 重试 |
| EXECUTING | wave.fail | retry >= max | LOOP_RESET | 回滚 Checkpoint |
| WAVE_CHECK | moreWaves | 有 READY Wave | WAVE_READY | — |
| WAVE_CHECK | noMoreWaves | 无 READY/RUNNING | REVIEWING | 触发 Review |
| REVIEWING | review.complete | — | VERDICT | 解析 |
| VERDICT | auto | score≥85 (v6.0) | PASS | 归档 Goal |
| VERDICT | auto | score<85 或 FAIL | FAIL | 新 Loop |
| VERDICT | auto | PARTIAL | PARTIAL | 重试失败 Wave |
| LOOP_RESET | auto | — | PLANNING | 重置 |
| WAVE_RETRY | auto | — | WAVE_READY | 重置 Wave |

## 数据流全景

### Goal 从创建到完成

```
用户输入 "/goal 设计登录系统"
    │
    ▼
Goal Agent (Interview)
    │ 追问 → 明确指标 → 确认 → 写入 requests/{id}.json + goals/{id}.md
    ▼
Gateway Scheduler 轮询发现 nextAction='CREATE_PLAN_SESSION'
    │
    ▼
Plan Agent
    │ 读取 Goal Charter + L2 Lessons + L3 Δ
    │ 输出 waves.json + tasks/{id}.md
    │ 写入 state → nextAction='CREATE_EXECUTE_SESSION'
    ▼
Execute Agent (逐 Wave)
    │ 读取 Task 定义 + L3 约束
    │ 编写代码 → 提交 → 生成 Receipt
    │ 每 Wave 完成后更新 state
    ▼
Review Agent
    │ 读取 Receipt + Diff + Goal Charter
    │ 输出 Review 报告 (含 SCORE)
    │ 状态机路由: PASS→归档 / FAIL→新Loop
    ▼
Memory Extractor (仅 FAIL 时)
    │ 从 Review 失败 → 提取 Δ 约束
    │ 写入 parametric/
```

### Tool 调用数据流

```
Agent 调用 mafw_search_hybrid
    │
    ▼
Plugin tool handler
    │
    ├── HarmonicIndexManager.search()
    ├── CognitiveGraphManager.addConnection()
    ├── CostEstimator.recordToolCall()
    ├── persistCosts() → SQLite + JSON
    │
    ▼
Tool 响应返回 Agent
```

### 压缩数据流

```
Agent 执行 Tool → Hook tool.execute.after
    │
    ├── observation-deduplicator (SHA-256 去重)
    ├── privacy-filter (JWT/Key 脱敏)
    │
    ▼
CompressionPipeline.process()
    │
    ├── classifier → 分组
    ├── strategy-selector → 选策略
    ├── HybridCompressor.compress()
    │    ├── Gateway LLM 或规则回退
    │    ├── HarmonicUnit 输出
    │    ├── calculateSalience()
    │    └── persistUnit() → tier 文件 + 索引 + MinHash 合并
    │
    └── merge similar → 返回合并后记忆
```

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

### 当前测试分布

| 测试组 | 数量 |
|---|---|
| 谐波索引 (harmonic-index) | 4 |
| MinHash (minhash-merger) | 3 |
| 认知图 (cognitive-graph) | 5 |
| 显著度 (salience-perceptor) | 3 |
| 间隔复习 (review-scheduler) | 9 |
| 抽象蒸馏 (abstraction-distiller) | 4 |
| 混合压缩 (hybrid-compressor) | 3 |
| 压缩管线 (compression-pipeline) | 34 |
| 能量系统 (energy-system) | 8 |
| Token 分配 (token-budget-allocator) | 15 |
| 状态机 (loop-state-machine) | 20+ |
| **总计** | **483 tests, 57 suites** |

当前：**57 suites，483 tests，100% 通过**。
