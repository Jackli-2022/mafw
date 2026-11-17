# 参数标定的正规做法：业界共识与可执行清单

> 2026-11-19。触发：T1 atom 参数审计发现 baseline 只用了“前 24 条”参考文本、阈值没有目标函数。
> 本文只回答一件事：**业界在同类问题上到底怎么做**，以及我们该照哪几条做。

## 1. 共识不是“某个数值”，而是流程

检索/推荐/去重/记忆系统在参数标定上的共识是五件事，不是一组魔法数字：

1. **切分**：调参只看 validation，test 只用一次；时间序列按时间切，别随机打乱。
2. **指标与目标函数**：先定“优化什么”（recall@k、nDCG、precision@target、atoms/turn 预算），再谈阈值。
3. **不确定性**：所有指标带 bootstrap 置信区间；系统比较用 paired randomization / bootstrap，不用 Wilcoxon/sign。
4. **稳定性**：换参考样本、换查询类别、换模型版本，参数是否还成立；不稳定就报告区间，不报单点。
5. **版本化**：参数与模型 tag、数据 hash、样本量、目标指标绑定；任何一项变了就重标。

## 2. 阈值：PR 曲线 + 目标，不是 ROC + 感觉

业界标准做法（检索、RAG、去重都一致）：

- **用 PR 曲线，不用 ROC**：正例稀少时，ROC 的 FPR 不随 base rate 变，precision 会。
  同一个阈值在 50/50 校准集和 5/95 生产集上，precision 可以差 20 个点以上。
- **先定目标，再选阈值**：例如“precision ≥ 0.95 的前提下最大化 recall”，
  在 held-out 集上扫阈值，取满足目标的最高 recall 点。
- **阈值只在同模型/同模态/同任务内有效**；换 encoder 必须重标——这是最常见的静默回归来源。
- **校准集规模**：几百个带标注的 pair/查询起步；少于 50 个查询的 eval 只能当 smoke test。
- **类别分层**：不同查询类别的阈值可能差很多；差得多就用 per-class 阈值，不要一个全局 cutoff。

对应到我们：

- `minScore/minTop1` 不是“常数”，是 PR 曲线上的 operating point；
- `0.08` 应该由查询侧正/负分布定，而不是让一个例子弃权；
- 16 条 fixture 只能证明“没坏”，不能支撑阈值。

## 3. 不确定性：bootstrap 是标配

IR 社区几十年的 settled practice：

- 对 **per-query** 分数做 bootstrap（重采样查询，保持配对），得到指标的 95% CI；
- 系统 A vs B 用 **paired randomization / paired bootstrap**；Wilcoxon/sign 在大样本下假阳性偏高，不推荐；
- 报告 **effect size + CI + 样本量**，不要只报 p 值；多重比较要校正；
- NDCG 这类指标也用 bootstrap CI，不要只报一个均值。

对应到我们：atom 的 recall@3 = 1.000 是 16 条查询的点估计；按 bootstrap，95% CI 可能宽到 0.8–1.0，
不能拿它证明“参数对”。

## 4. 稳定性：换样本、换类别、换版本

正规做法不是“选一个最优参数”，而是：

- 用多个参考样本/多个 fold 重复标定，看最优参数的分布；
- **stability selection**：只保留在多数重采样下都稳定的特征/阈值，报告 stability path；
- **sensitivity band**：给出参数 ±ε 时指标的变化；如果变化大于收益，说明参数不可辨识；
- **hard-negative gallery**：保留最难的负例，每次换模型/改参数都重跑；
- **conformal risk control**：如果损失对阈值单调，可以用 calibration set 选阈值并给出
  `E[loss] ≤ α` 的有限样本保证（Angelopoulos et al., ICLR 2024）——比“拍一个阈值”强得多。

对应到我们：baseline 在三个 24 条样本间的 Jaccard 只有 0.55–0.73，说明当前参数**不可辨识**；
正确结论是“这个区间内的原子集合都差不多，先别声称某个阈值更优”。

## 5. 稀疏检索/嵌入参数的特殊性

- 稀疏检索（SPLADE/BGE-M3 sparse）调的是 `top-k`、词权重、稀疏度；标准做法是
  **held-out recall@k vs 延迟/存储** 的帕累托曲线，不是单点。
- 嵌入阈值（dedupe、聚类）常用：
  - 有标签：PR 曲线 + 目标 precision；
  - 无标签：**EER**（等错误率）或 null 分布的 p95/p99；
  - 记录 linkage：Fellegi–Sunter / EM 估计匹配概率，再按错误成本定阈值。
- 记忆系统（A-MAC 等）的做法是**学习准入权重**（utility/confidence/novelty/recency/type），
  而不是手调 novelty 阈值。

## 6. 我们的 atom 参数该怎么重标（可执行）

1. **参考集**：随机分层抽 240–500 条文本（按 session/来源分层），冻结 + 记录 hash；
   baseline 报告每 anchor 的 mean ± SE；换模型重算。
2. **标注查询集**：≥50 条查询（最好 100），带“应命中/不应命中”或 graded relevance；
   与调参集分开（train/val/test 或 5-fold）。
3. **阈值选择**：在 validation 上扫 `topK × minScore × minTop1`，画 recall@3 vs atoms/turn 的帕累托前沿；
   按“固定 atoms 预算最大化 recall”或“precision ≥ 目标”选 operating point。
4. **不确定性**：per-query bootstrap 2000 次，报告 CI；参数比较用 paired randomization。
5. **稳定性**：5 个参考样本 × 5 个 fold，报告最优参数的分布与 sensitivity band；
   若 0.02 与 0.03 的 CI 重叠，就不要声称哪个更好。
6. **版本化**：`{modelTag, refSampleHash, querySetVersion, thresholds, target, n}` 落库；
   换模型/换参考集必须重跑并重发版本。

## 7. 一句话

- 业界的“正规”不是某个阈值，而是：**固定切分 + 明确目标 + PR 曲线 + bootstrap CI + 稳定性/敏感性 + 版本化**。
- 没有标签时：用 null 分布分位数或 conformal risk control，不要拍数字。
- 参数不可辨识时：报告区间，不要报单点；宁可少一个“优化”，也不要一个假的精度。

## 参考

- Sakai, *Statistical Reform in Information Retrieval?* SIGIR Forum 2014（effect size + CI）。
- Sakai, *Evaluating Information Retrieval Metrics Based on Bootstrap Hypothesis Tests* (2007)。
- Smucker, Allan & Carterette, *A Comparison of Statistical Significance Tests for Information Retrieval Evaluation* (2007)。
- Soboroff, *Computing Confidence Intervals for Common IR Measures* (EVIA 2014)。
- Angelopoulos et al., *Conformal Risk Control*, ICLR 2024（阈值 + 有限样本风险保证）。
- Meinshausen & Bühlmann, *Stability Selection* (2010)。
- A-MAC, *Adaptive Memory Admission Control for LLM Agents*, arXiv:2603.04549（学习的多因子准入）。
- 本仓：`docs/research/2026-11-19-atom-parameter-audit.md`（我们的实测）。
