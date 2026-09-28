# 读路径重构：从「打分 → top-k」到「期望 → 补全 → 验证 → 竞争 → 重构」

> 日期：2026-09-24（2026-09-28 修订）· 状态：R3 已实现并验证；**R2 回合粒度翻案、R2+R3 叠加为全实验最优；R1 部分翻案（伤 temporal）；R4 维持否决；R6 检索层实测无测量面 → 改呈现层 + L2；R5 预检 GO；R7/R8 待实现**
> 范围：把记忆**读路径**（检索/取回/注入）按大脑方式重构
> 依据：本次 LongMemEval 测量 + 大脑读路径调研（`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.4/1.5）
> + 读路径专项调研（`docs/research/2026-09-27-read-path-brain-alignment.md`，FOK/上下文复原/线索抽取/预测预取四方向）
> 相关：`2026-09-24-write-time-routing-design.md`（写路径 S1，读路径是其对偶）

## 1. 背景与测量

### 1.1 实测：瓶颈是排序，不是召回
LongMemEval-S（120 题，session 粒度，bm25 + graph + coactivation + channelSplit）：

| 类型 | R@1 | R@10 | R@10−R@1 |
|---|---|---|---|
| single-session-assistant | 1.000 | 1.000 | 0.000 |
| single-session-user | 0.900 | 1.000 | 0.100 |
| knowledge-update | 0.450 | 1.000 | **0.550** |
| temporal-reasoning | 0.429 | 0.829 | 0.400 |
| multi-session | 0.377 | 0.890 | **0.513** |
| single-session-preference | 0.250 | 0.800 | **0.550** |
| **overall** | **0.568** | **0.920** | 0.352 |

**R@10 0.92 → 答案几乎总在候选集里；R@1 0.57 → 排不上第一。** 最弱三类都是"查询与记忆词面不重叠"。

### 1.2 对照实验
| 方案 | overall R@1 | NDCG@1 | preference R@1 | user R@1 |
|---|---|---|---|---|
| bm25 | 0.568 | 0.792 | 0.250 | 0.900 |
| hybrid（+dense） | 0.586 | 0.817 | 0.450 | 0.800 ↓ |
| hybrid + reranker | 0.622 | 0.858 | 0.650 | 0.800 ↓ |
| **bm25 + Qwen3-Reranker（R3 验证层）** | **0.657** | **0.892** | **0.750** | **0.900** |

**结论（2026-09-27，已被 §1.3 修正）**：加验证层（CA1 匹配-失配）优于再加检索通道（dense）。dense 一涨一跌（拉入语义相近但缺关键信息的干扰项）。~~**R2（双过程级联/dense 融合）实测否决，不做**~~ —— **该否决在 2026-09-28 被推翻，见 §1.3**。

### 1.3 2026-09-28 修正：session 粒度的池饱和假象

**问题**：§1.2 的对照实验全部在 **session 粒度 + 内部 `recallK=50`** 下测量，而 LongMemEval-S session 粒度下每题语料本身就 ≈50 session —— **候选池已覆盖整个语料**，任何"往池里加新候选"的机制（dense 语义通道、query 改写、时间邻居）都只剩**重排**价值，recall 面被系统性遮蔽。

**回合粒度六臂对照**（`--granularity round`，语料 ≈500 回合 vs 候选池 50，48 题 / 120 题，seed 42，无 reranker）：

| 臂 | R@1 (48q→120q) | R@10 (48q→120q) | NDCG@1 (48q→120q) |
|---|---|---|---|
| base bm25 | 0.589 → 0.594 | 0.894 → 0.870 | 0.813 → 0.808 |
| +R1 查询改写 | 0.629 → — | 0.960 → — | 0.854 → — |
| +R2 dense 融合 | 0.655 → 0.633 | 0.965 → 0.929 | 0.917 → 0.867 |
| +R3 reranker | 0.648 → 0.654 | 0.930 → 0.905 | 0.896 → 0.883 |
| **R2+R3 叠加** | **0.697 → 0.673** | **0.975 → 0.954** | **0.958 → 0.917** |
| +R6 时间邻居 | 0.589 → — | 0.894 → — | 0.813 → — |

**修正后结论**：
- **R2 翻案**：dense 通道在回合粒度 R@1 +4~7pt、R@10 +6~8pt（multi-session R@10 0.809→0.95）。它的价值在 **recall 层**（R@10 高于 R3），与 R3 的头部精排**正交互补**；**R2+R3 是全实验史最优配置**（R@1 0.673 / NDCG@1 0.917 @120q），超过 session 粒度 R3 单臂（0.657/0.892）。
- **R1 部分翻案**：整体 R@1 +4pt / R@10 +6.6pt，但 **temporal-reasoning R@1 反降**（0.406→0.312）——改写丢时间线索，与 R7"query reduction > expansion"一致。故 LLM 无差别改写仍**不作为默认**。
- **R6 检索层定案否决**：检索侧时间邻居在 **两种粒度都零增益**（见 §5 R6）——不是池饱和，而是 **LongMemEval 真值本身是 session 粒度**，而同 session 回合时间上必然相邻（插进去的邻居全是同 session → 对 session 映射指标天然不可见）。
- **R4 维持否决**：纯重排机制，session/回合粒度都有测量面，实测净负成立。

**方法论教训（本 spec 的核心方法）**：
> **证伪一个机制前，先问它的作用面在哪一层，当前指标能否看到那一层。**
> - 加候选类（dense 语义通道 / query 改写 / 邻居扩展）→ 需**候选池 ≪ 语料**的回合粒度 R@k，或"新进 top-k 答案数"
> - 重排类（reranker / recency）→ R@1 / NDCG@1
> - 上下文质量类（邻居捆绑 / 版本指令）→ **只能靠 L2 reader**（session 粒度 R@k 永远看不见）


## 2. 大脑读路径（目标模型）

**核心命题：大脑不做全库扫描；取回 = 线索触发的重构。**

| 阶段 | 脑机制 | 文献 |
|---|---|---|
| ① 期望生成 | PFC efference copy（"我在找什么"）+ 编码特异性（情境重现） | Norman & O'Reilly 2003；Tulving & Thomson 1973 |
| ② 模式补全 | CA3 吸引子（部分线索 → 完整集群） | Nakazawa 2002；Rolls 2013 |
| ③ 双过程 | 熟悉感（快/gist）→ 回忆（慢/精确），**串联** | Yonelinas 2002 |
| ④ 匹配-失配验证 | CA1 比较器（候选 vs 期望 → 预测误差） | Vinogradova 2001；Percept Mot Skills 2021 |
| ⑤ 竞争抑制 | 提取诱发遗忘（选出胜者、压制竞争项） | Anderson 1994 |
| ⑥ 重构 | 图式偏置的主动重构 | Bartlett 1932；Schacter 2007 |

## 3. 现状 vs 目标

| 阶段 | MAFW 现状 | 判定 |
|---|---|---|
| ① 期望生成 | 原始 query 直投 BM25 | ❌ |
| ② 模式补全 | anchor + coactivation 图 + 有界 PPR | ✅ |
| ③ 双过程 | dense/BM25 **并联 RRF** | ◐ |
| ④ 验证 | **R3：Qwen3-Reranker（已实现+验证）** | ✅ |
| ⑤ 竞争抑制 | 无（并列打分） | ❌ |
| ⑥ 重构 | C0 回源重建 | ✅ |

**约束**：边界 recall（`/api/recall/context`）有 **100ms 硬契约**（插件 100ms abort）。R3 验证层（~250ms）**不能**进同步边界路径——只能进显式检索路径（`mafw_search_hybrid`）或异步预计算快照。

## 4. 切片

### R3 验证层（CA1）—— ✅ 已实现并验证
- **实现**：`gateway/src/core/memory/llamacpp-reranker.ts`——Qwen3-Reranker-0.6B GGUF 经 llama.cpp `/v1/completions` + **yes/no logprob** 打分（Qwen3ForCausalLM 不是 seq-cls，走不了 text-classification pipeline；llama.cpp `/rerank` 对它无区分度）。官方模板 + 空 think 块禁用思考。
- **测量**：R@1 +0.089、NDCG@1 +0.100、preference +0.50、user 不掉。
- **待接线**：config `search.reranker: 'llamacpp'` + 显式检索路径；边界路径不接。
- **坑**：`createReranker('llamacpp')` 默认 CPU（19s）→ 必须 `gpu: 'vulkan'`（250ms）。

### R1 期望生成（PFC）—— ◐ **部分翻案（2026-09-28）**
- **实现**：harness `--queryRewrite`（用 worker 模型把问句改写成"记忆会怎么写"的陈述式查询，如 "Where did I attend my cousin's wedding?" → "user cousin wedding location"）。
- **旧实测（session 粒度）**：overall R@1 **0.615 < 0.657**（同 R3 配置），曾判净负。
- **新实测（回合粒度，§1.3）**：R@1 0.629（base 0.589，**+4pt**）、R@10 0.960（base 0.894，**+6.6pt**）——recall 面确有价值；但 **temporal-reasoning R@1 0.406→0.312 反降**（改写丢时间线索）。
- **结论**：LLM 无差别改写**不作为默认**（伤 temporal，且与 R7"query reduction > expansion"冲突）；若做，走规则式/时间保真的定向改写（待验证）。

### R2 双过程级联 —— ✅ **翻案（2026-09-28）**
- **旧实测（session 粒度，已作废）**：hybrid+rerank (R@1 0.622) 低于 bm25+rerank (0.657) → 曾判"净负"。
- **新实测（回合粒度，§1.3）**：dense 单臂 R@1 0.655/0.633、R@10 0.965/0.929（48q/120q），**R@10 高于 R3 单臂**；**R2+R3 叠加 0.697/0.673 全指标最优**。
- **结论**：dense 是 **recall 层**机制（捞 BM25 漏掉的语义相近候选），与 R3 验证层正交；旧否决是 session 粒度池饱和造成的假象。**R2 采纳**（生产接线待定，见 §5）。
- **遗留**：single-session-user R@1 在旧 session 粒度有下降（0.90→0.80）——需确认是否为该子集的噪声（120q 回合粒度未见）。

### R4 竞争抑制（提取诱发遗忘）—— ❌ 实测否决（近因竞争版，**结论维持**）
- **实现**：重排融合加近因项 `score = base·bm25 + base·ce + w_recency·recency`（`MAFW_RERANKER_RECENCY`/`recencyWeight`，默认 0 = R3 基线）。
- **实测**（w=0.2，120 题）：overall R@1 **0.644 < 0.657**；knowledge-update 0.450→0.475（↑）但 user 0.900→0.850、preference 0.750→0.700（↓）。
- **结论**：近因是**纯重排**机制（session/回合粒度都有测量面），净负成立。**R4 不做**（仅测了 w=0.2 一个点，如需可再扫权重）。

## 切片实测总结

| 切片 | 结果 | 判定 |
|---|---|---|
| R1 查询改写（LLM） | 回合粒度 R@1 0.629 / R@10 0.960（↑）但 temporal R@1 ↓ | ◐ 部分翻案，不作默认 |
| R2 双过程级联（dense） | 回合粒度 R@1 0.633 / R@10 0.929；R2+R3 **0.673/0.954** | ✅ **翻案（recall 层）** |
| R3 验证层（Qwen3-Reranker） | 回合粒度 0.654 / 0.905；session 粒度 0.657 | ✅ 已验证 |
| R4 近因竞争 | 0.644 < 0.657 | ❌ 否决（维持） |
| R6 上下文复原（检索层） | 两粒度均零增益（真值粒度问题，非池饱和） | ❌ 检索层否决 → 改呈现层 |
| R5 FOK 元记忆门 | 预检：top1OverMean AUROC 0.85–0.88（bm25）/ s1 0.95–1.0（hybrid） | ✅ GO |
| R7 确定性线索抽取 | 待实现（标识符分词 + 逐字加权） | → 见 §5 |
| R8 预测预取快照 | 待实现（延迟优化，非质量优化） | → 见 §5 |

**结论修正（2026-09-27）**：R1–R4 的结论是"验证层是打分-排序阶段唯一有效的重构"，但**"剩余弱类型非检索层可修"的判断被新调研推翻**——CueMem（去图扩展 81.1→71.4）与 EdgeMem（episode 通道 +8.4）证明**命中锚点的时间邻居扩展**直接作用于 temporal/multi-session/knowledge-update 三类弱项。脑机制依据：lag-CRP（Kahana 1996）、TCM 上下文复原（Howard & Kahana 2002）、语义与时间信号可加（Polyn et al. 2009）。

### R6 情景上下文复原（temporal neighbor bundling）—— ⚠ 检索层已实现并**否决**；改**呈现层** + L2

**检索层实测（2026-09-28）**：`gateway/src/recall/temporal-neighbors.ts`（±window 时间邻居，同 session 权重 0.5 / 跨 session 0.35，跳过 superseded 与已入池项，确定性排序）已接线 `searchScored`（config `search.temporalNeighbors`，默认 off）。
- session 粒度：与 base **逐指标完全一致**（池≈语料）。
- 回合粒度（语料 500 vs 池 50）：仍**完全一致**；但 top-10 内容在 14/48 题确有变化——插入的邻居**全是同 session 回合**（同 session 回合时间上必然相邻；跨 session 邻居只在 session 边界出现，锚点落边界概率极低）。
- **根因**：LongMemEval 真值是 **session 粒度**，同 session 邻居对 session 映射指标天然不可见。**不是池饱和**（回合粒度也零），是**真值粒度与机制作用面错配**。
- **结论**：检索层代码保留（默认 off、有测试），**无 L1 测量面**；改为呈现层（邻居捆绑进注入块）+ **只靠 L2 reader 测量**（CueMem/EdgeMem 的增益也都在 reader/端到端）。

**呈现层 L2 实测（2026-09-28，session 粒度 48 题，mimo-v2.5 reader+judge）**：命中 top-3 的 ±1 时间邻居（最多 4 条）渲染为 `↳` 行 + "Neighbouring session" 块 + nearest-version 指令；L1 指标两臂完全相同（R@10 0.949）。
| 类型 | off | on | Δ |
|---|---|---|---|
| single-session-user | 0.875 | 0.750 | −0.125 |
| **multi-session** | 0.375 | **0.625** | **+0.250** |
| **single-session-preference** | 0.500 | **0.750** | **+0.250** |
| temporal-reasoning | 0.875 | 0.750 | −0.125 |
| knowledge-update | 0.750 | **0.875** | +0.125 |
| single-session-assistant | 0.875 | **1.000** | +0.125 |
| **overall** | **0.7083** | **0.7917** | **+0.0834** |
**结论：呈现层有效**（净 +4/48 题；增益集中在 multi-session 与 preference，与 lag-CRP/相邻 episode 假设一致），且**无需 reranker**（纯内存 O(entries) 计算）→ **可进 100ms 边界路径**。默认仍 off（`search.temporalNeighbors.presentation`）。
**局限**：n=48（逐类型 ±1 题 = ±12.5pt）；单 reader 模型；建议加大样本复核后再开生产默认。

- **依据**（详见调研 §2）：lag-CRP 效应（Kahana 1996）；CueMem 去扩展 81.1→71.4；EdgeMem episode 通道 +8.4；EM-LLM contiguity buffer（须 ≤ similarity buffer）。
- **实现**（检索出口层，`harmonic-index.ts` 或 `search-hybrid.ts`）：
  1. BM25 命中（分超 floor）为锚点 → 捆绑同 session ±1 条目（对称窗，w∈{1,2} 在 LongMemEval 上调）；
  2. 锚点为 session 首/尾时，桥接时间相邻 session 的边缘 1 条；
  3. 呈现：时间序成块、`[日期, session]` 前缀、锚点标 ▶、邻居 token ≤ 50% 预算、去重；
  4. 知识更新：保留全部版本 + 指令"优先采用离问题时间最近的信息"（CueMem 消融值 +6.4/+6.8）+ 显式标记 supersede 链头；
  5. **绝不物理排除旧版本**（"X 什么时候变的"类问题需要）。
- **评测**：LongMemEval per-category，预期增益集中在 temporal / multi-session / knowledge-update。
- **坑**：误命中锚点的邻居 = 误上下文 → 只扩展高分锚点；硬 token 帽防膨胀（CueMem ~2K 重构 > 108K 全史）。

### R5 FOK 元记忆门（PFC 监控）—— ✅ 已实现（默认 off）
- **依据**（调研 §1）：mPFC 损伤 = 自信虚构（Schnyer 2004）；LLM 自报置信无效（2605.24299）→ **门必须在检索代码里**；prompt 式弃答在误导上下文下崩溃（2608.22228）；便宜信号够用（2501.12835）。
- **特征选型（2026-09-27 AUROC 预检驱动）**：取 **未加 energy×salience 加权的原始相关性分** 的 `top1/mean`（尺度无关）为主特征——实测 AUROC bm25 0.851(hit@1)/0.876(hit@3)、hybrid s1 0.95–1.0；`gap/ratio` 类特征弱（<0.66）不用。reranker top1 概率仅作显式路径的备选（边界路径无 reranker）。
- **⚠ 特征选型被 2026-09-28 拒答实验推翻（重要）**：上面那个 AUROC 测的是**"命中 vs 未命中"**（答案在不在自己检索出的 top-k），**不是"可答 vs 不可答"**（问题的答案是否存在于语料）。用 30 道 `_abs` 拒答题单独测：
  | 特征 | AUROC(可答≥不可答) | 中位数（可答 / 不可答） |
  |---|---|---|
  | **reranker top1 概率** | **0.782** | 0.840 / **0.052** |
  | bm25 top1（绝对分） | 0.691 | 17.95 / 14.33 |
  | bm25 top1/mean（原选型） | 0.582 | 1.48 / 1.41 |
  交叉编码器（R3）能直接判"该段落与问题无关"，所以它的 top1 概率才是 FOK 信号；BM25 的分数分布只反映"检索是否占优"。**FOK 与验证是同一机制**（CA1 比较器兼做两者），门控必须建立在验证层之上——这也意味着 FOK 只能落在可负担 rerank 的路径（显式检索 / 异步预取 / L2），不在 100ms 边界路径。
- **L2 端到端实测（2026-09-28，mimo-v2.5 reader+judge，LongMemEval-S）**：门控特征 = reranker top1 概率，low=0.2 / high=0.5。
  | 臂 | 拒答集 (30) | 可答子集 (44，含 29 道门控命中的难题) |
  |---|---|---|
  | 基线（无门，无 oracle 提示） | 0.8667 | 0.500 |
  | A 撤上下文 + 声明 | 0.9333 | 0.3864 |
  | **B 保留上下文 + 声明（采纳）** | **0.9667** | **0.5227** |
  逐区归因（可答侧）：inject 区 0 变化（如设计）；low-confidence 只加警示 −11pt；no-memory 撤上下文 −20pt。
  **设计结论：声明而不撤回**——撤掉候选既伤可答（−20pt）又反而降低拒答准确率（0.933 < 0.967），因为 reader 需要证据来确认"信息确实不存在"。"沉默是错的"仍成立，但"撤回也是错的"。
  **生产实现已改为 B**（`formatRecallContext` no-memory = 保留指针 + `status="no-reliable-memory"` + 不臆造提示）。
  **局限**：n=30/44、单 benchmark、单 reader 模型；门控依赖 reranker 概率（AUROC 0.78），故只落在可负担 rerank 的路径；阈值 0.2/0.5 来自混淆矩阵（行为 B 下阈值敏感性已降低）。
- **实现**：`gateway/src/recall/fok-gate.ts`——`computeFokFeatures` / `classifyFok` 三区 / `fitFokThresholds` 离线校准（low = 最大平衡准确率点，high = 精度目标点）；`harmonic-index.bm25RawScores()` 供原始分（`bm25SearchScored` 重构共用内核，不改变行为）。
- **三区**：`inject` 正常指针 / `low-confidence` 指针 + 核实提示 / `no-memory` **显式注入 `<recall status="no-reliable-memory">` 且撤回候选指针**（沉默是错的）。
- **接线**：`/api/recall/context`（`computeRecallFokZone`，fail-open：未启用/取分失败一律 inject）；config `search.fok {enabled:false, low:1.2, high:1.35}`。
- **阈值注意**：LongMemEval-S bm25 拟合值（low≈1.36 / high≈1.34）；**原始分尺度跨检索器不可比，换检索配置必须重标定**（hybrid 分布压缩至 1.04–1.38）。
- **待办**：`mafw_search_hybrid` 出口（handler 目前丢弃 searchScored 分数，需捕获原始分）；无答案探测集（LongMemEval-S 仅 1–2 道拒答题，abstention 判别无法评估）。

### R7 确定性线索抽取 —— 待实现（低优先级）
- **依据**（调研 §3）：确认 R1 否决（CAsT 自动改写比人工差 35%）；query reduction > expansion（Kumaran & Allan 2008）；编码特异性——逐字 token 必在写入 trace 里。
- **实现**：① 标识符感知分词（camelCase/snake 双索引，效应量最大，arXiv:2605.18561）；② 抽取路径/标识符/引号串/日期 → 2–3× **加性**加权（永不减性过滤）；③ 分词变更后必须重跑 LongMemEval 基线（IDF 会移动）。
- **前置检查**：写路径 `primary_abstraction` 是否保留逐字标识符。

### R8 预测预取快照 —— 待实现（最低优先级，延迟优化）
- **依据**（调研 §4）：preplay（Dragoi & Tonegawa 2011）；predictive prefetching −43.5% 延迟（2605.17989）；**最后一轮只含 session 词汇 36%**（2607.22392）→ 快照 query 用滚动 N 轮 + goal 快照 + 活跃文件。
- **实现**：kv_store `recall-snapshot/{sessionID}`（top-N + 预格式化块 + queryHash）；后台刷新（回合完成防抖 / goal 变更 / 话题转移）；边界读快照 ~1ms，增量 >50 字符时跑正常搜索并**新鲜结果在前**合并；快照构建走 `resolveSupersededHeads`；话题转移检测确定性做在 gateway（LLM 会带陈旧上下文，2605.09268）。
- **定位**：只解决 100ms 边界契约的覆盖问题，不提升 R@1。

## 5. 优先级与依据（2026-09-28 修订）

1. **R5 FOK 门**（✅ 已实现，默认 off；预检 GO，特征选型已定：原始分 top1/mean，阈值按检索配置分别标定）。
2. **R6 呈现层**（检索层已否决；邻居捆绑 + "优先采用最近版本"指令进注入块，**靠 L2 reader 测**）。
3. **R2+R3 生产接线设计**（已确认增益；边界 recall 100ms 契约：hybrid dense 融合可进，R3 reranker ~250ms 只能进显式/异步路径，待定）。
4. **R7 线索抽取**（安全加性，先查写端保真）。
5. **R8 预测预取**（只优化延迟）。
6. ~~R3 接线~~（已完成）；~~R1~~（部分翻案但不作默认）；~~R4~~（维持否决）。

## 5.1 测量方法（每个切片动工前的测量面预审）

- 加候选类机制 → 跑 **回合粒度** R@k（或"新进 top-k 答案 session 数"），session 粒度会饱和
- 重排类机制 → R@1 / NDCG@1
- 上下文质量/呈现类机制 → **L2 reader**（L1 永远看不见）
- 门控类机制 → 门控特征对命中的 **AUROC**（零成本离线预检，见 R5）

## 6. 非目标

- 不做全库 LLM 扫描（守 100ms 边界）。
- 不改 OKF 存储。
- 不引入外部 API（验证层用本地 GGUF）。

## 7. 涉及文件

- R3：`gateway/src/core/memory/llamacpp-reranker.ts`（新）、`reranker.ts`、`config.ts`（`search.reranker: 'llamacpp'`）、`mcp/handlers/search-hybrid.ts`、`index.ts`
- R6：`gateway/src/recall/temporal-neighbors.ts`（新，检索层已实现默认 off）、`chronologicalOrder`；呈现层待做：`inject-format.ts`（邻居块呈现）、`recall-context.ts`
- 基建：`gateway/src/core/utils/atomic-write.ts`（新，`renameWithRetry`——Windows `renameSync` 偶发 EPERM 硬化，已在 `harmonic-index.ts` `save()` 接线）
- R5：`gateway/src/mcp/handlers/search-hybrid.ts`、`routes/recall-context.ts`（三区门 + 校准）
- R7：`gateway/src/core/memory/harmonic-index.ts`（tokenizer 双索引）、query 预处理
- R8：kv_store `recall-snapshot/{sessionID}`、`routes/recall-context.ts`、回合完成钩子
