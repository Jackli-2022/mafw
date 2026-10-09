# 如何让记忆系统更像大脑：curator 为中心的改造调研

> 日期：2026-10-08
> **本文是附录一（7 方向全量论证）；整合层与路线图见 `2026-10-08-brain-like-roadmap.md`**
> 前序：同日的 curator vs 脑巩固机制对比（差距清单的出处）
> 方法：先列差距 → 找业界先例（本次实际拉取验证 4 篇 arxiv 锚点）→ 对照现有基建 → 给可落地改法与测量面
> 测量方法论沿用 R1–R8 约定：先问测量面（召回类看 R@k、重排类看 R@1/NDCG、门控类看 AUROC、呈现类只能看 L2、写端保真看冻结样本对照）

## 0. 差距回顾（要追的目标）

curator 管线和脑的巩固机器结构同构，但有六个本质差距：

1. **权重 vs 文本**：脑学习=突触改写，知识即连接；我们学习=外置文本条目，检索成本永续
2. **同基质重放 vs 二手转述**：脑由同一批神经元重放体验；我们由更弱的模型读另一个模型的行为记录
3. **重构性 vs 静态文本**：脑每次回忆都在改写记忆（reconsolidation，Nader 2000）；我们的条目只在周期抽查时修补
4. **gist 存活 vs verbatim 永存**：脑遗忘细节先死、要点存活（Fuzzy-Trace Theory，Brainerd & Reyna）；我们 verbatim 永存，gist 靠新写条目 → 需要去重补丁
5. **做梦（生成性回放）缺失**：脑用记忆模拟未来场景；我们只有整合性回放（B1 reconcile）
6. **显著性外生**：脑的多巴胺/杏仁核是体验内生信号；我们的 obsSalience/importance 是旁观者估计

## 1. 业界锚点（本次验证）

| 工作 | 机制 | 对我们的意义 |
|---|---|---|
| **HippoRAG**（NeurIPS 2024，arXiv:2405.14831） | 海马索引理论：KG + Personalized PageRank 做扩散激活检索；单步检索打平/超过 IRCoT 多步迭代，便宜 10-30× | 扩散激活的直接先例：我们的 cue-anchor 有界多跳是它的低配版 |
| **Sleep-time Compute**（Letta/Berkeley，arXiv:2504.13171） | 离线"睡眠"时预算用户会问什么、预计算答案；test-time 算力省 ~5×，效果与查询可预测性正相关 | 做梦/预测性回放的直接先例；我们的 R8 预取快照已是其雏形 |
| **MemoryBank**（AAAI 2024，arXiv:2305.10250） | 艾宾浩斯遗忘曲线（时间×重要性的强化/遗忘）+ 日总结 + 人格画像综合 | 差异化衰减 + 叙事自我的先例 |
| **EM-LLM**（ICLR 2025，arXiv:2407.09450） | Bayesian surprise 做在线事件分段（预测误差决定边界）；检索两路：相似度 + 时间连续性 | surprise 作为内生显著性信号的工程化先例 |

知识库引用（本次未拉取验证）：Titans（Google 2025，神经记忆模块 + surprise 写入门）、Nested Learning / HOPE（Google，NeurIPS 2025，多时间尺度学习层——与我们 T1/episodic/semantic/L5 阶梯同构）、Larimar（IBM，NeurIPS 2024，快权重情景记忆编辑）、HippoRAG 2（2025）、deep generative replay（Shin et al., NeurIPS 2017）。

## 2. 方向清单（脑机制 → 改法 → 测量）

### D1. 差异化衰减：让 gist 存活、verbatim 先死（Fuzzy-Trace）

- **现状**：统一 0.005/天，verbatim 与 gist 同速衰减；reflection 写出 gist 后源 episodes 原样保留
- **改法**：按 `abstraction_level` 分档衰减率（level 1 episodic 快，如 0.01/天；level 2 semantic/procedural 保持 0.005；level 3 L5 近零）；reflection 成功蒸馏后把源 episodes 走既有 soft-supersede 链降能（基础设施已有：`superseded_by` + `resolveSupersededHeads`）
- **测量**：冻结样本保真探针 + 检索 R@k 回归（防 gist 化丢细节）

### D2. 检索即重写（reconsolidation）

- **现状**：检索命中只结 ACT-R energy bonus，内容不变；`reconsolidation queue` 有雏形未接线
- **改法**：命中后进入"不稳定窗"——若当前上下文与该记忆冲突或可精化，触发 curator 更新（走 supersede 链）。触发信号已有：RetrievalEventBuffer 的 7 天 need 计数（高频 = 值得重写）。约束：仅当**检测到冲突/精化**时改写（防脑式错误记忆污染），改写保留 `verified:` 锚点语义
- **测量**：冲突修正率（改写次数/命中次数）+ 用户纠错后旧值复发率

### D3. surprise 门控写入（内生显著性）

- **现状**：obsSalience 是文本启发式；consolidation 已有向量基建（minCosine 阈值判 UPDATE/CREATE）
- **改法**：写入时 novelty = 1 − maxCosine（对最近邻的向量距离）作为 importance 先验——与脑的多巴胺"预测误差驱动巩固"同构；consolidation 的 cosine 召回本来就要算，边际成本≈0
- **测量**：importance 分布的健康度（不再全部 0.8）+ 高 novelty 条目的后续检索命中率

### D4. 做梦：生成性回放（Sleep-time Compute 的直接对应）

- **现状**：R8 快照只做"话题延续"的被动预取；B1 回放只做 reconcile（整合，不生成）
- **改法**（两个子件）：
  - **D4a 预测性预取扩展**：从活跃 goal + 高 need 记忆生成"明天最可能被问什么"，预建跨会话快照。Sleep-time Compute 的关键发现直接适用：效果与查询可预测性正相关——我们的用户（单一用户、重复工作流）可预测性高
  - **D4b 反事实模拟**：新 goal 启动时，从失败 episodic 记忆生成风险清单注入 plan 节点（"上次做这类事踩过什么坑"——做梦的规划功能）
- **测量**：D4a 用现有 `[Recall] snapshot served/skipped` 日志的命中率；D4b 用 goal PASS 率 + failure_kind 分布

### D5. 扩散激活检索（HippoRAG 化）

- **现状**：cue-anchor 有界多跳 + dense RRF + R6 邻居呈现；检索图谱是静态的
- **改法**：以 cue_anchors + 实体共现建轻量图，用 Personalized PageRank 替换/增强有界扩展；schema 簇（S2 已有 buildSchemaClusters）作为 pattern completion 目标——命中簇心时整簇梗概送达
- **测量**：LongMemEval 基准（管线现成，session 粒度 R@10 现为 0.949——天花板近，重点看 multi-session 短板 0.375）

### D6. 第一人称重放（减二手损耗）

- **现状**：curator 是更弱的模型（glm-5.3-flash）读主模型的转录
- **改法**：reflection 的 evidence block 从 BM25 摘要升级为 turn 级原文（t1_archive 还在）；更进一步，让主会话模型自己做每日自反思（同基质重放）——成本换保真
- **测量**：reflection 产出的 downstream 引用率（distilled 条目被检索命中/被 supersede 的比例）

### D7. 叙事自我（MemoryBank 人格综合的对应）

- **现状**：manager session + goal snapshot 有部分连续性，但无跨天的"我"的容器
- **改法**：每日一条第一人称"日记"条目（curator 写，跨会话），既是自传体锚也是高层抽象的天然容器；MemoryBank 证明这对长期陪伴型 agent 有效
- **测量**：定性 + 用户主观连续性评分

## 3. 优先级建议

按**基建已有程度 × 测量可达性**排序：

| 序 | 方向 | 基建 | 成本 |
|---|---|---|---|
| 1 | D1 差异化衰减 | 纯参数 + 已有 supersede 链 | 极低 |
| 2 | D3 surprise 门控 | consolidation 向量基建现成 | 低 |
| 3 | D4a 预测性预取 | R8 快照管线现成 | 低 |
| 4 | D2 检索即重写 | need 信号现成，缺触发管线 | 中 |
| 5 | D4b 反事实模拟 | goal 编排 + 失败记忆已有 | 中 |
| 6 | D5 PPR 扩散激活 | 需建图；LongMemEval 可测 | 中 |
| 7 | D6/D7 | 体验层改造 | 高 |

## 4. 不做的事（显式排除）

- **权重级巩固（周期性 LoRA fine-tune）**：脑的真实机制，但当前蓝区无训练基建，且灾难性遗忘风险需要自己的 replay 管线才有解——列为远期愿景，不进路线图
- **情绪模拟**：obsSalience 的启发式已够；伪造情绪信号没有测量面
