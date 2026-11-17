# 海马体 + 皮层：可落地的机制升级设计（Kimi K3.1 Pro 子代理报告）

> 2026-11-19。由子代理 `kimi-code-plan-cn/k3.1-pro` 只读调研产出，父会话整理。
> 依据：`2026-11-19-hippocampus-cortex-vs-mafw.md`、`2026-11-19-atom-parameter-audit.md`、
> `2026-11-19-industry-calibration-practice.md`、`2026-11-19-memory-selection-need-gain.md`、
> `2026-11-19-how-to-compute-memory-value.md` 与现有代码。

## 0. 结论

- 当前 `sem:` 是 **12 维概念打标器**，不是 DG 稀疏码；实测相邻/同 episode AUC 0.532/0.542。
- 直接 k-WTA（1024→top16）AUC 0.692，随机扩张 0.656，dense 0.794——稀疏码只能做**辅助通道**。
- 当前邻居补位/RRF 不是 CA3 补全；`mismatch` 不是 CA1 比较器；Harmonic 是文本知识库，不是慢学习皮层。
- **只值得先做一件事**：把 DG 表征升级为可训练、可回滚、可测量的稀疏码实验，
  以「直接 k-WTA + dense」为双基线；其余机制（CA3/CA1/gain/皮层）按门槛分阶段。

## 1. 机制映射（差距）

| 生物 | 计算问题 | 现状 | 差距 |
|---|---|---|---|
| DG 扩张/稀疏/去相关 | 相似经历→可区分码 | 12 anchor top2，17% 密度 | 维度低、固定 topK、无学习、hub |
| Engram 分配 | 哪些槽位承载经历 | trace_id 身份 + distinct_from | 没有竞争性分配/稳态 |
| CA3 补全 | 部分 cue 恢复同经历成员 | concept/actor/±2 邻居；RRF | 无递归、无补全置信度、无 masked-cue 验收 |
| CA1 比较器 | 熟悉/更新/新建 | novelty/mismatch 分数 | 没有「输入 vs 重构」残差；无三路路由 |
| 皮层慢学习 | 跨样本统计规律 | LLM 一次写入 + 文本合并 | 无分布式权重；文本合并≠慢学习 |
| 图式 | 一致加速、不一致保留 | schemaClusters 注入 prompt | 未参与巩固调度 |
| 回放选择 | 未来有用 × 能改善行为 | need×salience/energy | need 向后看；无 gain；RPE 未接 |

## 2. 三个方案

### A. 便宜档：直接 k-WTA + 有界图补全（对照组）

- 冻结 embedding，`z = TopK(x, 16)`；稳态偏置 `b_j += η(16/1024 − p_j)`（只在训练段估计、冻结、版本化）。
- CA3：item 图（同 episode、同 session 时间邻接、coactivation PMI），`a ← (1−α)s + αPᵀa`，≤3 次，只填空槽。
- CA1：记录 `m = 1 − cos(x_q, r)`、支持度、熵；**不路由**。
- 成本：0 训练；16×uint16≈32B/turn；查询 64×16×3 边操作。
- 价值：强基线与观测数据，不预期提升召回。

### B. 中等档（推荐目标）：低秩 learned k-WTA + 稀疏联想 + CA1 shadow

**DG**

```
a = U V x + b,  W = U V,  z = TopK(a, k) with softplus
x̂ = normalize(Wᵀ z)
```

- 主配置 `M=4096, r=64, k=16`（0.39%）；challenger `8192/64/16`（0.195%）。
- 损失：`L = L_rec + λ_c L_NCE + λ_d L_KD + λ_h L_hub`
  - NCE 正例 = 同 episode 不同 turn；负例 = 不同 episode（含 dense 高相似 hard negative）。
  - KD = 对候选集蒸馏 dense cosine 排序，避免稀疏码丢检索分辨率。
  - hub：`p_j = 频率`，`L_hub = Σ ReLU(p_j − 3k/M)²`。
- 训练：batch 64，AdamW 1e-3，≤30 epochs，early stop；离线训练、导出 ONNX，不在 gateway 内训练。
- 成本：4096/64 约 1.3MB fp32；8192/64 约 2.4MB；查询 p95 ≤5ms。

**CA3**

```
C_ab = PMI₊(a,b) / sqrt(n_a n_b)
h ← (1−α)z_q + α C h,  ≤2 次
```

- 每细胞 ≤32 非零边；关联需跨 ≥2 个训练 episode；输出只回真实 trace 指针。

**CA1（先 shadow）**

- `m = 1 − cos(x_q, r)` + 支持度 + 熵 + top1/top2 margin。
- 低 mismatch/支持足 → 不加工；中 mismatch → 进 consolidation judge 候选；
  高 mismatch 或低支持 → 新建/separate，不自动合并。
- `τlow/τhigh` 必须从人工 CREATE/UPDATE/SEPARATE pair 标定；没有标签不拍阈值。

**皮层**

- 只做 schema 图 + 跨 episode centroid + 稀疏关联；unit 仍是事实权威。
- centroid 更新条件：≥3 独立 episode、跨 ≥2 天、无未解决矛盾、保留全部 source_trace_ids。
- 不训练生成式皮层。

**need×gain**

```
G(m) = E[L_without m − L_with m]
P(m,g) = (ε_n + N̂)(ε_g + Ĝ₊) × salience / max(0.2, energy)
```

- `N̂`：未来 7 天被有效使用的校准概率；`Ĝ₊`：非负预期损失下降；单调模型。
- goal RPE `δ = y − p̂_success`；`|δ|` 只能当特征，不能当 gain。

### C. 激进档（暂不做）：Modern Hopfield + 分布式皮层适配器 + VOI 世界模型

- Hopfield 补全 `p = softmax(βKq)`，`r = Σ pV`；候选 ≤256，≤2 次，熵/支持 abstain。
- 皮层 residual adapter `c = normalize(x + f_θ([x;goal;schema]))`，用 paired ablation 正例训练。
- 不做的原因不是算力，而是**标签与可识别性不足**：4.5k turns、goal verdict 无法归因到单条记忆、
  缺 paired ablation、生成式重构会引入错误混合与审计成本。

## 3. 推荐路线与门槛

| 阶段 | 内容 | 进入条件 |
|---|---|---|
| P1 | learned k-WTA **shadow** | 本报告评估协议 |
| P2 | 稀疏 CA3 补全 | P1 击败直接 k-WTA 且检索不回退 |
| P3 | CA1 调度 + need×gain | 足够人工 pair + 结果/消融标签 |
| P4 | schema 慢统计增强 | P2/P3 有任务级证据 |
| P5 | 分布式皮层/Hopfield | 默认不做 |

**P1 只做**：冻结评估集/hard negatives/manifest；shadow 三路（现 anchor、直接 k-WTA、learned k-WTA）；
训练段估计并冻结稳态偏置；新码独立派生表；比较分离、KD 保持率、检索召回。

**P1 不做**：加手工 anchor、随机扩张、替换 `sem:`、替代 dense、接 CA3/CA1 生产、上线 gain、改 Harmonic、
在 100ms 边界加模型。

### P1 go/no-go

1. hard-negative 分离 AUC 相对直接 k-WTA **≥ +0.03**，paired 95% CI 下界 >0；
2. T1 fused R@10 非劣 -0.01、R@1 非劣 -0.02，CI 不越界；
3. `df_max ≤ min(0.05, 10k/M)`（先注册，不能看完 test 再改）；
4. 查询投影 p95 ≤5ms；boundary 无新增工作；
5. 若分离提升但 R@10 没有 ≥+0.02 独立提升 → **不开生产**，只留 shadow。

### P2 / P3 门槛

- CA3：masked-member R@10 至少 +0.05、CI>0；completion-only precision ≥0.80；整体 R@10 非劣 -0.01。
- CA1：UPDATE recall ≥0.95；judge 调用减少 ≥30%；SEPARATE 不被自动合并；macro-F1 +0.05。
- gain：任务成功率绝对提升 ≥3pp 且 CI>0；retry/成本不恶化；功效不足 → inconclusive，不上线。

## 4. 评估协议（关键）

- 切分：按时间 60/20/20，完整 session 不跨 split；episode 内 pair 同分区；test 只跑一次。
- 禁止：test 估 baseline/阈值、未来 memory 判断过去 novelty、LLM 自评当金标签、test 上调参。
- DG 指标：hard-negative 匹配的 same/different AUC、dense 分桶 overlap、`df_max`、有效细胞率、R@1/5/10、nDCG。
- CA3：masked-member R@k、false completion rate、直接命中保持率、abstain 率。
- CA1：CREATE/UPDATE/SEPARATE macro-F1、PR-AUC、混淆率、judge 节省率、ECE/Brier。
- 样本量：≥200 独立 episode / 100 sessions / 200 queries；CA1 ≥300 pairs（每类 ≥75）；
  gain 100 pilot / 200 正式；paired bootstrap 2000 次，按 session cluster。
- 300 vs 593/组：10pp 提升、α=0.05、power=0.8 约需 593/组；5pp 约 2443/组。

## 5. 反模式

1. 继续加手工 anchor 并叫 DG；
2. 随机扩张/hash 桶当 engram（0.656 < 直接 k-WTA 0.692）；
3. k-WTA 替代 dense（0.69 vs 0.79）；
4. 把 RRF 叫联想补全；
5. 把 1-hop/PPR 叫 CA3；
6. LLM 自评 importance 当 gain/VOI；
7. reward/novelty/|RPE| 当 gain；
8. 只用相邻/随机 AUC 证明分离（必须 hard-negative 匹配）；
9. 文本合并叫皮层慢学习；
10. 生成无精确来源的“重构记忆”；
11. 在线无版本更新稳态偏置/关联矩阵；
12. 把新计算塞进 100ms 边界。

## 6. 最终建议

**现在只做 P1：learned k-WTA shadow，双基线（直接 k-WTA + dense）。**
如果它不能在独立测试集稳定击败直接 k-WTA，正确结论是**停止复杂化**，
把精力转向结果标签与反事实价值测量，而不是继续堆“更像大脑”的部件。

## 7. P1 实测结果（2026-11-19）

P1 已执行：learned k-WTA（M=4096, r=64, k=16）在 2,595 turns / 133 sessions 上训练失败——
val matched AUC 0.475 < 直接 k-WTA 0.490，test R@10 0.323 vs 0.463，码塌缩到 36–40 个有效位。
按预先约定 **停止复杂化**，不进入 shadow 存储。详见 `docs/releases/2026-11-19-engram-p1-result.md`。
