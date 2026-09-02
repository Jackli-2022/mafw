# LLM Agent 长期记忆检索优化：现状调研（2024–2026）

> 调研日期：2026-09-01。场景约束：**数千条记忆单元、检索延迟 <200ms**、当前基线为纯 BM25(k1=1.2, b=0.75)×energy×salience，无向量检索、无 reranker。LongMemEval BM25 基线 R@10=0.949（session 粒度），弱项：multi-session / single-session-preference ≈ 0.375。
>
> 所有数字均注明来源；无法找到出处的标注（推测）。

---

## 0. 关键背景：LongMemEval 原论文的官方消融（最权威的对照）

LongMemEval 原论文（Wu et al., ICLR 2025, [arXiv:2410.10813](https://arxiv.org/abs/2410.10813)）在附录 E.2 给出了 **BM25 vs dense 检索器在同一基准上的直接对照**（Table 9，value=session、K=V 设定）：

| Retriever | R@5 | NDCG@5 | R@10 | NDCG@10 |
|---|---|---|---|---|
| BM25 | 0.634 | 0.516 | 0.710 | 0.540 |
| Contriever（无监督 dense） | 0.723 | 0.634 | 0.823 | 0.663 |
| Stella V5 1.5B（dense） | 0.720 | 0.594 | 0.794 | 0.615 |

**"Both dense retrieval embeddings have significantly higher performance than the BM25 sparse retrieval method."**（论文 E.2 原文）

同一篇论文的三个主打优化（第 5 节）：

- **Key expansion（fact-augmented indexing）**：往索引 key 里拼接 LLM 抽取的 user facts → recall@k **+9.4%**、下游 QA **+5.4%**（§5.3）。注意 E.3 对照实验：多路独立索引 + rank merging **差于** key merging（把抽取信息直接拼进同一条目）——rank merging 让索引膨胀 m+1 倍且效果更差。
- **Time-aware query expansion**：索引阶段抽取带时间戳的事件；查询阶段用强 LLM 从问题中抽出时间范围并裁剪搜索空间 → temporal-reasoning 类 recall **+6.8%~11.3%**（§5.4）。重要陷阱（E.4）：弱模型（Llama-3.1-8B）会在无时间引用的问题上**误抽时间范围**，错误裁剪搜索空间拉低 recall；强模型（GPT-4o）能正确回答 N/A。
- **阅读侧（reading）**：Chain-of-Note + 结构化 JSON 格式 → QA 最多 **+10 个绝对点**（§5.5）；错误分析（E.5）显示 15%~19% 的样本是"检索对了但生成错了"。

对我们的含义：论文测的是 LongMemEval-M 规模的 haystack；我们 session 粒度 BM25 已到 0.949，说明**我们的语料粒度/索引字段设计已经吃掉了大部分易得的 recall**——剩余弱项（multi-session、preference）的性质与论文一致：不是"找不到"，而是"证据分散在多条目、需要合成"。

来源：https://arxiv.org/abs/2410.10813 及 HTML 全文 §5.2–5.5, E.2–E.5

---

## 1. 混合检索（BM25 + dense + 融合）

### 代表工作与数字

| 来源 | 机制 | 报告增益 |
|---|---|---|
| **LINE personal memory RAG**（arXiv:2608.27809, 2026，与 LongMemEval 场景最接近：22,329 个对话 chunk） | BM25 + dense 线性加权（β=0.45），embedding_text（摘要+原文摘录）表示 | BM25-only R@5=0.584 → hybrid R@5=**0.697（+0.113**，95% CI [0.048, 0.184]）。**aggregate/multi-evidence 类问题在 flat chunk 检索下仍然最差** |
| **Bruch et al., TOT 2023**（[arXiv:2210.11934](https://arxiv.org/abs/2210.11934)，Pinecone） | 系统对比 convex combination (CC) vs RRF | CC 在域内/域外均优于 RRF；RRF 对参数敏感；CC 只需少量标注调一个权重；**min-max 归一化对 CC 的影响被证伪为不敏感**（"agnostic to the choice of score normalization"） |
| **LongMemEval 论文 Table 9**（见 §0） | dense 单换 BM25 | R@10: 0.710 → 0.823（Contriever），无融合 |
| RRF 原始论文（Cormack et al., SIGIR 2009，[doi:10.1145/1571941.1572114](https://dl.acm.org/doi/10.1145/1571941.1572114)） | RRF = Σ 1/(k+rank)，k=60 | 优于 Condorcet 与单个 ranker（经典结论，无单一数字） |

### Embedding 选型（<200ms 约束下）

- **BGE-M3**（[arXiv:2402.03216](https://arxiv.org/abs/2402.03216)）：一个模型同时出 dense + sparse（learned lexical weights）+ multi-vector，8K 上下文，100+ 语言（CJK 友好，对我们中英混合的记忆条目重要）。~568M 参数，本地 CPU 可跑 batch 推理；数千条记忆可全量内存驻留（1024 维 float32 ≈ 每条 4KB，5000 条 ≈ 20MB），余弦检索 <1ms。
- jina-embeddings-v3（570M，task-specific LoRA，[arXiv:2409.10173](https://arxiv.org/abs/2409.10173)）：同类选择。
- OpenAI text-embedding-3：API 依赖 + 网络延迟 ~100-300ms，**对 <200ms 预算有风险**；本地小模型（BGE-M3 / gte-small 级）更稳。
- LongMemEval 论文自己用 Stella V5 1.5B。

### 实现成本与适配判断

- 成本：**中**。写入路径加一次 embedding（批量离线做，写入时 ~10-50ms/条可接受）；检索侧加一次向量内积扫描（5000×1024 维纯 numpy <5ms）。
- **适合本场景**。但注意 LINE 研究与我们自己的 BM25 基线差距悬殊（他们 BM25 R@5 只有 0.584），**hybrid 对我们的增量不会像 +0.113 那么大**——我们 BM25 R@10 已 0.949，头部空间小；增益大概率集中在 multi-session/preference 类的语义改写查询（查询词与记忆条目不共享词面时 BM25 系统性失败）。
- 融合公式建议：直接上 RRF(k=60) 最省事；若有评测集可调参，CC（β≈0.45-0.5）理论更优（Bruch et al.）。**避免直接把无界 BM25 分数与 cosine [0,1] 相加**——要么 RRF（只吃 rank），要么先归一化。

---

## 2. Reranker

| 方案 | 机制 | 数字与出处 | 延迟/成本 |
|---|---|---|---|
| **cross-encoder（bge-reranker-v2-m3 等）** | query+候选拼接过 cross-encoder 打相关性分 | Zep 在生产管线中用 BGE 系列做 rerank（[arXiv:2501.13956](https://arxiv.org/abs/2501.13956) §3.2）；SemEval-2026 MTRAGEval 三阶段管线（query rewrite → BM25+dense RRF → bge-reranker-v2-m3）比组织者 baseline **+10.7%** nDCG@5（[arXiv:2605.12028](https://arxiv.org/abs/2605.12028)） | 568M 模型，CPU 上对 20-50 个候选打分 ~50-300ms（边界情况可能超 200ms 预算；GPU 无压力）。候选数需控制在 ≤30 |
| **LLM-as-reranker（RankGPT 系）** | LLM listwise 排序 | RankGPT（EMNLP 2023, [arXiv:2304.09542](https://arxiv.org/abs/2304.09542)）：零样本 GPT-4 排序在部分 IR 基准上匹敌/超过监督方法 | 每次查询一次 LLM 调用，**确定性超过 200ms 预算**，只适合异步/离线 |
| **EARM（经验摊销 rerank，2026）** | 把历史 LLM 相关性打分存成稀疏矩阵，矩阵补全预测未打分候选 | 长期对话记忆上 QA 准确率比语义检索 **+6.62%**，只需对 **17.5%** 候选做真实 LLM 打分（[arXiv:2608.22767](https://arxiv.org/abs/2608.22767)） | 概念有趣但工程重；与我们"检索访问加成"思路相通 |
| Cohere rerank API | 托管 cross-encoder | （未找到公开基准数字可引用——推测：与 bge-reranker 同级） | API 网络延迟，不建议用于 200ms 内路径 |

### 适配判断

**适合，但要选小模型 + 小候选集**。我们 top-k 只要 ~10 条，用 bge-reranker-v2-m3（或更小的 bge-reranker-v2-gemma/minicpm 级）对 BM25 top-30 重排，是我们弱项（multi-session：BM25 可能把两条证据都捞进 top-30 但排序不佳）的**直接对症药**。LLM rerank 在线路径不可行（延迟），EARM 式的"历史相关性复用"可作为远期方向（与我们 energy/useful_feedback 机制天然兼容——推测）。

---

## 3. 查询侧优化

| 技术 | 出处 | 数字 | 成本 |
|---|---|---|---|
| **Time-aware query expansion** | LongMemEval §5.4 ([arXiv:2410.10813](https://arxiv.org/abs/2410.10813)) | temporal 类 recall **+6.8~11.3%**（强 LLM 抽时间范围时）；弱 LLM 误抽会**负增益**（E.4） | 索引侧：抽取 timestamped events；查询侧：一次轻量 LLM 调用或规则解析。对我们：可先用规则/小模型，仅在检测到时间表达时触发 |
| **HyDE** | Gao et al., ACL 2023 ([arXiv:2212.10496](https://arxiv.org/abs/2212.10496)) | 零样本下显著超 Contriever、匹敌微调检索器（跨 web search/QA/事实验证多任务） | 每查询一次 LLM 生成假设文档 → 破 200ms；且只对 dense 检索有意义。**对 preference 类（问"帮我推荐…"式隐含查询）理论上有帮助（推测）**，但延迟不允许在线做 |
| **Query expansion / multi-query** | LongMemEval §5.3 的 key expansion 是**索引侧**等价物（+9.4% recall / +5.4% QA） | 见 §0 | 索引侧做（离线成本）优于查询侧做（在线延迟） |
| 查询分解（multi-hop decomposition） | MemGAS 等多粒度工作间接覆盖；SemEval-2026 报告：multi-query expansion **反而降性能**（[arXiv:2605.12028](https://arxiv.org/abs/2605.12028)："more complex strategies such as domain-aware prompting and multi-query expansion degrade performance"） | 负证据 | 不建议作为第一刀 |

### 适配判断

**最值得做的是 time-aware 索引 + 查询时间范围检测**（直接打 temporal-reasoning 与 knowledge-update；我们的 energy 衰减已经把"时间"混进了排序分数，但**衰减不能替代日期锚定**——"上周我推荐了什么"需要显式时间过滤）。HyDE/multi-query 在线做延迟不达标，且已有负证据。索引侧 fact expansion 与 LongMemEval 官方最佳实践一致，且我们的 HarmonicUnit 已有 primary_abstraction + cue_anchors 双字段——相当于已部分实现。

---

## 4. 记忆检索专门系统

| 系统 | 检索机制 | 基准数字（出处） | 对我们 |
|---|---|---|---|
| **Zep / Graphiti**（[arXiv:2501.13956](https://arxiv.org/abs/2501.13956)） | 时序知识图谱（episode→entity→community 三层）；检索 = cosine + BM25 + BFS 三通道 → rerank（RRF/MMR/cross-encoder）；bi-temporal 边失效（t_valid/t_invalid） | LongMemEval-S：full-context 60.2% → Zep **71.2%（+18.5% 相对）**，延迟 28.9s→2.58s（-90%），上下文 115k→1.6k tokens。**分题型**：temporal-reasoning +38.4% 相对、multi-session +30.7% 相对、single-session-preference +184% 相对（20.0%→56.7%）；single-session-assistant **-17.7%**（负增益警告：图抽取丢细节） | 架构参考意义大：tri-hybrid 检索 + 显式时间边正是我们三个弱项的对症组合。但完整 KG 构建（LLM 抽实体/事实/消解）成本高 |
| **Mem0**（[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)） | LLM 事实抽取 + ADD/UPDATE/DELETE 决策 + 向量检索；图变体 Mem0ᵍ | LOCOMO：LLM-judge 相对 OpenAI 记忆 **+26%**；图变体再 +2%；p95 延迟比 full-context **-91%**，token -90% | 检索本身是普通向量检索，增益主要来自**写入侧**（事实抽取+冲突更新）。我们的 MinHash soft-supersede 已覆盖部分功能 |
| **A-MEM**（NeurIPS 2025，[arXiv:2502.12110](https://arxiv.org/abs/2502.12110)） | Zettelkasten 式：写入时生成关键词/标签/上下文 + 链到历史记忆 + 记忆演化 | LoCoMo GPT4o-J=40.81（MemGAS 论文 Table 1 复现值），LongMemEval-S R@10 未单独报；在 MemGAS 对照中低于 MemGAS/HippoRAG2 | 链接机制与我们的 merged_from/top_associations 设计方向一致；**检索时无 PPR 传播，增益有限** |
| **HippoRAG 2**（ICML 2025，[arXiv:2502.14802](https://arxiv.org/abs/2502.14802)） | 实体 KG + Personalized PageRank 传播 | 联想记忆任务比 SOTA embedding **+7%**；LongMemEval-S R@10=91.28、LoCoMo 4o-J=45.62（MemGAS Table 1/2） | PPR 对 multi-session 有效（证据靠共享实体串联），但索引需在线维护 KG |
| **MemGAS**（[arXiv:2505.19549](https://arxiv.org/abs/2505.19549)，华为诺亚等） | **多粒度**（session/turn/summary/keyword）+ GMM 聚类建关联边 + **熵路由器**自适应选粒度权重 + PPR + LLM 过滤 | LongMemEval-S：QA 60.20 vs 最好 baseline 57.6（HippoRAG2）；检索 R@10=**94.47** vs HippoRAG2 91.28 vs Contriever 90.00。**multi-session 题型提升最显著**。检索延迟仅 0.024s | 与我们的 HarmonicUnit（abstraction_level 分层 + MinHash 合并）结构高度相似；其"熵路由器按查询选粒度"是低成本高适配的想法 |
| **MIRIX**（[arXiv:2507.07957](https://arxiv.org/abs/2507.07957)） | 六类记忆 + 多 agent 路由 | LOCOMO **85.4%**（SOTA 宣称） | 重型多 agent 架构，不适合 <200ms |
| **Letta/MemGPT**（[arXiv:2310.08560](https://arxiv.org/abs/2310.08560)） | agentic archival search（LLM 自主翻页检索） | DMR 93.4%（被 Zep 94.8% 超过；且 full-context 基线已达 94.4%，说明 DMR 已饱和——Zep 论文 §4.2 原话） | **我们自己的实验已验证 agentic 全索引扫描零增益**，与文献趋势一致 |
| **LightRAG**（[arXiv:2410.05779](https://arxiv.org/abs/2410.05779)） | 双层检索（low-level 实体 + high-level 主题关键词）+ 图增强 | "considerable improvements in retrieval accuracy and efficiency"（摘要，无 LongMemEval 数字） | 双层 key（具体+抽象）思想与我们 primary_abstraction/cue_anchors 类似 |
| **MemOS**（[arXiv:2507.03724](https://arxiv.org/abs/2507.03724)） | MemCube 统一 plaintext/activation/parameter 三层记忆 + 调度 | （架构论文，检索机制非重点） | 参考其记忆分层治理思想 |

---

## 5. LongMemEval 高分方案用了什么技巧

综合 §0（官方论文）、Zep、MemGAS、LINE 四个有直接 LongMemEval/同类数据数字的来源，高分方案的共同配方：

1. **Chunking/粒度**：官方论文发现 round 优于 session（但 fact 压缩有损总体）；MemGAS 证明**多粒度并存 + 按查询路由**优于任何单一粒度；我们内部测得 session 粒度（0.949）优于 round（0.277）——差异来自我们把全文放进了 primary_abstraction 供 BM25 检索（粒度与索引字段耦合，不可孤立比较）。
2. **时间戳注入**：官方 time-aware indexing（事件抽日期）+ 查询时间范围裁剪（+6.8~11.3% temporal recall）；Zep bi-temporal 边（temporal +38.4% 相对增益）。**几乎所有高分方案都做显式时间处理**，没有任何一家只靠"时间衰减分数"。
3. **Key expansion / 多字段索引**：官方 fact-augmented key（+9.4% recall）；LINE 的 embedding_text（摘要+原文拼接）表示使 BM25 与向量双双受益。
4. **Hybrid + rerank**：Zep = cosine+BM25+BFS → cross-encoder rerank；SemEval-2026 方案 = rewrite + BM25/dense RRF + bge-reranker。
5. **图传播（PPR）**：HippoRAG2/MemGAS 对 multi-session 增益最大（Zep 的 BFS 同理）——机制上都解决了"单查询只命中部分证据"的问题。
6. **阅读侧**：Chain-of-Note + 结构化格式 +10 点（官方 §5.5）；15-19% 错误是"检索对、生成错"——**检索优化有收益上限，阅读侧是另一半**。

---

## 6. 实用工程技巧汇总

- **RRF 常数**：k=60（原始论文 Cormack et al. SIGIR 2009；Elastic/OpenSearch/Zep 实现均沿用）。Bruch et al. 2023 证明 RRF 对 k 敏感，若有评测预算可调 k∈[20,100]。
- **分数归一化**：不要裸加 BM25（无界）与 cosine（[0,1]）。选项：(a) RRF 只吃 rank，零调参；(b) CC + min-max 归一化，Bruch et al. 证明归一化方式对 CC 不敏感、一个 β 即可（LINE 报告 β=0.45）。
- **per-type 策略**：LongMemEval 的 abstention 类要求"检索不到就拒答"——需要一个**相关性阈值/置信截断**（我们已有 searchScored 原始分返回，正好可用）。preference 类在几乎所有系统里都是低点（Zep full-context 只有 20-30%），它的瓶颈在**阅读侧的个性化生成**而非纯检索（推测，与官方 §5.5 一致）。
- **时间衰减与语义分数的融合**：文献中两条路线——MemoryBank 式 Ebbinghaus 衰减乘性因子（[arXiv:2305.10250](https://arxiv.org/abs/2305.10250)，我们的 energy 即此类）与 Zep 式显式时间边/时间过滤。证据表明**显式时间处理（过滤/锚定）增益远大于衰减调权**（temporal 类 +38% 相对 vs 衰减无独立增益报告——推测）。
- **索引侧 vs 查询侧**：凡能离线做的（key expansion、事件抽取、摘要、多粒度）都放写入路径；查询侧只留确定性逻辑（时间范围解析、类型路由），LLM 查询改写在线做基本都会被 200ms 预算否决。

---

## 7. 综合推荐（按 预期增益 / 实现成本 排序）

| 排名 | 优化 | 针对弱项 | 预期增益 | 实现成本 | 依据 |
|---|---|---|---|---|---|
| **1** | **混合检索：BM25 + BGE-M3 dense + RRF(k=60)**，能量/显著度作为融合后的乘性因子保留 | multi-session、preference（语义不共享词面的查询） | 中（我们 BM25 头部空间小；LINE 同类场景 BM25→hybrid R@5 +0.113 是上界参考） | 中：写入加 embedding，检索加内存向量扫描（<10ms），无 API 依赖 | LongMemEval Table 9（dense>BM25）、LINE 2608.27809、Bruch 2210.11934 |
| **2** | **Time-aware 索引 + 查询时间锚定**：写入时抽取带日期事件（cueAnchors 加日期 token）；查询侧规则检测时间表达 → 元数据过滤而非衰减调权 | temporal-reasoning、knowledge-update | 官方 +6.8~11.3% temporal recall；Zep temporal +38.4% 相对 | 中：抽取放 turnCompress worker（已有 LLM 通道），查询侧规则零延迟 | LongMemEval §5.4/E.4、Zep Table 3。**注意用强模型或规则避免误裁剪** |
| **3** | **轻量 cross-encoder rerank**（bge-reranker-v2-m3，top-30 → top-10） | multi-session（证据进了候选池但排序分散） | SemEval 三阶段管线 +10.7% nDCG@5（含前两阶段贡献，rerank 独立贡献推测 ~3-5%） | 中低：单模型本地加载，30 候选 CPU ~50-150ms，贴近预算上限需实测 | arXiv:2605.12028、Zep §3.2 |
| **4** | **关联图 + PPR 传播**（复用 merged_from/cue_anchors 建轻量图，检索后对 top 条目做 1-hop 扩展） | multi-session（核心弱项，证据跨多条目） | MemGAS multi-session 题型提升最显著；HippoRAG2 联想 +7% | 高：需在线维护关联边；可先实现"cue_anchor 共享即边"的零 LLM 版本 | arXiv:2505.19549、2502.14802 |
| **5** | **多粒度路由**（熵路由器：按 query 对各字段得分分布的熵自适应加权 primary_abstraction vs cue_anchors vs 全文） | multi-session、preference | MemGAS 整体 R@10 94.47 vs 单粒度 90.00 | 中：我们已有多字段，只需加路由权重逻辑 | arXiv:2505.19549 |

**不建议做**：agentic 全索引扫描（已自证零增益，且与文献一致）、在线 HyDE/multi-query（延迟 + 负证据）、LLM-as-reranker 在线路径（延迟）、完整时序 KG（Zep 式，成本/收益不匹配当前规模——但注意其 single-session-assistant -17.7% 的教训：激进压缩/抽取会丢细节，我们保留全文的策略是对的）。

**最后的提醒**：LongMemEval 官方错误分析（E.5）表明 15-19% 样本"检索对、生成错"——检索侧把 multi-session/preference 从 0.375 提到 ~0.6 后，**阅读侧（Chain-of-Note 式证据抽取 + 结构化注入格式，+10 点）是下一个收益点**，且我们的 `inject-format.ts` 正是动这个的地方。
