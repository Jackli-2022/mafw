# 2026-11-16 · T1 sparse-first（Phase A：稀疏事件码）

- **分支**：`feat/t1-sparse-first`（基于 main `0065a111`）
- **状态**：Phase A 数据层 + T1 retrieval baseline 完成；Phase B（timeline / replay / T1 检索）待做
- **范围**：只改 memory；不引入 project/session 隔离，不改 runtime 契约

## 背景

T1 是未固化的 episode 证据，主表示应是 `raw + 稀疏事件码 + trace`；dense 只是可选派生索引。Phase A 先让每个 T1 turn 有一个确定性的稀疏事件码，供后续 timeline/replay 使用。

## 完成内容

1. `GatewayDatabase.t1_turn_features`
   - `trace_id` PK；`session_id` / `turn_seq` / intent / action / tool / target / result / error / decision / entities_json / outcome / confidence
   - `upsertTurnFeature` / `getTurnFeature`
   - `listSessionTurns`（active + archived，按 `turn_seq`）
   - `readTurnRows`（合并 `t1_observations` + `t1_archive`，按 replay 顺序）
   - `listTurnsMissingFeatures`（只返回有 raw row 且缺 feature 的 turn）
2. `gateway/src/recall/t1-features.ts`
   - `extractTurnFeature(turn, rows)`：确定性抽取 intent/action/tool/target/result/error/decision/entities
   - 不调 LLM；失败 fail-open；raw T1 不变
   - `backfillT1Features(deps, { limit })`：有界回填，一次最多 limit 条
3. `TurnPipeline`
   - 在 worker/archive 之前为每个 completed turn 写 feature
   - fake DB 兼容：方法不存在时跳过
4. 测试
   - `gateway/tests/unit/recall/t1-features.test.ts`（6）
   - `gateway/tests/unit/gateway-db-t1-features.test.ts`（8）
   - `gateway/tests/unit/turn-pipeline-features.test.ts`（1）
   - 共 **15 个新测试**；T1 相关 16 suites / 109 tests 全部通过

## 已知限制

- 回填函数已就绪，但还没有 CLI/HTTP 入口；生产回填待接。
- T1 检索的 feature channel 未接；dense 仍按现状使用（baseline 见下）。
- `should_encode` 尚未移除（Phase C 处理）。
- feature 抽取是确定性的，长/模糊 turn 可能需要后续 LLM 摘要补强。

## T1 retrieval baseline（Phase A）

`npm run eval:t1`：`evaluation/t1/`，10 queries / 6 turns，合成 concept embedding（离线、确定性、只验证管线，不代表真实模型质量）。

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.70 | 0.70 | 1.00 |
| dense | 0.90 | 0.90 | 1.00 |
| fused | 1.00 | 1.00 | 1.00 |

- FTS 漏中文同义查询（`解析失败` / `覆盖率` / `合并`）
- dense 漏精确错误码（`ECONNRESET`）
- fused 全中

结论：T1 应保留 lexical + dense 双通道，fused 作为默认；这也为后续 `t1.denseIndex` 决策提供基线。

## 下一步

Phase B：
- `readSessionTimeline` + `buildReplayBlock`
- T1 检索加 feature channel
- `t1.denseIndex: on | off | shadow`
