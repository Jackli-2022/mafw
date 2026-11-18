# 2026-11-18 · Live Recall 词级支持否决

- **分支**：`main`（未 push）
- **代码提交**：`7cee3e885`（`fix(recall): reject unsupported live recall pools`）
- **Gateway**：v5.1.0；部署后 pid `43760`，health `ok`
- **前序**：`docs/releases/2026-11-18-auto-recall-exact-evidence.md`、`docs/releases/2026-11-18-bm25-postings-latency.md`

## 问题

40 条 personal-recall 中有 2 条真正的无答案查询仍自动注入：

- `negative-canberra-rainfall`：`堪培拉十二月平均降雨量`
- `negative-jeans-waist`：`缝纫机改牛仔裤腰围怎么走线`

各注入 3 个 anchor + 4 个 `↳` 邻居，共 7 条 pointer，false injection 为 20%。

根因不是候选“看起来太像”，而是两个确定性缺陷叠加：

1. `tokenizeBM25` 把 CJK 切成 **单字 unigram**，因此 `月/平/降/怎` 这类散落字符都能贡献 BM25。
2. 边界 FOK 只看 `top1/mean` 比值；两者分别达到 1.458 / 1.464，越过 `high=1.35` 后直接进入 `inject`。精确准入此前只在非 inject 时运行，无法否决已 inject 的语义无关候选池。

候选审计：
- canberra 池与 query 共享 **0 个 CJK bigram、0 个 ASCII 词**；
- jeans 池唯一共享 bigram 是问句框架 `怎么`；
- 18 条正向 AUTO 命中都至少有 ASCII 词、identifier 或 topical CJK bigram 支持。

单纯调 FOK 比值不可行：`current-mcp-transport` 在 ratio 2.403 仍是 miss，而 `exact-t1-semantic-encoder` 在 1.353 是 hit。

## 修复

新增 `gateway/src/recall/lexical-support.ts`：

- 只读取候选 `primary_abstraction + cue_anchors`，不读正文。
- 支持单位：
  - ASCII 完整词（与检索同源 identifier 拆分，排除英文功能词）；
  - 非问句框架的 CJK bigram，按字段、按连续 CJK run 生成。
- 有支持：逐 pointer 过滤，`↳` 邻居只挂在保留的 anchor 上。
- 无支持：`inject → no-memory`，随后仍可被确定性精确证据救回。
- 只在 FOK **真正评估过**时生效：`evaluateRecallFokZone` 返回 `{zone, evaluated}`；FOK 关闭、缺 scorer 或抛错仍保持旧 fail-open，不新增否决或扫描。
- ACT-R 曝光只记录最终真正渲染的 anchor；被否决的无关候选不再获得检索奖励。
- 不改 FOK 阈值、topK、recency、note-board、snapshot 或记忆写入。

## 独立 review

首轮 review **REQUEST CHANGES**，指出：

- 默认 FOK 关闭时不能把 fail-open inject 当作证据；
- 问句框架黑名单太窄；
- 英文停用词会误当支持；
- pool-level OR 会连带注入不支持的尾部；
- 测试只覆盖两个调参样本；
- snapshot 残留与 exact-rescue 尾部未披露。

以上均已修复并 scoped re-review 为 **APPROVE**：

- FOK `evaluated` 标记与 fail-open 路由测试；
- 扩展有界问句框架、英文停用词、acronym/snake 拆分；
- per-pointer filtering + 邻居一致性；
- third-topic、English、FOK-disabled、note-board、exact decoy、ACT-R exposure 测试；
- snapshot/exact-tail/partial-support 残余写入架构文档。

## 测试

新增 **46 个测试**：

- `lexical-support.test.ts`：40
- `recall-fok-zone.test.ts`：新增 6
- exact-evidence：保留原 17，更新 1 个 contract 断言

验证：

- 复审复跑 `tests/unit/recall`：**531 passed**
- 干净基线（`f17ac92f3` + 本质量 patch）完整 build 与全量：
  - **1041 suites / 8349 tests**
  - **8347 passed，2 skipped，0 failed**
- 相对 postings 基线 8303 tests，正好新增 46。
- `tsc` 在干净基线通过；主 checkout 当时另有 `transport.ts` 未完成改动，未计入本切片。

## 线上真实复测

部署文件：`dist/recall/lexical-support.js`、`dist/recall/recall-context.js`、`dist/routes/recall.js`。重启 `pid 47816 → 43760`，health `ok`。

| 指标 | BEFORE | AFTER live 1 | AFTER live 2 |
|---|---:|---:|---:|
| AUTO hit | 18/30（60.0%） | **18/30（60.0%）** | **18/30（60.0%）** |
| exact AUTO | 10/10 | **10/10** | **10/10** |
| current-state AUTO | 6/10 | 6/10 | 6/10 |
| implicit AUTO | 2/10 | 2/10 | 2/10 |
| false injection | 2/10（20%） | **0/10（0%）** | **0/10（0%）** |
| stale injection | 0 | **0** | **0** |
| entrypoint agreement | 26/30（86.7%） | **26/30** | **26/30** |
| REST p50 / p95 | — | 42 / 87ms | 41 / 72ms |
| AUTO p50 / p95 | 166–183 / 231–359ms | 165 / 339ms | 174 / 277ms |

结论：**两条无答案误注入消除，所有正向命中与 agreement 保持不变。**本切片没有改善 12 条既有 miss，也没有声称延迟达标。

## 残留边界

- Snapshot served 池不经过这个即时否决，仍由 cross-encoder 概率门负责。
- 精确证据救回的 topK 尾部可能包含未逐 pointer 过滤的 BM25 补位候选。
- FOK 关闭/失效时的 fail-open inject 仍是历史行为。
- 正确的相关 pointer 若没有任何词级支持、而同池另一个候选有支持，该 pointer 会被过滤，且 turn 仍为 inject，exact rescue 不会触发；40 条中未发生，但这是规则的结构性 false-negative 边界。
- 全 CJK 纯同义改写若没有共享 2 字序列，可能被误否决；同一 bigram 不同义仍可能误准入。
- 剩余 12 条 AUTO miss（含 8 条 implicit）、尾部弱相关、FOK 观测混合和 100ms 契约仍未解决。
