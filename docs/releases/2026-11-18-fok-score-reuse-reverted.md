# 2026-11-18 · FOK 原始评分复用实验（已回滚）

- **实验提交**：`8b3b7c5df`（`perf(memory): reuse raw BM25 scores`）
- **回滚提交**：`9a8c85f80`（`Revert "perf(memory): reuse raw BM25 scores"`）
- **当前结论**：不保留 16-query raw-score LRU；生产继续使用 `f17ac92f3` 的 postings-only 实现。
- **当前运行**：gateway v5.1.0，pid `47816`，health `ok`。

## 实验内容

实验在 `bm25RawScored` 增加 16-query LRU，缓存与 entries 物理下标对齐的 `Float64Array` 原始分数，意图消除 `computeRecallFokZone` 对同一 query 的重复评分。未改 FOK 阈值、召回参数或结果排序。

## 正确性与测试

- 新增 9 个复用测试，实验文件共 **15 tests**。
- 覆盖 query/topK、add/remove/in-place 失效、重复 id、调用方修改结果、FOK zone parity。
- Review **APPROVE**，未发现可达正确性缺陷。
- 在 `f17ac92f3 + 实验 patch` 的隔离环境中：
  - **1040 suites / 8312 tests**
  - **8310 passed，2 skipped，0 failed**
- 冻结 40 query 的 top-3 id、顺序、分数与 FOK zone 均保持一致。

这些证明实验“语义正确”，不证明它在当前真实负载中“值得保留”。

## 线上结果与归因

所有运行均保持：AUTO hit 60%、agreement 86.7%、false injection 20%（同一组 id）、stale 0。

| 运行 | AUTO p50 / p95 / max |
|---|---|
| Postings 基线（06:04Z） | 134 / 230 / 324ms |
| FOK reuse 冷启动 | 204 / 277 / 428ms |
| FOK reuse warm 1 | 166 / 237 / 365ms |
| FOK reuse warm 2 | 164 / 228 / 366ms |
| 回滚后首轮 | 166 / 231 / 343ms |
| 回滚后第二轮 | 183 / 359 / 506ms |

最初看似“复用版比基线慢”，但回滚后也没有恢复 134ms，且后续波动更大。因此：

- 不能把 134→164ms 的差异单纯归因于 raw-score cache。
- 同样不能证明复用版在真实 40-query 分布上有稳定净收益。
- 实现者隔离长 prompt A/B 中 FOK pass 从约 43ms 降至 15ms，但当前线上负载受进程启动、sidecar、后台任务和 query 形状影响，无法稳定复现总收益。

## 决策

保留回滚，不再次反复切换：

1. 实验增加约 2MB 常驻 raw-score 缓存及第二套失效不变量，但没有可复现的线上净收益。
2. 已验证的 postings 单层优化更简单，且此前已证明质量不变和显著收益。
3. 若未来重试，应先做带 query-shape 分层的同进程 A/B，并避免为不会再次出现的 expansion 子查询分配 raw arrays；不能直接恢复本次 16-query LRU。

回滚后 `bm25-postings.test.ts` 恢复为原先的 **6 tests，6/6 passed**。此前 postings-only 的干净全量仍为 **1040 suites / 8303 tests，8301 passed，2 skipped**。
