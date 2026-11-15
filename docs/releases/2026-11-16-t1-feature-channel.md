# 2026-11-16 · T1 feature 检索通道

- **分支**：`feat/t1-sparse-first`（基于 Phase B `d493fd84`）
- **状态**：feature FTS + 三路 RRF + baseline 四通道完成；`t1.denseIndex` 待做
- **范围**：只改 memory；不引入 project/session 隔离

## 完成内容

1. `t1_feature_fts`（FTS5 trigram，派生/可重建）
   - 列：intent / action / target / error / decision / entities
   - `upsertTurnFeature` 同步 delete + insert；失败 fail-open
2. `GatewayDatabase.searchT1Features(query, topK)`
   - 查 feature FTS，按 `bm25` 排序
   - 返回 `T1LexicalHit`（`source: 'feature'`）
3. 三路 RRF
   - `fuseT1Hits(dense, lexical, k, feature = [])`
   - `T1Hit.sources` 增加 `'feature'`
   - feature-only hit 也能进入 fused
4. `createGatewayT1Search`
   - 同时查 FTS + feature + dense
   - 任一路失败 fail-open
5. Baseline 四通道
   - `evaluation/t1` 现在输出 fts / dense / feature / fused

## Baseline（fixtureVersion 1，合成 concept embedding）

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.70 | 0.70 | 1.00 |
| dense | 0.90 | 0.90 | 1.00 |
| feature | 0.70 | 0.70 | 1.00 |
| fused | 1.00 | 1.00 | 1.00 |

漏召：

- FTS：`q-parse-cn` / `q-coverage-cn` / `q-merge`
- dense：`q-code`（`ECONNRESET`）
- feature：`q-parse-cn` / `q-coverage-cn` / `q-merge`
- fused：无

结论：

- feature 是**结构化词面通道**：精确错误码/字段命中，但**不解决中文同义/paraphrase**
- dense 仍是 paraphrase 的唯一通道
- 三路 fused 覆盖三类 miss，默认保留

## 测试

新增 2 个测试：

- `gateway-db-t1-features.test.ts`：feature FTS 同步、intent/action/error/entities 检索、更新后旧词消失
- `t1-search.test.ts`：feature-only hit 进入 fused，`sources: ['feature']`

focused：`t1-search` + `gateway-db-t1-features` = 2 suites / 27 tests 全绿。
`tsc --noEmit -p tsconfig.json` rc=0。

## 已知限制

- feature FTS 是词面通道，中文 2 字查询会被 trigram 过滤。
- `t1.denseIndex` 配置尚未实现；dense 仍默认参与 fused。
- baseline 的 dense 是 synthetic concept embedding，不代表真实模型。
- `t1_feature_fts` 没有独立重建命令；后续可加 `rebuildT1FeatureFts()`。

## 下一步

1. `t1.denseIndex: on | off | shadow`
2. 真实本地 embedding 的小规模 baseline
3. reflection / reconsolidate 接 timeline
