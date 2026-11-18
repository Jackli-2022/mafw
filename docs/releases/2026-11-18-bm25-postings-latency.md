# 2026-11-18 · Snapshot 复核与 BM25 Postings 延迟修复

- **分支**：`main`（未 push）
- **代码提交**：`f17ac92f3`（`perf(memory): cache BM25 postings`）
- **Gateway**：v5.1.0；部署后 pid `13752`，health `ok`
- **前序**：`docs/releases/2026-11-18-auto-recall-exact-evidence.md`

## Snapshot 复核：不是调度缺陷

此前“重启后没有 snapshot build”的判断是观察窗口误判，不是产品 bug。

只读账本证明：重启后 13 个 user turn 全部在 2.8–6.0 秒内生成 snapshot 日志与 `kv_store` 行（13/13）。`gateway/src/routes/obs.ts` 只在 `source='user_input'` 时调度；此前观察窗口只有 tool_result，没有新的 user turn，因此没有构建是预期行为。

生产快照还验证了上一片的 active+archive 修复：多个会话在大部分 turn 已归档时仍能构造 599 字符滚动查询，不再只读热表短指令。另有 6 次真实 `snapshot served`。

排查注意事项：

- 快照表名是 `kv_store`；`updated_at` 是 epoch **秒**，不能用 `Date.now()` 毫秒直接比较。
- 无 `sessionID`、内部会话递归守卫、空窗口等路径本来就不生成/采用 snapshot，不能与调度失败混淆。

本次没有为 snapshot 修改生产代码。

## 真正的 P0：重复全库 BM25 扫描

边界一次 recall 会执行多次 BM25：

- 初次 `searchScored`
- query expansion / multi-hop 子查询
- `computeRecallFokZone` 对同 query 再计算一次

实测每次边界召回 p50 约 5 次、最多 10 次全库扫描。每个 query 因 CJK unigram 和 camel/snake 拆分可包含数十到数百个 token，旧实现对每个 token 遍历全部文档。

最近生产日志中的 live-fallback search 一度达到 p50≈712ms、p95≈940ms；noteBoard/goal/neighbours 只占约 15ms。

## 修复：版本化倒排 postings

`gateway/src/core/memory/harmonic-index.ts` 新增缓存的 `term → physical document index` postings：

- 每个 query term 只访问包含该 term 的文档，不再全库逐 token 扫描。
- 使用**物理文档下标**而不是 id 累加，重复 id 的旧索引文件也保持每个物理文档独立 df/N 和评分语义。
- `searchVersion`、`entries` 引用和文档文本检查共同处理 addEntry、removeEntry、in-place cue/title 变化。
- 保持 tokenize、重复 query token、CJK/camel/snake、entries 顺序和浮点累加顺序不变。
- `df≤N` 与缺失 doc 仅是 stale-state 防御，不改变正常状态评分。
- 首次构建实测约 34ms；19,116 terms / 572,581 postings。原始 posting 约 4.4MB，另有 Map/数组开销；不将 4.4MB 当作完整堆预算。

未改 FOK 阈值、topK、recency、graph 权重、note-board、exact admission 或 snapshot 策略。

## 测试与独立 review

新增 `gateway/tests/unit/core/memory/bm25-postings.test.ts`，**6 个测试**：

1. 稀有 term 只检查命中文档（结构性 oracle，非墙钟阈值）。
2. 与 naive BM25 的分数/id 顺序一致，覆盖重复 token、CJK、camelCase、snake_case、缺失 term。
3. upsert/remove 后缓存失效，幸存者分数按新 df/N 计算。
4. postings 跨 query 复用。
5. 重复 id 的物理文档独立评分，不累加翻倍。
6. 同 entries array/object 的 in-place `cue_anchors` 替换使新 term 可检索、旧 term 消失。

实现者与 reviewer 均看到 RED→GREEN；review 对 duplicate-id、in-place invalidation、removal df 和 tokenizer oracle 的 4 项 Important 均在交付前修复，最终 **APPROVE**。

验证：

- 父会话相关定向：**43/43 passed**。
- 实现者核心/召回定向：**79 suites / 529 tests**；另一组 **57 suites / 346 tests**，全部通过。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- 在提交 `f17ac92f3` 的干净临时归档（无其他会话未提交文件）中执行完整 monorepo build 和最终全量：
  - **1040 suites / 8303 tests**
  - **8301 passed，2 skipped，0 failed**
- 主 checkout 曾出现其他会话 `mobile.remoteAccess` 契约计数失败；没有替其修复或回滚。干净提交验收与这些未完成改动无关。

## 冻结语料 A/B（实现者）

40 个真实慢查询、同一进程交错 A/B：

- **40/40 top-3 id、顺序、分数完全一致**。
- HEAD p50≈382ms → postings p50≈216ms。
- Route-equivalent 分解：总 p50 约 516ms → **287ms**，p95 约 797ms → **427ms**。
- 短 prompt（<120 chars）p50 约 142ms → **71ms**；长 subagent prompt 仍约 300–450ms。

## 上线与真实 40 条复测

部署采用干净归档构建产物，仅替换编译后的 `gateway/dist/core/memory/harmonic-index.js`，未覆盖其他会话的源码或 dist 文件。重启令牌记录 `f17ac92f3`；gateway `pid 57860 → 13752`，health `ok`。

运行：`node evaluation/personal-recall/run.js --out .../personal-recall-after-postings.json`。

| 指标 | 精确准入后（03:59Z） | Postings 上线后（06:04Z） |
|---|---:|---:|
| REST hit@1 / hit@3 | 60.0% / 73.3% | **60.0% / 73.3%** |
| AUTO hit | 60.0% | **60.0%** |
| Entrypoint agreement | 86.7% | **86.7%** |
| False injection | 20% | **20%（14 个误注入 id 完全一致）** |
| Stale injection | 0 | **0** |
| REST p50 / p95 / max | 103 / 127 / 523ms | **29 / 38 / 43ms** |
| AUTO p50 / p95 / max | 307 / 436 / 604ms | **134 / 230 / 324ms** |

AUTO p50 下降约 **56%**，p95 下降约 **47%**。召回质量指标没有退化；不把 rank1 的轻微变化单独归因于 postings，因为语料、快照和负载会变化。

## 尚未解决

- AUTO p50/p95 仍高于客户端 100ms abort，尤其长 prompt。
- Graph expansion 仍有约 77ms 的 per-seed SQL/N+1 成本。
- FOK 对同 query 仍有约 43ms 的重复评分 pass。
- 多次 query expansion 是剩余主要成本；减少 pass 涉及召回质量，必须另做 A/B，不能当纯性能修复。
- 负面误注入仍为 20%，implicit 仍有 4 条 miss，尾部弱相关与 FOK 观测混合仍未解决。
- postings 依赖“entries 不得原地重排/收缩”的现有写入约定；未来 splice/sort/reverse 必须同步失效缓存。
