# MAFW 谐波记忆系统偏差全量修正计划

> 状态：已规划，待执行
> 范围：谐波记忆系统文档↔实现全量对齐
> 触发：LongMemEval 基准（L1 R@10=47.4%, L2=16.7%）暴露当前检索器与文档宣称不一致，文档-实现偏差审查发现 34 个条目

## 1. 目标

把 MAFW 谐波记忆系统从"文档宣称 vs 实际实现"的偏差状态修正为**文档与实现对齐**，并通过 LongMemEval 基准量化检索质量提升。具体：

1. **核心检索器对齐 AGENTS.md §3.2 设计**：将 `HarmonicIndexManager.search()` 从"token 子串计数×energy"升级为"BM25×energy 评分"——**不新增持久化索引文件**（对齐原文档"BM25 扫描 .harmonic_index.json"的查询时计算语义）
2. **修复 5 个高影响生产缺陷**：
   - split-brain（MCP handler vs HTTP 写不同存储）
   - 能量永不衰减（自动化引擎伪值导致 no-op）
   - `global` 类型写必崩（okf-writer 抛异常）
   - `/merge-memory` CLI 命令 404（gateway 无路由）
   - MinHash 跨层合并从未触发（merge() 死方法）
3. **修正 9 项纯文档偏差**（代码是对的，文档超前/错误/过期）
4. **明确承认未实现功能**（`top_associations` 联想预取 / `review_count` / 复习队列消费者 / 访问能量加成）：改文档标注休眠，避免持续误导

## 2. 现状与决策回顾

### 2.1 检索器现状（核心动机）

`gateway/src/core/memory/harmonic-index.ts:87-115` 的 `search()`：

```typescript
search(query, topK = 20) {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = this.index.entries.map(entry => {
    const text = (entry.primary_abstraction + ' ' + entry.cue_anchors.join(' ')).toLowerCase();
    let score = 0;
    for (const token of tokens) {
      const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.matches.length;   // 子串计数
    }
    return { entry, score: score * entry.energy };
  });
}
```

AGENTS.md §3.2 宣称："查询 → BM25 扫描 .harmonic_index.json（无视 memory_type）→ 按 energy × BM25 排序"。

**结论**：文档原意是"查询时对内存中的 entries 用 BM25 公式打分"——和现有实现是同一个数据结构、同一个循环结构，只是把 score 公式从子串计数换成 BM25。**不需要新增 `.bm25_index.json`、不需要 serialize/deserialize、不需要损坏重建路径**。

### 2.2 已确认的决策（来自前几轮对话）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 持久化 | **不新增独立索引文件**（对齐文档"BM25 扫描 .harmonic_index.json"） | 查询时计算够快（75-1000 entries 毫秒级），无损坏风险，零存储迁移 |
| 默认 retriever | **保持 token**，BM25 opt-in | 不破坏生产 agent 推理路径（recall/step-inject/MCP/LangChain）；benchmark 验证后再决定切换 |
| Legacy MCP (`core/mcp/tools.ts:255-323`) | **加 TODO 注释**，本 plan 不清理 | 控制 scope |
| 修正范围 | **全量**（Phase 0+1+2+3） | 用户选择全量修正 |
| 能量衰减修复 | **修复**（用户确认） | 真实 `updated_at` 计算 + 默认每日 decay 规则 + 访问加成语义修正 |
| MinHash 合并 | **接入写路径**（用户确认） | 防递归设计；与 BM25 并行不冲突 |

### 2.3 全量偏差清单（34 项，来自子代理审查）

| 类型 | 数量 | 影响 |
|---|---|---|
| 纯文档修正（代码对） | 9 | 低（文档美化） |
| 高影响代码修正（生产缺陷） | 6 | 高 |
| 检索器 BM25 改造 | 1 核心 + 4 周边 | 高（基准验证驱动） |
| 中低优代码修正 | 4 | 中 |
| 彻底未实现功能（默认标注休眠） | 4 | 中 |

---

## 3. 分阶段实施计划

### Phase 0：纯文档修正（代码是对的）

低风险，~30 分钟。先把能纯文档解决的清掉，避免后续阶段被这些噪音阻塞。

| # | 修正 | 文件 | 证据 |
|---|---|---|---|
| 0.1 | `memory_type` → `type`（代码/SDK/OKF 全用 type） | `AGENTS.md §3.1` | `harmonic-types.ts:3`、SDK `types.ts:65`、`okf-writer.ts:8` |
| 0.2 | §4 工具表"14 个"→ 35 个，补全表格 | `AGENTS.md §4` | `tool-registry.ts:8-489`（实际 35 个） |
| 0.3 | `goal_id` 标注"历史兼容字段，写路径不写" | `AGENTS.md §3.1` | 当前所有写路径均不写，全代码无读取 |
| 0.4 | `salience` 标注"仅记录不参与排序" | `AGENTS.md §3.1` | index entry 不存 salience（`harmonic-index.ts:38-49`），automation-engine `(entry as any).salience` 恒 undefined |
| 0.5 | 日志路径区分：插件 `<project>/.mafw/logs` vs 网关 `~/.mafw/logs` | `AGENTS.md §5.4/§6.2` | `src/utils/logger.ts:8-47`、`core/utils/logger.ts:5-15` |
| 0.6 | §5.11 四拍表重写为实际机制 | `AGENTS.md §5.11` | 实际 hook 列表见 `src/plugin.ts:183-211` + daemon `index.ts:686-711` |
| 0.7 | §5.13a 迁移范围：只迁 gateway 包目录 `.mafw` | `AGENTS.md §5.13a` | `data-dir-migrate.ts:21-96`（源是 `<gateway包>/../.mafw`） |
| 0.8 | `top_associations` / `review_count` / `last_reviewed` / 访问加成 标注"未实现/休眠" | `AGENTS.md §3.1` | 仅类型声明（`harmonic-types.ts:15-17`），全仓库零读写 |
| 0.9 | SDK `memory_type` → `type`（若 SDK 已用 type 则跳过） | `opencode-dev/packages/gateway-sdk/src/types.ts` | 对齐代码 |

### Phase 1：高影响代码修正（生产缺陷）

按风险从低到高排列；先做不会改变生产行为的（1.1-1.3），再做会改变行为的（1.4 能量）。

#### 1.1 split-brain 修复（缺陷 #17）

**问题**：MCP handler 写 `projectDir/.mafw`，插件 tool 走 HTTP 写 `~/.mafw`，agent 两条路径写入的记忆**互不可见**。

**修正文件**：
- `gateway/src/mcp/handlers/add-memory.ts:21-47`（改用 `config.resolvePath()`）
- `gateway/src/mcp/handlers/merge-memory.ts:22-23`
- `gateway/src/mcp/handlers/get-deltas.ts:13-34`
- `gateway/src/mcp/handlers/ask-user.ts:16`

**验证**：MCP 写入 → `~/.mafw/memory/` 可见；`/api/memory/search` 能搜到；与插件 HTTP 路径结果一致。

#### 1.2 `global` 类型支持（缺陷 #7）

**问题**：`getOKFDirectory()` 对 global `throw new Error('unknown type global...')`（`okf-writer.ts:36-42`），但 schema 允许 agent 传 `memoryType='global'`，写入必崩。

**修正**：
- `gateway/src/memory/okf-writer.ts:36-42` 加 `global → 'concepts/global'` 分支（与 semantic 同构）
- `gateway/src/core/memory/harmonic-index.ts:41` 兼容映射确认（已有兜底 `(unit as any).memory_type`）
- `config.memory.defaultTier` 加 global 项

**验证**：写 `memoryType='global'` 记忆不抛；OKF 文件落到 `concepts/global/`。

#### 1.3 `/api/merge-memory` 路由补齐（缺陷 #19）

**问题**：插件 `src/plugin.ts:253` POST `/api/merge-memory`，gateway 无此路由，必然 404。

**修正**：
- `gateway/src/index.ts` 补 `POST /api/merge-memory`（复用 MCP `merge-memory.ts` 的 merge 逻辑）
- 接收 `{ sourceProjectDir, targetProjectDir, strategy }`，调 `MinHashMerger.merge()` + 写融合结果

**验证**：插件 `/merge-memory` 命令可用；融合记录写入 `fusion-log.jsonl`。

#### 1.4 能量衰减修复（缺陷 #30，敏感——会改变生产行为）

**问题**：
- `automation-engine.ts:61` `daysSinceUpdate = entry.energy > 0 ? 1 : 0`（伪造值）
- 净变化 = -0.01+0.02 = **+0.01**，`diff > 0.005` 永不成立 → `updateEnergy` 永不触发
- 且无默认 `memory:decay` 规则

**修正**：
1. `gateway/src/automation/automation-engine.ts`:
   - `daysSinceUpdate` 用真实 `updated_at`（`(now - new Date(entry.updated_at).getTime()) / 86400000`
   - 衰减路径 vs 访问路径分离（`decayed` vs `accessed` 事件标签）
2. `gateway/src/automation/pipeline-rules.ts`:
   - 加默认规则 `memory:decay`（每日 UTC 3:30，与 reflection 错开）
   - action 调用 `energy-system.decay()` 或 `indexManager.updateEnergy(id, -0.005*days)`
3. **衰减率统一到 0.005/天**（与 LongMemEval eval + AGENTS.md §10 一致）：
   - `gateway/src/core/compression/energy-system.ts:42` 当前 `0.01` → 改为 `0.005`
   - 删除 `energy-calculator.ts`（死代码，`calculateEnergy` 从未被调用）
4. 访问加成语义修正：仅 `search()` 真实返回的 entry +0.02（上限 0.3）；当前 automation 把所有事件标 'retrieved' 是错的

**验证**：
- 单测：构造 100 条 entry，7 天后 energy 下降 ~3.5%
- 单测：访问 5 次同一条 → energy 上限 +0.1（不超过 0.3）
- 单测：1000 条 entry 每日衰减 ≤ 100ms

**风险提示**：修复后记忆真的开始衰减。**LongMemEval 基准的 frozen energy=0.8 默认模式不受影响**（基准是 tmpDir 隔离的确定性摄入）。生产 agent 的 memory 排序会缓慢漂移——预期是好的（陈旧记忆自然下沉）。

#### 1.5 MinHash 合并接入写路径（缺陷 #12/33）

**问题**：`MinHashMerger.merge()` 是死方法（`minhash-merger.ts:43-91`），写路径不触发，§3.3 宣称的"自动跨层合并检查"不存在。

**修正**：
- `gateway/src/memory/harmonic-file-store.ts` `write()` 末尾（WriteQueue 内部）：
  ```typescript
  await this.minhashMerger.checkAndMerge(unit); // 防递归：unit.merged_from 已设则跳过
  ```
- `MinHashMerger.checkAndMerge(unit)`:
  - 用 `generateSignature(unit.memory_value)` 算 MinHash
  - 与 `getIndex().entries` 中最近 N 条比对（不与全量比，避免 O(N²)）
  - similarity > 0.6 → 合并（更新旧 unit 的 `merged_from`，移除旧 entry，写新 entry）
- 防递归：`unit.merged_from?.length` 时跳过合并检查

**验证**：
- 单测：写两条 90% 相似 → 触发合并 → 索引中条目数减少
- 单测：写两条不相似 → 不合并
- 跑 LongMemEval L1 baseline 确认不变（基准 tmpDir 隔离）
- 跑 LongMemEval L1 + 故意构造相似记忆 → 验证合并后检索命中率

**风险提示**：合并改变已写记忆 ID；任何依赖记忆 ID 稳定性的下游（reflection、reflect-cursor、recall step-inject 的 pushed 登记）需重新评估。

#### 1.6 archive-worktree 读 OKF+index（缺陷 #20）

**问题**：`archive-worktree.ts:80-86` 读已废弃 `memory/memories.json`，data-dir-migrate 会删除该格式 → 实际恒返回 0 条。

**修正**：
- `gateway/src/worktree/archive-worktree.ts` 改用 `HarmonicIndexManager.getIndex().entries` 读
- 按需 `store.read(id)` 加载 memory_value
- 与 MCP `merge-memory` handler 共享读取逻辑

**验证**：worktree 融合不再恒 0 条；融合日志记录实际条目数。

### Phase 2：检索器 BM25 改造（核心，本次重点）

**核心洞察**：原文档 "BM25 扫描 .harmonic_index.json" = 查询时对内存 entries 用 BM25 公式打分。现有 search() 结构不变，只换评分函数。

#### 2.1 核心改动：`harmonic-index.ts` 加 bm25Search()

`gateway/src/core/memory/harmonic-index.ts`（唯一核心改动，~50 行）：

```typescript
search(query: string, topK: number = 20, options?: { retriever?: 'token' | 'bm25' }): HarmonicIndexEntry[] {
  const retriever = options?.retriever ?? this.defaultRetriever; // 默认 token（来自 config 或 hardcoded 'token'）
  if (retriever === 'bm25') {
    try {
      return this.bm25Search(query, topK);
    } catch (err) {
      console.error('[HarmonicIndexManager] BM25 search failed, falling back to token:', err);
      return this.tokenSearch(query, topK);
    }
  }
  return this.tokenSearch(query, topK);
}

private tokenSearch(query: string, topK: number): HarmonicIndexEntry[] {
  // 原 harmonic-index.ts:87-115 的实现，保留不变
}

private bm25Search(query: string, topK: number): HarmonicIndexEntry[] {
  const queryTokens = this.tokenize(query); // 小写 + 切分 + 过滤短词
  if (queryTokens.length === 0) return [];

  const N = this.index.entries.length;
  if (N === 0) return [];

  // 1. 一次遍历所有 entries：计算每 entry 的 docLength + 每 term 的 df + 每 entry 的 tf
  const docFreq = new Map<string, number>();   // term -> 多少 doc 包含
  const docLens: number[] = [];                 // per-entry token count
  const entryTokens: string[][] = [];           // per-entry token list（用于 tf）
  
  for (const entry of this.index.entries) {
    const text = (entry.primary_abstraction + ' ' + entry.cue_anchors.join(' ')).toLowerCase();
    const tokens = this.tokenize(text);
    docLens.push(tokens.length);
    entryTokens.push(tokens);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }
  const avgDocLen = docLens.reduce((a, b) => a + b, 0) / N;
  const k1 = 1.2, b = 0.75;

  // 2. 对每个 query token 算 idf
  const idfs = new Map<string, number>();
  for (const qt of queryTokens) {
    const df = docFreq.get(qt) ?? 0;
    // 标准 BM25 IDF（Robertson-Sparck Jones）
    idfs.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  // 3. 算每 entry 的 BM25 score
  const scored = this.index.entries.map((entry, i) => {
    let score = 0;
    const tokens = entryTokens[i];
    const dl = docLens[i];
    const tf = (term: string) => {
      let c = 0;
      for (const t of tokens) if (t === term) c++;
      return c;
    };
    for (const qt of queryTokens) {
      const t = tf(qt);
      if (t === 0) continue;
      const numerator = t * (k1 + 1);
      const denominator = t + k1 * (1 - b + b * (dl / avgDocLen));
      score += idfs.get(qt)! * (numerator / denominator);
    }
    return { entry, score: score * entry.energy };  // 对齐文档"energy × BM25 排序"
  });

  const results = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry);

  this.hookManager?.execute('memory.recall', {
    query, resultIds: results.map(r => r.id), source: 'HarmonicIndexManager.bm25Search',
  });

  return results;
}

private tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  // 与原 tokenSearch 一致；对中文（无空格）无效是已知限制，第一版不动
}
```

**关键设计决定**：
- `defaultRetriever` 第一版直接 hardcode `'token'`（config 加字段后续做），保持零破坏
- `try/catch` 包 bm25 → fallback to token（防御性，即使 tokenize 失败也不抛）
- `tokenize` 函数独立出来供两分支共用（保持分词一致）
- 不持久化任何 BM25 状态（docFreq/avgDocLen 每次查询现算）
- 性能：1000 entries × 平均 30 tokens = 30k 分词，单次查询 < 50ms（满足 benchmark runner 要求）
- 如果 benchmark 后性能不达标，再加内存级 termFreq 缓存（不持久化）

#### 2.2 周边改动

| 文件 | 改动 |
|---|---|
| `gateway/src/core/memory/harmonic-types.ts` | （无需改动） |
| `gateway/src/index.ts` `/api/memory/search` | 加 `?retriever=bm25|token` query param（默认从 query param 缺省到 token） |
| `gateway/src/mcp/tool-registry.ts:44-56` `mafw_search_hybrid` schema | 加 `retriever` 字段 |
| `gateway/src/mcp/handlers/search-hybrid.ts` | 透传 `retriever` 参数 |
| `gateway/src/core/langchain/retriever.ts` `HarmonicIndexLike` 接口 | 加 `retriever?` 字段（接口扩展，向后兼容） |
| `gateway/src/core/langchain/memory.ts` | 同上 |
| `gateway/src/core/mcp/tools.ts:255-323` | 加 TODO 注释，本 plan 不清理 |
| `opencode-dev/packages/gateway-sdk/src/client.ts` | `MemorySearchOptions.retriever?` 字段 |
| `evaluation/longmemeval/src/l1-retrieval.ts` | `--retriever token|bm25`（默认 token 不污染 baseline） |
| `evaluation/longmemeval/src/l2-qa.ts` | `--retriever` 参数 |
| `evaluation/longmemeval/src/report.ts` | 追加 BM25 section（不覆盖 baseline） |
| `tests/unit/gateway/bm25-harmonic-search.test.ts` | 新增：排序正确性、空 query、TF/IDF 差异、与 token 分支对比、性能基线 |

#### 2.3 验证门槛

| 指标 | 阈值 | 决策 |
|---|---|---|
| L1 session 粒度 R@10 | ≥ 0.55（baseline 0.474 + ≥ 15% 相对提升） | 不达标不切默认 |
| 提升的类数（per-type R@10 严格 > baseline） | ≥ 4 / 6 | 防"一类大涨掩盖整体" |
| L2 accuracy | ≥ 0.22（baseline 0.167 + ≥ 30% 相对提升） | 不达标不切换默认 |
| 性能（1000 entries，100 次 search） | 中位数 ≤ 100ms | 不达标加内存缓存 |
| 现有单测 | 100% pass | 不回归 |

### Phase 3：中低优代码修正 + 未实现功能处理

#### 3.1 代码修正

| # | 修正 | 文件 | 风险 |
|---|---|---|---|
| 3.1 | askUser 扁平化：去 goalId 目录 + schema required 移除 | `ask-user.ts:16` + `tool-registry.ts:93` | 中（影响 agent 调用形态） |
| 3.2 | MCP search 结果加载 memory_value | `search-hybrid.ts:15` | 低 |
| 3.3 | abstraction_level 映射统一（procedural→2, global→3, 去除越界 4） | `add-memory.ts:40` + `index.ts:3875` + `hybrid-compressor.ts:80` + `reflection.ts:168` | 低 |
| 3.4 | salience 参与排序（×energy 加权） | `automation-engine.ts:60` + `harmonic-index.ts:91` | 低 |

#### 3.2 彻底未实现功能（默认文档标注休眠，不实现）

| 功能 | 决策 | 理由 |
|---|---|---|
| `top_associations` 联想预取 | 文档标注休眠 | 设计/收益未知，大工程 |
| `review_count`/`last_reviewed` 复习队列消费者 | 文档标注休眠 | 需补消费者，中等工程 |
| 检索访问能量加成 | 文档标注休眠 | 等 Phase 1.4 完成后观察行为再决定 |

---

## 4. 触动文件清单（最终）

| 类别 | 文件数 | 列表 |
|---|---|---|
| **核心** | 1 | `harmonic-index.ts`（BM25 改造唯一核心） |
| **gateway 主路径** | 4 | `index.ts`、`config.ts`、`automation/automation-engine.ts`、`automation/pipeline-rules.ts` |
| **gateway 周边** | 6 | `okf-writer.ts`、`harmonic-file-store.ts`、`memory/energy-system.ts`、`worktree/archive-worktree.ts` |
| **MCP/LangChain** | 5 | `tool-registry.ts`、`handlers/search-hybrid.ts`、`handlers/add-memory.ts`、`handlers/merge-memory.ts`、`handlers/get-deltas.ts`、`handlers/ask-user.ts`、`core/langchain/retriever.ts`、`core/langchain/memory.ts`（实际 8 个，加 TODO 的 `core/mcp/tools.ts` 算半个） |
| **Benchmark** | 3 | `l1-retrieval.ts`、`l2-qa.ts`、`report.ts` |
| **SDK** | 1 | `gateway-sdk/src/client.ts` |
| **测试** | 1 新增 | `bm25-harmonic-search.test.ts`（既有单测保持不破坏） |
| **文档** | 3 | `AGENTS.md §3.1/§3.2/§4/§5.4/§5.11/§5.13a`（多个段落）、`evaluation/README.md`、`docs/architecture/plugin.md`（可选） |
| **Legacy TODO** | 1 | `core/mcp/tools.ts`（注释不改逻辑） |
| **删除（死代码）** | 1 | `energy-calculator.ts`（被 `energy-system.ts` 取代） |
| **合计** | ~22 文件 | （之前方案 B 是 15 文件，但持久化方案复杂度更小；当前方案更直接） |

---

## 5. 执行顺序

| # | 阶段 | 内容 | 验证 |
|---|---|---|---|
| 1 | Phase 1.1 | split-brain 修复 | MCP 写入 → `~/.mafw` 可见 + 单测 |
| 2 | Phase 1.2 | global 类型 | 单测 + curl |
| 3 | Phase 1.3 | `/api/merge-memory` 路由 | 单测 + curl |
| 4 | Phase 1.4 | 能量衰减（敏感） | 单测（7 天衰减 ~3.5%）+ 真实 updated_at 验证 |
| 5 | Phase 1.5 | MinHash 写路径 | 单测 + LongMemEval baseline 不变 |
| 6 | Phase 1.6 | archive-worktree OKF 读取 | 单测 |
| 7 | Phase 2.1 | BM25 核心（harmonic-index.ts） | `bm25-harmonic-search.test.ts` pass + 既有 token 测试不破 |
| 8 | Phase 2.2 | 周边（index.ts/schema/langchain/runner） | `tsc --noEmit` + `npx jest` |
| 9 | Phase 0 | 文档修正（穿插在 1-8 间） | diff 审查 |
| 10 | Phase 2 验证 | LongMemEval BM25 ablation | R@10 ≥ 0.55 / 类数 ≥ 4 / L2 ≥ 0.22 |
| 11 | Phase 3 | 中低优 + 未实现标注 | 单测 |

每步跑 `npx jest tests/unit/` 相关文件确认不回归。

---

## 6. 风险与回滚

| 风险 | 等级 | 触发 | 回滚 |
|---|---|---|---|
| 能量衰减改变生产行为 | 中 | Phase 1.4 后 agent 记忆排序缓慢漂移 | `pipeline-rules.ts` 删默认规则 + 恢复 `energy-system.ts:42 = 0.01`（不改 0.005） |
| MinHash 合并改 ID | 中 | Phase 1.5 后下游 ID 依赖（reflection/reflect-cursor） | `minhash-merger.ts` 加 `enabled` 开关，config 默认 false |
| BM25 search 性能回归 | 低 | 1000+ entries 场景 | 加内存 termFreq 缓存（不持久化） |
| 默认 retriever 切换后 agent 行为漂移 | 中 | （本 plan 不切默认） | env `MAFW_SEARCH_DEFAULT_RETRIEVER=token` 一键切回 |
| split-brain 修复破坏 MCP 现有用户 | 中 | Phase 1.1 后 MCP 用户记忆存储位置变化 | git revert 单文件 |
| gateway 全局包回滚 | 低 | 任何阶段需要紧急回滚 | `npm install -g opencode-plugin-mafw@<prev>` |

**关键保险**：
- BM25 第一版默认 token，opt-in 验证
- 能量衰减修复前先在 gateway 测试环境跑 24 小时观察
- MinHash 合并加 config 开关默认 off，验证后再开

---

## 7. 不做的范围（明确排除）

- ❌ L3 端到端 agent 测评（独立轨道）
- ❌ 实现 `top_associations` 联想预取 / 复习消费者（默认文档标注休眠）
- ❌ 杠杆 3（time-aware query expansion）/ 杠杆 4（dense+sparse RRF 融合）
- ❌ Legacy `core/mcp/tools.ts` 清理（仅 TODO）
- ❌ `mcp/tool-registry.ts` `policy` schema 撒谎修复（保留 field，与 retriever 并列）
- ❌ `memory_value` 字段替换（search 不看）
- ❌ 检索器默认切换 retriever（保持 token，benchmark 通过后再讨论）
- ❌ 中文分词优化（split(/\s+/) 对中文无效是已知限制，独立优化项）

---

## 8. 文档同步清单

完成后需同步：

| 文档 | 段落 | 变更 |
|---|---|---|
| `AGENTS.md §3.1` | HarmonicUnit | `type` 字段名、goal_id/salience/review_count 标注历史/休眠、top_associations 未实现 |
| `AGENTS.md §3.2` | 检索 | 改写为"默认 token，opt-in bm25，BM25 公式说明，k1/b 参数" |
| `AGENTS.md §3.3` | 压缩 | MinHash 自动合并已接入（不再"宣称未实现"） |
| `AGENTS.md §4` | 工具表 | 14 → 35，`mafw_search_hybrid` 加 retriever 字段 |
| `AGENTS.md §5.4` | 日志路径 | 区分插件 vs 网关 |
| `AGENTS.md §5.11` | 四拍表 | 重写为实际 hooks |
| `AGENTS.md §5.13a` | 迁移范围 | 实际只迁 gateway 包目录 |
| `AGENTS.md §10` | 能量衰减 | 0.005/天统一；真实 updated_at 计算；访问加成语义 |
| `evaluation/README.md` | §3 BM25 ablation | 加 L1/L2 对比表、验证门槛、Phase 2 baseline+ablation 数字 |
| `docs/architecture/plugin.md` | `mafw_search_hybrid` | 重写 10 步流程（可选） |

---

## 9. 后续联动（plan 完成后启动）

1. **杠杆 2（key expansion）实验 runner**：LLM 提取 user facts → 追加到 cue_anchors → 跑 `bm25 alone` vs `bm25 + key expansion` 对比
2. **`single-session-assistant` 检索修复**：当前 R@10=0%，BM25 不救；需 query rewriting（杠杆 2 子任务）
3. **`temporal-reasoning` 检索增强**：当前 R@10=43.8% NDCG@10=22.7%，BM25 应改善 NDCG；杠杆 3 time-aware 可进一步提升
4. **杠杆 4 dense+sparse RRF**：长期方向，需引入 embedding model
5. **MafwShell 桌面端的 MemoryExplorer UI**：当前无 retriever 选择 UI；SDK 类型补齐后前端跟进
6. **LongMemEval 全量 500 题**跑一遍（当前 48 题子集）

---

## 10. 关键文件路径速查

| 路径 | 用途 |
|---|---|
| `gateway/src/core/memory/harmonic-index.ts` | 检索核心（Phase 2 唯一大改） |
| `gateway/src/core/memory/harmonic-types.ts` | HarmonicUnit 接口 |
| `gateway/src/memory/harmonic-file-store.ts` | 写路径（Phase 1.5 MinHash 合并接入点） |
| `gateway/src/memory/okf-writer.ts` | OKF 文件写入（Phase 1.2 global 分支） |
| `gateway/src/core/compression/energy-system.ts` | 活跃能量计算（Phase 1.4 改 0.005） |
| `gateway/src/automation/automation-engine.ts` | 自动化引擎（Phase 1.4 修 daysSinceUpdate） |
| `gateway/src/automation/pipeline-rules.ts` | 默认规则（Phase 1.4 加 memory:decay） |
| `gateway/src/worktree/archive-worktree.ts` | 跨 worktree 融合（Phase 1.6） |
| `gateway/src/mcp/handlers/add-memory.ts` | MCP 写路径（Phase 1.1 split-brain） |
| `gateway/src/index.ts` | HTTP 路由 + /api/merge-memory + /api/memory/search |
| `evaluation/longmemeval/src/l1-retrieval.ts` | L1 runner |
| `evaluation/longmemeval/src/l2-qa.ts` | L2 runner |
| `evaluation/longmemeval/results/<ts>/l1-run.jsonl` | 基准结果数据 |
| `tests/unit/gateway/bm25-harmonic-search.test.ts` | 新增 BM25 测试 |
| `AGENTS.md §3.1/§3.2/§4/§5.x/§10` | 文档同步目标 |

---

**计划就绪，等待确认开始执行。建议从 Phase 1.1（split-brain 修复）开始**，逐步到 Phase 2 BM25 验证，最后 Phase 0/3 文档与中低优收尾。
