# Gateway E10d 契约覆盖（第四批：memory 扩展 / lead.context / pods）：设计（2026-11-14）

> 承接 E10c（53/318）。本批 **8 个读接口**，无 override 变更，无 wire 变更。
> 规则沿用 `2026-11-13-gateway-e10-contract-coverage-design.md` §2。

## 0. 基线

- catalog：318 ops，**53** 个有 response schema。
- overrides：12（本批不涉及）。
- 终值：**61/318（19.2%）**。

## 1. 范围

| op | path | handler | 备注 |
|---|---|---|---|
| `memory.mergedSearch` | `/api/memory/merged-search` | `routes/memory.ts:63` | merged/worktree 搜索 |
| `memory.getEnergyDistribution` | `/api/memory/energy-distribution` | `routes/memory.ts:377` | |
| `memory.getL5Axioms` | `/api/l5/axioms` | `routes/memory.ts:399` | |
| `memory.listSticky` | `/api/memory/sticky` | `routes/memory.ts:233` | note-board |
| `lead.context` | `/api/lead/context` | `routes/lead-topics.ts:312` | |
| `pods.lookup` | `/api/projects/:projectId/pod/lookup` | `routes/pod-handlers.ts` map | 桌面/mobile 定位 Pod |
| `pods.transcript` | `/api/pods/:podId/sessions/:sessionId/transcript` | `routes/pod-handlers.ts` map | `{transcript: unknown}`（runtime-owned boundary） |
| `pods.goals.worktree.diff` | `/api/pods/:podId/goals/:goalId/worktree/diff` | `routes/pod-handlers.ts` map | SDK `PodWorktreeDiff` 已有 |

Reserve：`pods.memory.get`、`pods.cost`（已覆盖）、`memory.listSticky`（若形状不稳可换 `pods.goals.techLead` 已覆盖）。

## 2. 增量规则

1. handler 为事实源；`pods.goals.worktree.diff` 与 SDK `PodWorktreeDiff` 做 `AssertEq`。
2. `pods.transcript.transcript` 是 runtime-owned payload：边界对象 + owner 注释，不得整响应放宽。
3. 覆盖率清单追加 8，阈值 53 → 61，`TOTAL_OPS` 318。
4. 生成物入库；`emit:openapi` + `gen:api` 幂等。

## 3. 非目标

- 请求体 schema、其余 ~257 ops。
- `pods.memory.get`、`pods.goals.revisions`（后者已覆盖）等留待下一批。
- TUI/mobile phantom 字段。

## 4. 门禁

gateway tsc 0 + 全量（9 env-red）+ coverage 61/318 + analyze TOTAL 0。
SDK tsc/full（226）/contract 4/4 + `gen:api` 幂等。
desktop full（1 resolver env-red）+ tsgo（2 `node:tls`）。
mobile targeted + analyze；TUI env-red；kernel-split 7/7。
