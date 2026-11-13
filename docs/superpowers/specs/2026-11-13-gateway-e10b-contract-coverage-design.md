# Gateway E10b 契约覆盖（第二批）：设计（2026-11-13）

> 承接 E10（13 → 29/316）。本批覆盖 **15 个读接口**：Goal/桌面主工作面 8 + human-gate/权限面 7。
> 规则、生成链、门禁沿用 `2026-11-13-gateway-e10-contract-coverage-design.md` §2；本文件只记录增量决策。

## 0. 基线

- catalog：316 ops，**29** 个带 `response`。
- SDK `contract/overrides.json`：**18** 个 override op。其中 5 个落在本批范围：
  `goals.list`、`goals.sessions`、`approvals.list`、`questions.list`、`triage.list`。
- 生成链：catalog `response` 优先于 overrides（`merge-contract.mjs` 明确打印 "catalog response schema wins over overrides"）。
- 目标终值：29 + 15 = **44** 个 covered（E10b 收口时分母 316；合并 main 后分母 **317**——main 新增
  `session.discoverySkillInvoke`，covered 不变 → **44/317**）；override 数 18 → **13**（5 个转 code-first 后删除 override 条目）。

## 1. 范围

### E10b-1 Goal / Pod Goal 读接口（8 ops）

| op | path | 备注 |
|---|---|---|
| `goals.list` | `/api/goals` | 现为 override；SDK `Goal` 已有 AssertEq |
| `goals.plan` | `/api/goals/:id/plan` | plan package 形状 |
| `goals.sessions` | `/api/goals/:id/sessions` | 现为 override；`GoalSessionInfo` 已有 AssertEq |
| `goals.timeline` | `/api/goals/:id/timeline` | turns/events |
| `goals.source` | `/api/goals/:id/source` | |
| `pods.goals.techLead` | `/api/pods/:podId/goals/:goalId/tech-lead` | |
| `pods.goals.probes` | `/api/pods/:podId/goals/:goalId/probes` | |
| `pods.goals.revisions` | `/api/pods/:podId/goals/:goalId/revisions` | `PodGoalRevision` 已有 |

Reserve：`goals.control`（POST，不在本批）、`pods.goals.worktree.diff`。

### E10b-2 Human-gate / 权限读接口（7 ops）

| op | path | 备注 |
|---|---|---|
| `approvals.list` | `/api/approvals` | 现为 override；`Approval` 已有 AssertEq |
| `questions.list` | `/api/questions` | 现为 override；`QuestionRequest` 已有 AssertEq |
| `triage.list` | `/api/triage` | 现为 override；`TriageItem` 已有 AssertEq |
| `permissions.list` | `/api/permissions` | |
| `permissions.getMode` | `/api/sessions/:sid/permission-mode` | |
| `permissions.listAllowlist` | `/api/approvals/allowlist` | |
| `permissions.listRules` | `/api/approvals/rules` | |

### E10b-3 收口

- `schema-coverage.test.ts`：清单追加 15 个 op，阈值 29 → 44，`TOTAL_OPS` 仍 316。
- 删除 5 个已被 catalog schema 取代的 override 条目（`goals.list` / `goals.sessions` / `approvals.list` / `questions.list` / `triage.list`），并在 `overrides.json` 的 `$comment` 记录原因。
- docs + release + 全量门禁。

## 2. 增量规则

1. **override → code-first 的等价性**：5 个 op 必须先读 override schema 与 handler，写出与 handler 一致的 TypeBox schema；SDK 既有 `AssertEq`（Goal / GoalSessionInfo / Approval / QuestionRequest / TriageItem）必须继续通过。若 override 与 handler 不一致，以 handler 为准并记录 SDK 类型变化。
2. 删除 override 条目必须验证生成物：删除前后 `npm run gen:api` 输出应只对本批 op 产生**预期内**变化；若出现无关 diff，停止并报告。
3. 其余规则（handler 为事实源、禁止整响应放宽、边界对象注明 owner、生成物入库、`emit:openapi` + `gen:api`）同 E10 spec §2。
4. 覆盖率测试是硬门禁：每批结束更新清单与阈值；测试失败不得用 `>=` 放水绕过（清单必须精确覆盖新 op）。

## 3. 非目标

- 请求体 schema、POST/PUT/PATCH/DELETE。
- 其余 ~272 ops。
- `permissions` 的写接口（reply/allowlist/rules 变更）。
- OS keychain / MCP / 配额 / admission（属 E11）。

## 4. 门禁

gateway：tsc 0 + `emit:openapi` 无意外 diff + `schema:coverage` 44/317（合并 main 后）+ targeted（api-contract、schema-coverage、goals/pods/permissions/approvals 路由）+ 全量（9 env-red）。
SDK：tsc 0 + full（225 基线）+ contract 4/4 + `gen:api` 后无漂移。
desktop：full（1 resolver env-red）+ tsgo（2 `node:tls` 噪声）。
mobile：targeted（本批无 wire 变化，预期无改动）。
架构：analyze-routes TOTAL 0；kernel-split 7/7。
