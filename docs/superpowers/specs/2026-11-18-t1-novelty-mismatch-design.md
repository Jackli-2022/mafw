# T1 编码期 novelty / mismatch（E2）设计

- **状态**：已交付（Phase 1，2026-11-18）
- **日期**：2026-11-18
- **范围**：`gateway/src/recall/turn-pipeline.ts`、`t1_turn_features`、`replay-sampling`、consolidation 预筛
- **前置**：`2026-11-18-cortex-grounding-design.md`（E1）、`2026-10-08-brain-like-roadmap.md`（D3）

## 1. 为什么

回放采样公式是 `salience × (1 + novelty) × e^(−age/τ)`，但 `novelty` 在
`turn-pipeline.ts:412` 是**常数 0.5**——也就是说 RPE（奖励预测误差）这一路完全没有信号，
回放退化成了「显著度 × 新鲜度衰减」。反思则按 session 轮转，不区分「这轮是否有新信息」。

皮层接地（E1）解决的是「记忆能不能指回经历」；E2 解决的是「哪些经历值得回放」。两者正交。

### 与已交付 D3 的区别（不是重做）

D3（2026-10-09）交付的是 **consolidation 冲突级联**（Laya `tauLow`，默认关），
以及在写入侧用 `1 − maxCosine` 当 importance 先验的实验。它没有落成 per-turn 信号，
也没有接进回放/反思。E2 是编码期的**逐轮双标量**，消费方是回放排序与反思优先级。

## 2. 研究依据（本仓调研）

| 机制 | 脑 | 工程对应 |
|---|---|---|
| 模式分离 | 齿状回稀疏高阈值，去相关相似经历 | `novelty = 1 − 内容相似度`（对已有皮层记忆） |
| 模式完成 | CA3 吸引子，部分线索补全整体 | 最近邻检索 = 补全尝试 |
| 比较器 | CA1 比对「EC 输入」与「CA3 补全结果」 | `mismatch = 线索相似 − 内容相似` |
| 多巴胺 / RPE | 预测误差驱动巩固与探索 | 高 novelty / mismatch → 提高回放与反思优先级 |
|  prioritized replay | 奖励 × 新颖 × 近因 加权课程 | 现有 `replayPriority` 只缺 novelty |
| Titans / EM-LLM | surprise 门控写入、surprise 分段 | 只做排序，不阻断写入（本设计非目标） |

引用：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`、
`2026-10-08-more-brain-like-memory.md`、`2026-10-10-cls-fast-slow-anchoring.md`、
`2026-08-26-memory-systems-pipeline-survey.md`。

## 3. 信号定义

对每一轮 `t` 计算两个标量。两个向量都来自**同一个已配置的 embedder**，不新增模型。

- `content_t`：整轮文本（现有 atom 编码用的同一段文本）。
- `cue_t`：线索文本 = `feature.intent` + `feature.entities` + `feature.tool/target`
  （都是 `extractTurnFeature` 在编码前就有的字段，不依赖 encoder 内部的 concepts）。
- 参照集 `C`：**active 皮层 unit** 的向量（`embeddingRuntime.vectors`），并同时满足：
  - `!superseded_by && type !== 'episodic'`；
  - `unit.created_at <= turn.last_ts`（时间过滤，防止用同一轮之后派生的记忆判断它“不新颖”）；
  - `source_trace_ids` 不含 `t.trace_id`。

  实现上取 `searchByCosine(..., 200)` 后按上述条件过滤再取 max（top-1 可能是 superseded 条目；
  topK 取 200 是为了过滤后仍剩下足够候选）。`cueSim` 与 `contentSim` 各自独立取 max，
  不要求命中同一条记忆——「线索像 A、正文像 B」本身就是失配。

```
contentSim(t) = max_{m ∈ C} cos(content_t, m)
cueSim(t)     = max_{m ∈ C} cos(cue_t, m)

novelty(t)  = clamp(1 − contentSim(t), 0, 1)
mismatch(t) = max(0, cueSim(t) − contentSim(t))   // 线索熟、内容不熟
```

直觉：

- **高 novelty + 低 mismatch**：真正的新话题 → 回放优先，反思可提炼新条目。
- **低 novelty**：冗余材料 → 回放降权（省预算）。
- **高 novelty + 高 mismatch**：熟悉的框架里出现了不同细节（「看起来像那个老 bug，其实不是」）
  → 最高优先级送反思，也是最该写“纠正型”记忆的场景。
- **低 novelty + 高 mismatch**：几乎不该出现；出现说明 cue/content 抽取有噪声，计入审计。

`redundancy(t) = contentSim(t)`（同一数据的另一面），给第三阶段去重预筛用。

### 不参与的轮次

以下直接记 `null`（不是 0）：

- 无可解析 trace、无文本、`extractTurnFeature` 失败（没有 cue 字段）；
- 文本 < 120 字符且无 entities/actors（寒暄、`可以`、`b`）——这些轮 `1 − cos` 天然高，
  会污染分布；
- embedder 不可用（fail-open）。

## 4. 计算位置

新增模块 `gateway/src/recall/t1-signals.ts`：

- `scoreTurnSignals(sims): { novelty, mismatch }`：纯函数，便于单测。
- `computeTurnSignals({ turns, embedder, vectors, indexEntries }): Map<traceId, {novelty,mismatch}>`：
  负责 embedding、检索、过滤；任何异常返回空 Map（fail-open）。

调用点在 `gateway/src/recall/turn-pipeline.ts`，atoms 之后、episode 重建之前：

1. 对每轮 embed 两次：整轮文本（content）与线索文本（cue）。
   Phase 1 接受这一次额外 embed（本地模型，单轮约 10ms）；不修改
   `T1SemanticEncoder.encodeMany` 的返回契约来“复用” atom 向量，避免把信号耦合进编码器。
2. 对 `C` 做两次 cosine 检索（brute force，当前 16.7k 向量 × 1024 维，单次约 20–40ms；
   一批 6 轮约 0.2–0.4s，在后台压缩管线里可接受）。
3. 在循环结束后统一写回：`upsertTurnFeature({ ...feature, novelty, mismatch })`
   （feature 原本在循环内已写一次；第二次写只补两个标量，upsert 必须 merge 保留其它字段）。
4. 任一步失败只丢信号，不影响归档、不影响 raw T1（现有 fail-open 结构不变）。

**不阻塞 capture**：turn-pipeline 是小时级后台管线，不在 obs 写入路径上。
embedding provider 为 `off` 时整段跳过（`scored=0`），不报错。

## 5. 存储

```sql
ALTER TABLE t1_turn_features ADD COLUMN novelty REAL;   -- null = 未评分
ALTER TABLE t1_turn_features ADD COLUMN mismatch REAL;
```

- 只存标量，不存向量、不存 cue 文本；可重算（回填脚本）。
- `T1TurnFeature` 增加两个 optional 字段；`upsertTurnFeature` 更新时保留已有信号。
- 无新表、无新 HTTP 路由。

## 6. 消费方与上线阶段

### Phase 1（默认交付）：只测量

- 计算并写入两个标量。
- `stats.t1.signals`：
  - `scored` / `unscored`：`t1_turn_features` 中有 / 无信号的轮数；
  - `novelty` / `mismatch`：`{p50,p90,p99,max}`；
  - `highNovelty` / `highMismatch`：超过 config 阈值（Phase 1 默认取首轮回填的 p90）的轮数；
  - `redundant`：`contentSim ≥ dupThreshold` 的轮数（只报告，不折叠）。
- 回放行为**完全不变**（仍用 0.5），只做对照基线。

### Phase 2（需单独确认）：接回放

- `memory.t1.replayNovelty`（默认 `false`）打开后：
  `replayPriority({ salience, novelty, ageHours })` 使用本批的原始 novelty。
- 反思排序：episode 的 novelty = 成员轮 `max(novelty)`，mismatch 同理；只影响
  「同一天先反思哪个 session/episode」，在 `maxEpisodesPerRun` 触顶时决定哪些被推迟，
  不改变「是否反思」。

### Phase 3（需单独确认）：去重预筛

- consolidation 在 LLM 判官之前：同类型、`contentSim ≥ dupThreshold`（由线上分布定，
  初始候选 0.95）→ 不新建，给目标条目加一次 evidence/energy，计入 `wouldFold`。
- 默认关；先影子统计「若开启会折叠多少条、其中多少条其实不同」。

## 7. 校准与验证（先测量，再谈采用）

1. **分布**：回填现有全部有 feature 的 turn（当前 4,418；脚本
   `gateway/scripts/backfill-t1-signals.ts`，默认 dry-run），报告 p10/p50/p90/p99 与
   `scored/eligible`，确认不是双峰退化。
2. **人工审计**：top 20 novelty、top 20 mismatch，逐条对照原文；判断标准是
   「熟悉框架 + 不同细节」是否真的成立，而不是分数高低。
3. **代理效度**：以「该轮之后产出的 unit 是否被检索过」为正例，算 novelty 的 AUC；
   `< 0.55` 视为该信号在我们的语料上没有区分度，不进入 Phase 2。
4. **消融**：Phase 2 打开后对比回放选中的 turn 集合（Jaccard）与反思产出条数，
   持续一周；没有可测差异就退回 0.5。

阈值不写死：`dupThreshold`/`highNovelty`/`highMismatch` 从实测分布取分位数，
写进 config 默认值，并记录在 release note 里。

## 8. 反目标

- 不做在线学习、不改 embedder、不做 surprise 分段（episode 边界仍按声明 + 推断）。
- 不因为 novelty 低就**丢弃**或**不写**任何 T1 数据；raw T1 不可变。
- 不用 LLM 判断 novelty（成本与不可复现）。
- 不让信号进入边界 recall 的 100ms 路径。
- 不在本设计里改 `episode_id` / `episode_hint` 语义。

## 9. 我做的决定（可推翻）

1. **cue vs content 双向量**，而不是「概念 Jaccard」。理由：两侧词表不同源，Jaccard 会引入
   抽取器噪声；双向量用同一空间，比较的是「补全结果 vs 实际输入」。
2. **只存标量不存向量**，回填可重算。代价：历史 cue 向量不可复用，回填要重新 embed。
3. **novelty 用原始余弦距离**，不做 atoms 那样的双校正。理由：距离本身可解释，
   校正会把阈值变成数据集相关；分布审计 + 分位数阈值足够。
4. **Phase 2/3 默认关**，先影子。理由：D3 的教训是「没有安全线就不要开门」。
5. **mismatch 是实验性信号**：如果人工审计显示它主要是抽取噪声，就只保留 novelty，
   mismatch 记 `null` 并在 release note 里说明。

## 10. 验收标准

- 纯函数测试（`tests/unit/recall/t1-signals.test.ts`）：
  - 同义复述 → `novelty` 低、`mismatch` 低；
  - 同线索不同细节 → `mismatch > 0` 且 `novelty` 高；
  - 无关内容 → `novelty` 高、`mismatch ≈ 0`；
  - 短寒暄 / 无 concepts → 两个 `null`；
  - `cueSim < contentSim` → `mismatch = 0`（不出现负值）。
- 管线测试（`tests/unit/recall/turn-pipeline-signals.test.ts`）：
  - 编码成功后 feature 上写入两个标量；
  - 重编码时保留已有信号（upsert merge）；
  - embedder 抛错 → 归档照常、信号为 null。
- `stats.t1.signals` 字段与分位数有测试。
- 回填脚本 dry-run 输出分布；`--apply` 后 `scored` 数量与 dry-run 一致，0 失败。
- `tsc -p tsconfig.json`、`npm run build`、gateway 全量 suite 通过。
- 线上：`scored / eligible ≥ 50%`（eligible = 有文本且通过信息量门的 turn；首轮回填记录实际基线）；
  `novelty` 的 p10 > 0 且 p99 < 1（分布不退化）；人工审计 20+20 条写入 release note。

## 11. 已知风险

- **回填自我泄漏**：用「该轮之后才写出的记忆」判断早期轮次，会让 novelty 偏低（保守方向）。
  时间过滤 + `source_trace_ids` 过滤只能挡住一部分；审计时要看历史轮是否整体偏「不新颖」。
- **cue 过短**：`intent` 为空时 cue 只剩 entities，向量可能不稳；这种情况按「信息量不足」记 null。
- **换 embedding 模型**：阈值与分布全部失效。信号绑定当前 embedder：回填脚本输出 `model`，
  release note 记录；换模型必须重跑回填（`--apply` 覆盖全部分数）并重定阈值，不能沿用旧分布。
- **mismatch 可能是噪声**：见 §9 第 5 条，审计不通过就只保留 novelty。

## 12. 交付修订（2026-11-18）

- 增加了“cue 与 content 必须补全到同一条记忆”的约束（CA1 是一次检索的比较）；没有它时 mismatch 主要反映短线索的泛化匹配。
- 增加了非 cue 过滤：agent 系统提示、`【眼】` 感知遥测、`[object Object]` 残留、非散文正文（字母/CJK < 35%）、单词意图（intent < 12 字符）。
- 审计后 mismatch 仍偏噪声（21 个正例，AUC 0.580，样本不足）。按 §9 第 5 条本应记 null；实际选择**保留存储、禁止消费**，因为删掉分数会让后续改进定义失去对照数据。代价：库里存在一个低精度字段，靠 release note 与本节的“禁止消费”约束管理。
- `recall.t1Signals` 默认 `on` 只表示“计算”，Phase 2/3 均未实现。
- 阈值按最终回填分位数落到 `config.recall.t1SignalThresholds`（0.40 / 0.023 / 0.23 / 0.95）。
- 交付记录：`docs/releases/2026-11-18-t1-novelty-mismatch.md`。

## 13. 回滚

- 关 flag → 行为回到常数 0.5；两列留在表里不影响任何读路径。
- 删除两列或置 null 即可清除；回填脚本可重放。
