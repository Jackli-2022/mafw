# D5 PPR 图检索 + CATD 拓扑承重衰减 设计

> 日期：2026-10-09 ｜ 路线图：Phase G（`2026-10-08-brain-like-roadmap.md` §2 D5）
> 外部验证：EngramRAG（arXiv:2609.32049）——U-PPR + CATD + 三源 RRF，LoCoMo R@5 +38.9% vs dense；
> REALM（arXiv:2609.16053）——检索反馈应重组局部图结构（D2 只改文本的下一步）。
> 测量面：LongMemEval session 粒度 R@10（基线 0.949），重点短板 **multi-session 0.375**。

## 1. 问题

现有检索三源：BM25（词汇）+ dense embedding（语义）+ R3 rerank。两者都是**点估计**——
查询词与单条记忆的相似度。跨会话多跳问题（"我上次修 embedding 超时是怎么办的"→
需要「embedding 超时」→「llamacpp sidecar」→「-cram 0 旗标」的链式联想）只能靠
查询扩展多次 BM25 近似，昂贵且浅（expansionMaxSearches=4）。

图基建已存在：`AnchorGraphStore`（SQLite `anchor_units`/`anchor_edges`，共享 cue_anchors
建边，边权=共享锚点 IDF 和）——但目前只服务 R6 邻居**呈现**，未进检索排序。

同时能量衰减只看 salience（`decayRateFor`），不看**拓扑承重**：一条被 50 条记忆
共享锚点依赖的 hub 条目与一条孤立条目同速衰减——EngramRAG 的 CATD 证明这是错的
（应按拓扑承重度缩放半衰期）。

## 2. 设计

### 2.1 U-PPR（统一 Personalized PageRank）检索源

```
查询 → BM25 top-8 命中（seed 集，query-aware 个性化向量）
     → PPR 迭代：p ← (1-α)·Ŵ·p + α·seed      （α=0.15，20 次或收敛 1e-6）
     → 转移权重 Ŵ：边权 × Hebbian 调制 × (1+ln(1+need7d(target)))
     → 得图扩散分 → RRF(k=60) 与 BM25/dense 三源融合
```

- **seed 必须 query-aware**（BM25 top 命中），不是静态枢纽——静态 `top_associations`
  已于 2026-09-29 删除（query-blind 链接是噪音源，arXiv:2606.30133），PPR 的个性化
  向量天然满足此约束
- **Hebbian 调制**：目标节点 7 天检索命中数（RetrievalEventBuffer，ACT-R 既有基建）
  提升转入概率——被频繁联想的通路更容易再次被走到（U-PPR 的 "plasticity"）
- **Epistemic Macro-Hub 抑制**：度 > 阈值（默认 95 分位）的节点转移概率除以
  log(degree)——hub 是通路不是终点（EngramRAG 的 hub 处理）
- 实现位置：`gateway/src/graph/ppr.ts`（纯函数：邻接表 + seeds + 参数 → 分数映射）
- **融合**：`searchScored({ denseScores, pprScores })`，RRF 第三源；
  `search.ppr` 配置开关（默认 **off**，先在快照路径验证）

### 2.2 挂点（分两阶段）

| 阶段 | 挂点 | 理由 |
|---|---|---|
| P1（本 spec） | R8 快照构建（后台，延迟不敏感） | 快照路径无 100ms 契约；命中即服务 |
| P2（后续，测量后） | 边界实时路径 | PPR 在数千节点上是 ~ms 级（稀疏迭代），但边界契约保守——先拿快照数据 |

### 2.3 CATD 拓扑承重衰减（并进 D1）

衰减 pass 读取节点的**加权度**（`anchor_edges` 权重和）：

```
effectiveRate = baseRate / (1 + β·ln(1 + weightedDegree))     （β=0.5）
```

- 高承重条目衰减慢（被依赖的知识不该先死）；孤立条目不受影响（degree=0 → 原率）
- 每天衰减时现算加权度（SQL 一行 SUM），不持久化
- superseded/redundant 沉底条目不参与承重计算（死记忆不撑活人）
- `decay.catd` 配置开关（默认 **on**——纯衰减修正，无新成本）

### 2.4 配置

```yaml
search:
  ppr: false          # P1: 快照路径启用后改 true
  pprAlpha: 0.15
  pprSeeds: 8
decay:
  catd: true
  catdBeta: 0.5
```

## 3. 测量计划（先于全量推广）

1. LongMemEval S 集：`--granularity session`，三配置对照：bm25-only（基线 0.949）、
   bm25+ppr、bm25+dense+ppr。**成功判据**：multi-session 类 R@10 从 0.375 → ≥0.55，
   总体不降
2. CATD：冻结能量对照（realistic 模式跑 90 天模拟）——hub 条目保留率提升，
   孤立条目不变
3. 性能：PPR 迭代耗时 < 20ms（3.7k 条库）

## 4. 边界与不做

- 不做 REALM 式图结构重组（检索反馈改图）——先拿 PPR 排序收益，结构重写是 D2 的后续
- 不动 R6 邻居呈现（已验证 +8.3pt，PPR 与其正交：呈现 vs 排序）
- 不回填历史 coactivation（图边只从 cue_anchors 派生，与现有 anchor graph 同源）
- P1 不动边界实时路径（100ms 契约优先）

## 5. 测试计划

1. `ppr.ts` 纯函数：收敛性、seed 集中性、hub 抑制、need 调制单调性
2. 融合：RRF 三源排序正确性
3. CATD：加权度 → 衰减速率映射（hub 慢/孤立不变/superseded 不计）
4. 快照构建集成：ppr on/off 双跑结果差异可观测
