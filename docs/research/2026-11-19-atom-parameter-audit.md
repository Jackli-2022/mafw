# T1 稀疏原子参数溯源审计

> 2026-11-19。问题：`top2 / minScore 0.02 / minTop1 0.05 / 查询 0.08 / baseline 24 条参考文本`
> 这些数字从哪里来？数据怎么支撑？有没有公式？审计脚本：`gateway/scripts/audit-atom-params.ts`。

## 1. 参数出身表

| 参数 | 当前值 | 出处 | 数据依据 | 公式 | 结论 |
|---|---|---|---|---|---|
| 双校正公式 | `(cos − baseline) − mean(cos − baseline)` | 设计文档 | 12 anchor、真实 Qwen3 底噪 0.34–0.38 | ✅ 有（去各向异性 + hub） | **公式成立** |
| baseline 参考集 | 最多 24 条 T1 文本 | `sampleTurnTexts(24)` | **按 trace_id 排序的前 24 条**，不是随机抽样 | 样本均值（无 SE/CI） | **样本太小且非随机** |
| `topK` | 2 | 代码默认 | 398 turns 密度扫描（平均 1.21 atoms/turn） | ❌ 无 | 经验操作点 |
| `minScore` | 0.02 | 代码默认 | 同上 | ❌ 无 | 经验操作点 |
| `minTop1` | 0.05 | 代码默认 | 同上；16 条 fixture 查询 eval | ❌ 无 | 与 eval 同源，非独立验证 |
| 查询原子下限 | 0.08 | 检索接线 | 让 `明天天气` 弃权、`解码失败` 命中 | ❌ 无 | 单例驱动 |
| `intent_shift` Jaccard | 0.2 | 设计 | 无扫描 | ❌ 无 | 未验证 |
| `MAX_TEXT` / `BATCH` | 2000 / 16 | 工程 | — | — | 与精度无关 |

## 2. 复测：baseline 样本稳定性

用同一模型、200 个真实 turn、12 个 anchor，比较不同参考样本得到的 baseline 与原子集合：

| baseline 参考集 | atoms/turn | 弃权率 | 与 first-24 的原子 Jaccard |
|---|---:|---:|---:|
| first-24（当前线上） | 1.44 | 27% | 1.000 |
| next-24 | 1.32 | 33% | 0.731 |
| third-24 | 1.29 | 34% | **0.551** |
| all-240 | 1.29 | 35% | 0.673 |

- 只换一组 24 条参考文本，**约 27–45% 的原子选择会变**（Jaccard 0.55–0.73）。
- 12 个 anchor 的 baseline 在三个 24 样本间的标准差是 **0.006–0.017**，而 `minScore` 只有 **0.02**——
  baseline 的抽样噪声和判定阈值同量级。

结论：`baseline` 不是“参数”，是**估计量**；当前估计量的方差没有被报告，也没有被控制。

## 3. 复测：阈值敏感性

固定 all-240 baseline，扫 `topK × minScore × minTop1`：

- atoms/turn 从 **0.54 到 2.81**；
- 弃权率从 **5% 到 71%**；
- 与当前配置的 Jaccard 只有 **0.45–0.61**。

也就是说，当前 0.02/0.05 不是一个“数据选出来的最优点”，而是这个宽区间里的一个点；
换相邻阈值，一半左右的原子集合会变。没有目标函数（recall@k、预算、下游任务）时，无法说哪个更好。

## 4. 有没有公式背书

- **双校正**有：`score = (cos − anchorBaseline) − mean_j(cos_j − baseline_j)` 是“去掉各向异性底噪 + 去掉文本整体亲和度”，
  与 embedding 空间各向异性、hubness 的常见处理一致。
- **阈值没有**：0.02/0.05/0.08 都是操作点，不是公式的解。它们应该由**校准集上的目标函数**决定，
  例如“固定 atoms/turn 预算，最大化 held-out recall@3”，或“取 centered score 的 p97 分位”。
- **baseline 样本量没有**：24 条是工程便利，不是统计结论。样本均值标准误 `σ/√n`；σ≈0.01、n=24 → SE≈0.002，
  看似小，但相对 minScore 0.02 已是 10%，且样本非随机，偏差可能更大。

## 5. 应该怎么改（不改行为，先建校准协议）

1. **参考集**：随机/分层抽样（按 session、来源），n ≥ 240；冻结并记录样本 hash；报告每 anchor 的 mean ± SE。
   或者更稳：在**历史全量**上算 baseline，离线固化，随模型版本重算。
2. **阈值**：在 held-out 查询集上定义目标（recall@3 + atoms/turn 预算），网格搜索 + 95% CI；
   或直接用 centered score 的分位数（p95/p97）定义，避免拍数字。
3. **查询下限 0.08**：用查询侧原子分数分布定（如 p90），并在 ≥50 条查询上验证弃权/命中。
4. **版本化**：参数集与 embedding model tag、参考样本 hash 绑定；换模型必须重算 baseline 与阈值。
5. **报告**：每次调参输出“参数 + 样本量 + 目标函数 + 灵敏度带”，否则视为未验证。

## 6. 结论

- 你的质疑成立：**公式有背书，参数没有**。
- 24 条参考文本是“前 24 条”，不是随机样本；baseline 的抽样噪声与阈值同量级，换样本会改动 27–45% 的原子。
- 0.02/0.05/0.08 是经验操作点，来自一次密度扫描 + 16 条查询的 in-sample eval，没有 held-out 与 CI。
- 正确做法不是再挑一组数，而是：**固定随机参考集 + 用 held-out 目标函数选阈值 + 报告灵敏度**。

## 复现

```bash
cd gateway
npx ts-node --transpile-only --project tsconfig.json scripts/audit-atom-params.ts
```

脚本只读：采样文本、embedding、计算 baseline 与阈值网格，不写 atoms/config。
