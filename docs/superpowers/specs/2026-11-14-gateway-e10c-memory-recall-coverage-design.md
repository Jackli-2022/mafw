# Gateway E10c 契约覆盖（第三批：memory / recall / lead）：设计（2026-11-14）

> 承接 E10（29/317）与 E10b（44/317 → 45/318）。本批覆盖 **8 个读接口**，并把 `memory.search` 从 override 转为 code-first。
> 规则沿用 `2026-11-13-gateway-e10-contract-coverage-design.md` §2；本文件只记录增量。

## 0. 基线（实测）

- catalog：318 ops，45 个带 `response`（E11 的 `humanToken.rotate` 后）。
- overrides：13 个；本批涉及 `memory.search`（→ 12）。
- 本批全部 GET，无 wire 变更；终值 **53/318（16.7%）**。

## 1. 范围

| op | path | handler | 备注 |
|---|---|---|---|
| `memory.search` | `/api/memory/search` | `routes/memory.ts:285` | override → code-first；`results` 与 `MemoryUnit` 做 `AssertEq`；`t1Results` 为 layer!=gist 时的附加数组 |
| `memory.get` | `/api/memory/get` | `routes/memory.ts:260` | MCP `get-memory` 透传；成功 / 404 失败两种 body，schema 建模成功体 + 失败体 |
| `recall.context` | `/api/recall/context` | `routes/recall.ts:104` | |
| `recall.pinned` | `/api/recall/pinned` | `routes/recall.ts:62` | |
| `recall.instructions` | `/api/recall/instructions` | `routes/recall.ts:47` | |
| `recall.priors` | `/api/recall/priors` | `routes/recall.ts:86` | |
| `lead.recall` | `/api/lead/recall` | `routes/lead-topics.ts:334` | |
| `lead.workingSet` | `/api/lead/working-set` | `routes/lead-topics.ts:330` | |

Reserve（形状不稳时替换并在报告记录）：`lead.context`、`memory.mergedSearch`、`memory.listSticky`。

## 2. 增量规则

1. handler 为事实源；`memory.search` 先读 override，schema 必须覆盖 handler 的 `{results, t1Results?}` 实际形状，`results` 元素与 SDK `MemoryUnit` 做 `AssertEq`（现有 `CHECK_memory_search` 必须继续通过）。
2. 删除 `memory.search` 的 override 条目并更新 `$comment`；`gen:api` 只允许预期 op 变化。
3. 其余规则同 E10 §2（不整响应放宽、边界注明 owner、生成物入库、覆盖率清单同步）。
4. 覆盖率测试清单追加 8，阈值 45 → 53，`TOTAL_OPS` 318。

## 3. 非目标

- 请求体 schema、POST/PUT/PATCH/DELETE。
- `lead.context` / `memory.mergedSearch` / `memory.listSticky`（本批 reserve，下一批）。
- 剩余 ~265 ops。

## 4. 门禁

gateway tsc 0 + 全量（9 env-red）+ `schema:coverage` 53/318 + analyze TOTAL 0 + `emit:openapi` 无意外 diff。
SDK tsc/full（226）/contract 4/4 + `gen:api` 幂等。
desktop full（1 resolver env-red）+ tsgo（2 `node:tls`）。
mobile targeted + analyze；TUI env-red；kernel-split 7/7。
