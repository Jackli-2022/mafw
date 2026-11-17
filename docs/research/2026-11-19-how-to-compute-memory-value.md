# 记忆价值该怎么算：从“拍脑袋设值”到可估计的 VOI

> 2026-11-19。问题：给 need / gain / tag 设权重，不能凭感觉定一个数，也不能把几个启发式投票平均。
> 本文给出可计算的量、可用的估计方法、以及在没有标签时的正确做法。

## 1. 先定义“算什么”，而不是“设多少”

不要问“novelty 权重 0.3 还是 0.5”，先定义一个**可被结果检验的目标量**：

> **记忆价值 = 因这条记忆而减少的期望任务损失**（Value of Information, VOI）
> `VOI(m) = E[L(决策 | 没有 m)] − E[L(决策 | 有 m)]`

- 这个定义来自决策论（Raiffa & Schlaifer；Howard），不是我们发明的。
- 2026 年有两篇直接对应的论文：
  - **《The Value of Memory in Language Agents》**（arXiv:2610.31303）：把记忆价值写成“避免的任务损失”，
    并给出风险–成本前沿；还指出**一个零互信息的指针也能降低精确恢复的成本**——所以不能只用“相关性”当价值。
  - **《Cheap Retrieval and Observation Credit Assignment from One Quantity: The Value of Information》**
    （arXiv:2610.40030）：从**归档轨迹**里用学到的世界模型估计 VOI，并证明它给出最优检索集合。

一旦目标量是“损失减少”，权重就不再是审美问题：它由数据估计，估计不出来就不该上线。

## 2. 三个量的可计算定义

| 量 | 严格定义 | 可算的代理 | 不能用的东西 |
|---|---|---|---|
| need | 未来占用：`Σ_t γ^t P(s_t = s \| 当前策略)` | 任务图上的 Personalized PageRank；或“未来 N 轮被引用”的校准概率 | 过去 7 天检索次数（向后看） |
| gain | `E[L_without − L_with]`（VOI） | 反事实消融的损失差；top-1/top-2 分数差；判官冲突分 | “我觉得重要” |
| tag | 编码时的调制（唤醒/PE/信息缺口） | 用户纠正、工具错误、未解决问题、goal 失败/重试的事件标记 | 把 tag 当最终分数 |

**关键**：gain 是**决策量**，不是文本量。文本相似度只能当 gain 的**特征**，不能当 gain 本身。

## 3. 怎么估计（按成本从低到高）

### 3.1 有结果标签时：直接学排序/校准

- 标签：goal verdict（成功/失败/重试）、任务是否完成、用户是否纠错。
- 模型：逻辑回归或小 GBDT，特征 = need 代理 + gain 代理 + tag；加**单调约束**（need/gain 越大分数越高），
  这样权重是学出来的、可解释的。
- 评估：
  - 排序：time-split 的 NDCG / AUC；
  - 概率：ECE / Brier（如果要拿它当阈值）；
  - 业务：相对现有策略的 **lift**（成功率、重试率、token 成本）。
- 样本：至少几百个决策；报告 95% CI。CI 跨 0 就不上线。

### 3.2 没有结果标签时：先做反事实消融（gold，但贵）

- 抽样 100–200 个决策，对每个决策跑两次：带记忆 / 不带记忆，比较下一步动作或最终结果。
- 得到每条记忆的 `Δloss`，作为 gain 的**金标签**；用它验证便宜代理（margin、冲突分）的秩相关。
- 这是唯一能回答“这条记忆到底有没有用”的方法；LLM 自评“重要性”不算。

### 3.3 连消融都做不了：只记录，不决策

- 记录每次检索的候选、分数、最终是否被引用、任务结果；
- 等数据够了再拟合；
- 期间用**现有策略**，不加新权重。没有标签就上线，本质是拿用户做实验。

### 3.4 需要探索时：带置信上界的探索，而不是平均

- 如果必须在线收集，用 Thompson sampling / UCB 在“候选策略”之间分配，而不是把几个启发式投票。
- 探索比例要小、可回滚，并记录反事实（哪个策略被选中、其他策略的预估）。

## 4. 为什么“多数投票”不行

1. **相关性**：novelty、length、salience 彼此相关，投票等于重复计票。
2. **没有校准**：三个 0.6 分的来源，真实概率可能分别是 0.2/0.5/0.8。
3. **不可检验**：投票规则没有目标函数，无法回答“加上它之后任务损失降了多少”。
4. **辛普森悖论**：分 session 看都更好，合起来可能更差（我们的长度混淆就是例子）。

## 5. 对 MAFW 的最小落地方案

1. **记录决策轨迹**（先不改行为）：
   - 每次反思/回放：候选 id、need 代理、gain 代理、tag、最终选了谁；
   - 结果：goal verdict / 是否重试 / 是否被用户纠正。
2. **建标签**：`success = 1`，`retry/corrected = 0`；没有结果的样本丢弃，不猜。
3. **拟合 + 校准**：逻辑回归（单调约束）→ ECE + lift；time-split。
4. **反事实验证**：抽 100 个决策做“有/无该记忆”的消融，看模型分数与 Δloss 的秩相关。
5. **shadow → 小流量**：先只记录新策略的选择，与旧策略对比 top-k 重合和成功率；显著更好才切。
6. **失败就停**：lift 的 CI 跨 0，或校准很差，就保留旧策略，不引入新权重。

## 6. 一句话回答

- **不是“想到一个值”**：先把价值定义成“减少的任务损失”，再用结果估计。
- **不是“大多数这样”**：多个启发式投票没有目标函数、没有校准；要么学权重，要么做反事实消融。
- **没有标签时**：只记录、不决策；需要探索就用 UCB/Thompson，而不是平均。

## 参考

- Lin et al., *The Value of Memory in Language Agents*, arXiv:2610.31303 (2026).
- Strauss et al., *Cheap Retrieval and Observation Credit Assignment from One Quantity: The Value of Information*, arXiv:2610.40030 (2026).
- Raiffa & Schlaifer, *Applied Statistical Decision Theory* (1961)；Howard, *Information Value Theory* (1966).
- Mattar & Daw, *Nature Neuroscience* 2018（need × gain）。
- Keisler et al., *Value of information analysis: the state of application* (2014).
- 本仓：`docs/research/2026-11-19-memory-selection-need-gain.md`
