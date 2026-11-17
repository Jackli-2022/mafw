# 2026-11-19 · Engram P1（learned k-WTA）结果：未通过，停止复杂化

- **分支**：`main`
- **脚本**：`gateway/scripts/export-engram-dataset.ts`、`eval-engram-baseline.py`、`train-t1-engram.py`
- **计划**：`docs/superpowers/plans/2026-11-19-engram-p1.md`
- **设计**：`docs/research/2026-11-19-hippocampus-cortex-design-kimi.md`

## 数据集

- 133 个 ≥4 turn 的 session，全部 turn：**2,595** 条；
- 按 session 切分：train 2,263 / val 168 / test 164；
- 与 episode 成员表对齐；模型 `llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf@1024`；
- 冻结 hash：`f4d903008fc8ae3fac7c82b0329ad9ade79d856988cb1480b149cf3e5606eaab`。

## 基线（test）

| 码 | matched AUC（同 episode vs 不同，按 dense 相似度分桶） | top-1 同 episode | R@10 | 最大位占比 |
|---|---:|---:|---:|---:|
| dense cosine | — | 0.305 | **0.622** | — |
| 直接 k-WTA（1024→16） | 0.549 | 0.171 | 0.463 | **0.664** |

直接 k-WTA 已经出现严重 hub（一个维度覆盖 66% 的 turn），所以它不是强基线，但仍是必须超过的下限。

## learned k-WTA（低秩 tied autoencoder）

配置：`M=4096, r=64, k=16`，损失 `rec + NCE + 0.5·KD + λ_hub·hub`，30 epochs，batch 128。

两次运行：

| 运行 | val matched AUC | test matched AUC | test R@10 | 有效位 | 最大位占比 |
|---|---:|---:|---:|---:|---:|
| λ_hub=1 | 0.462 | 0.546 | 0.293 | 36 | 0.969 |
| λ_hub=5 | 0.475 | 0.569 | 0.323 | 40 | 0.999 |

对照：直接 k-WTA val 0.490 / test 0.549；dense R@10 0.622。

## 判定：P1 不通过

按设计门槛（分离 AUC 相对直接 k-WTA ≥ +0.03 且 CI>0、R@10 非劣 -0.01、`df_max ≤ min(0.05, 10k/M)`）：

1. **分离**：最好 test +0.020（0.569 vs 0.549），未到 +0.03；val 反而低于直接 k-WTA。
2. **检索**：R@10 从 0.463 掉到 0.323（-30%），远低于非劣界。
3. **hub**：有效位只有 36–40 / 4096，最大位占比 0.97–0.999；`df_max` 门槛是 0.039，严重超标。
4. **过拟合**：train matched AUC 0.82，val 0.475，test 0.569——没有稳定泛化。

结论：**learned k-WTA 在当前数据与实现下失败；不进入 shadow 存储，不接检索，停止继续加复杂机制。**
这符合设计里的预先约定：如果不能稳定击败直接 k-WTA，就停止，而不是继续调。

## 为什么失败（诊断）

- 2,263 条训练 turn 对 4096 维码太小；模型把码塌缩到约 40 个活跃位，重建损失仍能下降。
- hub 惩罚只压频率，不改变 top-k 选择；一个位被所有样本选中时，梯度不足以把它拉下来。
- NCE 在 in-batch 上正例很少（episode 平均 1–2 轮），KD 又拉向 dense 排序，两者与重建目标冲突。
- 评测标签（episode）本身粒度粗；test/val 只有 164/168 条，AUC 的波动很大。

## 下一步（不再做表示层）

- **停止**：learned k-WTA、随机扩张、Modern Hopfield、分布式皮层。
- **转向**：结果标签与 VOI（goal verdict、paired ablation、未来有效使用），
  用 `docs/research/2026-11-19-how-to-compute-memory-value.md` 的协议；
  在没有 ≥200 个独立结果决策 / ≥100 个 ablation 前，不再训练新的记忆表示。
- 保留：dense + BM25 + concept tags + RRF；把 `sem:` 命名为 concept tags，不叫 DG。

## 复现

```bash
cd gateway
npx ts-node --transpile-only --project tsconfig.json scripts/export-engram-dataset.ts
python scripts/eval-engram-baseline.py
python scripts/train-t1-engram.py --epochs 30 --hub-weight 5
```

数据集与权重在 `gateway/scripts/fixtures/engram-p1/`（未提交，见 `.gitignore`）。
