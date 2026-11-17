# P1 之后的深度思考：先证明“记忆有用”，再谈“更像大脑”

> 2026-11-19。子代理 `kimi-code-plan-cn/k3.1-pro` 深度思考产出，父会话整理。
> 前置：`docs/releases/2026-11-19-engram-p1-result.md`（P1 失败）、
> `docs/research/2026-11-19-hippocampus-cortex-design-kimi.md`。

## 0. 结论

**当前数据量与标签质量下，不值得继续做任何表示学习。**
P1 后应转向：**结果账本 → 即时 VOI pilot → 正式 paired 确认 → need/gain 离线调度**；
皮层侧只做可审计的慢统计与 schema 图，不做生成式网络。

准确说法：
- P1 没有证明“表示层永远不是瓶颈”；
- P1 证明的是：在 2,263 条训练 turn、粗 episode 标签、低秩 tied autoencoder、复合损失、小验证集下，
  表示学习**不可识别、不能稳定泛化，并破坏检索**；
- 已被证据支持的瓶颈是：**没有“记忆对行为结果”的因果标签，因此不知道要优化什么**。

## 1. P1 的三种解释与区分实验

- H1：表示不是瓶颈，dense 已足够。
- H2：数据/训练不支持表示学习，标签和样本改善后可能受益。
- H3：优化目标错了——episode 分离与记忆效用无关。

| 实验 | 做法 | 判读 |
|---|---|---|
| A 标签审查 | 300 个 matched pair（150 同 episode / 150 跨 episode），人工标“同一任务状态 / 是否所需证据 / 0-1-2 相关性” | episode 标签与人工大量不一致 → 目标/标签问题；同 episode 都无法稳定标注 → 不能继续用它训练 |
| B dense twin | 同数据/同低秩/同损失，只去掉 TopK | dense twin 正常、稀疏 twin 塌缩 → 稀疏优化问题；两者都过拟合 → 数据/监督问题 |
| C 学习曲线 | 按独立 session 32/64/全量，固定配置，≥5 seeds | 随 session 增加稳定上升 → 数据不足；平坦且 CI 排除最小收益 → 不再做表示 |
| D 任务价值 | 有/无该表示的 paired ablation 算 ΔL | AUC/R@10 提升但 ΔL 无关 → 代理目标错误 |

优先级：**A → D**；B/C 只用于未来复盘，当前不马上再跑表示实验。

## 2. 推荐的最小架构（三层的分工）

1. **T1 + 冻结索引**：raw 不可变、精确 trace、dense/BM25/concept tags/RRF。`sem:` 叫 concept tags，不叫 DG。
2. **Harmonic + schema 统计图**：文本 unit 仍是事实权威；新增跨 episode 关系计数、独立 session/day 支持度、
   结果统计、矛盾/supersede 统计；不训练生成式皮层。
3. **价值与调度层**：决策/候选/注入/结果账本 + 离线 VOI 估计；只有这一层可以学习排序/校准，且先 shadow。

### 明确放弃

继续扫 learned k-WTA / 扩 M / 调 hub；随机扩张/Modern Hopfield/分布式 adapter；稀疏码替代 dense；
继续加手工 anchor；LLM 自评当 gain；goal 成败直接归因到单条记忆；`|RPE|` 当价值；
在 100ms 边界训练/调 LLM/自适应图更新；生成无逐句来源的“重构记忆”。

## 3. 价值层：两个 gain 必须分开

**即时检索价值**：

```
G_use(m,d) = E[ L(d; S\{m}) − L(d; S) | X_d ]
```

**回放价值**：

```
G_replay(m) = E[ L(no replay) − L(replay) ]
```

即时消融**不能冒充** replay gain；只能先当候选代理，之后必须做回放干预验证。

**need × gain 的严谨形式**（预算是约束，不是把 loss 与 token 相减）：

```
EV_m(H) = N_m(H) × G_m
max Σ x_m N_m G_m   s.t. Σ x_m C_m ≤ B
```

- `N` 是“未来遇到适用机会”的概率，不是“未来有用且改善结果”（否则与 gain 重复计数）。
- `G<0` 进纠正/审计队列，不自动删除 raw。

## 4. 事件账本（字段级）

所有表带 `schema_version, event_id, event_seq, ts_utc, session_id, goal_id, goal_revision, policy_version`。
`event_seq` 用于异步落账排序，不能只靠时间戳。

- `decision_event`：phase、turn/query trace、task_type、index/embedding/model/context 版本、token 预算、延迟、fallback。
- `candidate_event`：每个候选（不只选中的）、各通道 rank/score、need/recency/salience/energy、
  schema 支持、矛盾数、selected/injected、selection_probability、位置。
- `exposure_event`：decision/memory、assistant message、tool call、explicit citation、cited span、use_label_source。
- `outcome_event`：verdict（PASS/FAIL/ABANDONED/UNKNOWN）、verdict_source、success、retry、
  1/3 轮内用户纠正、tool error、耗时、成本、观察窗口、censoring。
- `ablation_pair`：with/without 集合 hash、snapshot、模型/解码/seed、arm 顺序、两臂 outcome/loss/retry/cost、validity。
- `rpe_event`：`p_success_pred`、observed、δ、linked_decision_ids（只审计范围，不分配）。
- `value_estimate`：estimand、scope、effect、CI、n_pairs/goals/sessions、dataset hash、model version。

## 5. 标签可信度排序

1. paired ablation（记忆级因果金标签）
2. 人类/机器 verifier 的 goal verdict（策略级金标签）
3. retry、用户纠正（决策级银标签）
4. 未来进入候选短名单/被注入（need 机会标签）
5. 显式引用（暴露代理，不是价值）
6. LLM importance/self-reflection（不得当金标签）

## 6. 估计器与样本量

- 即时 gain：`d_i = L_without − L_with`，`Ĝ = mean(d_i)`；
  **按 session cluster paired bootstrap ≥2000 次**；二分类可报 McNemar，但主报 effect + CI。
- 分层过抽样要用 Hajek 权重 `Σ d_i/π_i / Σ 1/π_i`，否则不能外推。
- need：L2 logistic 或小 GBDT，特征 ≤ 少量（goal/task 类型、记忆类型、历史占用、recency、上下文匹配、schema 支持）；
  ≥200 独立结果决策、正例最好 ≥50；时间切分 60/20/20；报 PR-AUC/Brier/ECE + cluster CI；
  不优于 task-type base rate 就不上线。
- gain 模型：先用分层收缩 `d_i = α + β_type + γᵀx + u_goal + ε`，低样本类型向全局均值收缩。
- 样本量：`n ≥ (z.975+z.8)² Var(d) / Δ_min²`，再乘设计效应 `DE = 1 + (m̄−1)ρ`。
  100 对只适合 pilot；3pp 的正式确认通常远不止 100 对。

## 7. 第一个实验：即时检索 VOI（不是 replay）

- 抽样条件：至少一个 Harmonic unit 被注入、有可验证结果、可恢复同一 snapshot、工具副作用可安全重放。
- 每个 pair：A = 原候选集合 S；B = S\{m}，**不补位**；其他 prompt/模型/工具状态一致；arm 顺序随机；
  m 优先取当次最高 rank 的注入 unit。
- pilot：**100 个有效 pair**，≥50 goals、≥30 sessions；全局效应是唯一主要假设，分层只作探索。
- 主终点：`L_task = 1 − success`；次终点分开报 retry/纠正/token/tool 成本，不合成一个 loss。
- 判读：
  - CI 下界 >0 且点估计 ≥3pp → 进入独立正式确认；
  - CI 跨 0 但上界 ≥3pp → 功效不足，按公式扩样；
  - CI 上界 <3pp → 已排除最小有用收益，停止价值调度开发，先查内容/接地/暴露；
  - 成本或 retry 明显恶化 → 暂停。
- 代理（margin/冲突分）必须与 `d_i` 的 Spearman ≥0.3 且 CI 下界 >0，否则不能当 gain。
- 时间：W1–2 账本与快照验收，W3–6 收集 100 对，约第 28–42 天出 pilot 读数；样本不足则 inconclusive。

## 8. RPE 的正确接法

```
δ_g = y_g − p̂_g
```

- 只用于审计采样、检查模型失误；
- 不能分配给当次所有记忆，不能把正/负 RPE 当记忆有用/有害，不能直接进 replay priority；
- `p̂` 的 Brier 不优于基础率时，RPE 连采样都不能用于生产决策。

## 9. 皮层侧：不做生成式网络也能“慢学习”

- **schema 图**：节点 = unit/goal/task type/tool/error/action/concept/episode；边 = observed_in/follows/resolves/supports/contradicts/supersedes/co_occurs。
- 每条边存 `n_episodes/n_sessions/n_days/first_seen/last_seen/positive/negative/contradiction/source_trace_ids/weight/CI/graph_version`；
  同 episode 出现十次只算一个独立支持。
- 慢更新用充分统计：`μ_n = μ_{n−1} + (x_n − μ_{n−1})/n`；关联用经验贝叶斯收缩
  `w = (n_ab + κ p_b)/(n_a + κ)`，κ 只在训练段估计并冻结。
- 保守支持 guardrail：≥3 独立 episode、≥2 session、≥2 天；报告敏感性，不称自然常数；矛盾保留双方。
- 重构 = **证据重组**：返回匹配 schema、边支持度、原始摘录、每条结论的 trace；不用先验补成无来源事实。
- 评估门槛：图覆盖查询 ≥20%；覆盖查询 R@10 +0.05；全体 +0.02 且 CI>0；
  graph-only precision ≥0.80；非 schema 查询回退 ≤0.01；100% 可追溯。

## 10. 可证伪判据（摘要）

| 观察到 | 承认 | 行动 |
|---|---|---|
| 人工相关性与 episode 标签大量不一致，换标签后模型显著改善 | 目标错了 | 停止用 episode AUC 当价值指标 |
| dense twin 正常、稀疏 twin 塌缩 | 稀疏优化问题 | 未来只可有界复盘 |
| 独立 session 扩大 2–4 倍后学习曲线持续上升 | P1 有数据不足成分 | 可重谈，但仍需下游 VOI 门槛 |
| 更大样本仍平坦且 CI 排除最小收益 | 表示路线不值得 | 长期冻结 |
| AUC/R@10 升但 ΔL 不升 | 代理与任务价值脱节 | 禁止用内在指标上线 |
| 即时消融 CI 上界 <3pp | 注入记忆总体价值不足 | 先修内容/接地/暴露，不做调度器 |
| need 模型不优于 task-type base rate | 未来需求不可预测 | 保留简单上下文规则 |
| 高 \|RPE\| 样本不含更有价值记忆 | RPE 无筛选价值 | 停止用 RPE 采样 |
| 观测 lift 在 paired ablation 中消失 | 选择偏差/任务难度混杂 | 回退现有策略 |
| schema 图时间外失效 / graph-only precision <0.80 | 图不可靠 | 关闭 graph-only 补全 |
| 账本覆盖率 <95% | 数据不支持因果归因 | 暂停估计，先修账本 |
| 第 90 天样本仍不足 | inconclusive，不是成功/失败 | 继续记录，不切换 |

## 11. 90 天计划

| 周期 | 交付 | go / no-go |
|---|---|---|
| W1 | 冻结 P1；预注册 estimand/主终点/3pp/切分/CI；P1 补 cluster CI；300 pair 标签审计方案 | 无法定义可验证任务损失 → 暂停学习，先补 verifier |
| W2 | 决策/候选/注入/结果账本 shadow；异步、fail-open、版本与 snapshot 可重放 | 覆盖率 ≥95%；边界 p95 无回退 |
| W3–4 | 冻结 v1 数据集：200 条人工查询、标签字典、UNKNOWN/censoring 报告；episode 标签有效性 | 标签不可稳定标注 → 停止基于该标签的训练 |
| W4–6 | 100 对即时 LOO ablation pilot；全局 effect/CI/方差/正式样本量 | 确认 / 扩样 / 排除三分支；pilot 不直接上线 |
| W5–7 | need base-rate/logistic shadow；goal 成功概率 + RPE 审计采样 shadow | ≥200 独立结果；Brier/PR-AUC 优于基础率 |
| W6–8 | 离线 schema 图 v1 + 来源报告 + 200 查询时间外评估 | 覆盖/ R@10 / precision / 来源门槛 |
| W8–11 | 独立正式 ablation（样本量由 pilot 方差定） | 点估计 ≥3pp 且 CI>0，成本不越非劣界 |
| W10–12 | need×gain 回放 shadow，再做“回放 vs 不回放” paired policy | 必须改善未来任务损失；不能拿 use gain 替代 replay gain |
| W12–13 | 确认结果：保留基线 / 继续收数 / 受控 canary | 无独立 paired 证据不改生产；边界检索不变 |

**90 天内不做**：训练 k-WTA/Hopfield/生成式皮层；扩 embedding；加手工 anchor；扫无目标阈值；
继续用 test 选模；LLM 自评当 gain；单 goal verdict 给单条记忆记功过；无配对确认就上线；改 raw T1；100ms 边界加 LLM/训练/图计算。

## 12. 最终判断

P1 后最危险的误读：
1. “表示学习已证明无用”——证据不足；
2. “只是数据少，再收点 turn 就该重试”——同样证据不足。

正确下一步：**先证明一条记忆进入上下文能不能减少任务损失，再决定是否值得改善它的表示、回放或图式。**
