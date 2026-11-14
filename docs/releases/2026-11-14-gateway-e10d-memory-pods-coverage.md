# Gateway E10d 契约覆盖第四批（memory 扩展 / lead.context / pods）交付记录（2026-11-14）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：**只加 OpenAPI 元数据**（`RouteDef.response` + 生成物入库）+ 3 处 **SDK 类型面同步**；
  handler / wire / 路由集合零变化，override 条目零变化（仍 12）

## 波次

- 分支：`feat/gateway-e10d-memory-pods-coverage`（worktree `.superpowers/e10d-worktree`），
  基线 `60cc5793`（E10d spec + plan），实现 commit `bcc344c2`
- 范围：8 个读接口的 200 response schema（memory 扩展 4 / `lead.context` 1 / pod 读 3），
  无 override 迁移、无新增路由（catalog 仍 318 ops）
- spec：`docs/superpowers/specs/2026-11-14-gateway-e10d-memory-pods-coverage-design.md`
- plan：`docs/superpowers/plans/2026-11-14-gateway-e10d-memory-pods-coverage.md`
- 架构现状：`docs/architecture/gateway.md` §「E10d 契约覆盖第四批（2026-11-14）」
- TDD：先写 api-contract 失败用例（6 例）+ 覆盖率台账（53 → 61）→ 红（`Cannot find module
  schemas/memory-extra`、覆盖率 2 例失败）→ 最小 schema 实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-14-gateway-e10d-contract/{progress.md,batch1-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `bcc344c2` | E10d-1 | `feat(contract)`: `routes/schemas/{memory-extra,pods,lead}.ts` 8 op 的 200 schema + 覆盖率台账 53 → 61 + SDK 3 处类型面同步 + 生成物 |
| 本记录 | E10d-2 | `docs(gateway)`: 架构台账 + 本记录 + 全量门禁（docs-only，零产品代码） |

## 交付项（8 ops）

| 文件 | ops | 形状来源（handler = 事实源） |
|---|---|---|
| `gateway/src/routes/schemas/memory-extra.ts`（new） | `memory.mergedSearch` / `memory.getEnergyDistribution` / `memory.getL5Axioms` / `memory.listSticky` | `routes/memory.ts`、`memory/service.ts`、`interceptors/memory-injector.ts`、`core/memory/l5-store.ts`、`routes/note-board.ts` |
| `gateway/src/routes/schemas/lead.ts`（扩展） | `lead.context` | `routes/lead-topics.ts` `handleLeadContext` → `core/lead/lead-context.ts` `buildLeadContext` |
| `gateway/src/routes/schemas/pods.ts`（扩展） | `pods.transcript` / `pods.goals.worktree.diff` | `routes/pods.ts`、`core/pod/pod-worktree-service.ts` `branchDiff()` |
| `gateway/src/routes/route-catalog.ts` | `pods.lookup` | 复用 `PodDetailResponse`（lookup 分支与 `pods.get` 同 wire：`enrichPodDetail()`，仅按成员角色清空 `sessions`） |

关键建模决定：

- **`pods.lookup`**：不另立 schema。lookup 分支与 `pods.get` 共用 `enrichPodDetail()`，字段面完全一致
  （非 lead 成员只是 `sessions: []`）→ catalog 直接复用 `PodDetailResponse`；
  api-contract 用 `schemaOf('pods.lookup') toEqual schemaOf('pods.get')` 钉住，SDK 侧 `AssertEq ↔ PodDetail`。
- **`pods.transcript`**：`{transcript: unknown}` 是 **runtime-owned 边界对象**
  （`PodRouteDeps.transcript()` 直接返回 runtime 页数据，part 判别联合随 runtime 演进）
  → owner 注释 + schema 只承诺「外层对象仅此一键、值任意 JSON」；不整响应放宽。
  与 `pods.goals.techLead.messages` 同一先例。
- **`pods.goals.worktree.diff`**：逐字段对齐 SDK `PodWorktreeDiff`（5 键 + `files[5]`；
  `status` 是 git name-status 字母，故 `string`）。
- **`memory.listSticky`**：503（记忆服务缺失）与 catch 分支都回 **同形** `{entries: [], budget}`
  （fail-open shell），故 200 schema 恰好也描述这两个降级体；`created_at` / `sticky_until`
  按 legacy OKF 缺键保守设 optional。
- **`memory.getL5Axioms`**：`L5Store.getTop()` 原样透传；axiom / heuristic 按 store 写入面
  （`addAxiom` / `addHeuristic` 恒写全列）建模为必填。
- **`memory.mergedSearch` / `memory.getEnergyDistribution`**：`MemoryFact.type` 保持 `string`
  （接口未收窄，不枚举值域）；能量分布是索引四分桶 + `total`。
- **`lead.context`**：四个出口同形（非 Lead 会话 / working set 关闭 / 无 projectDir → `EMPTY_CONTEXT`），
  无错误体；`topicId` / `title` 只有 recalled-topic 块带 → optional；`trimmed` 是块类名数组。

## schema-only vs AssertEq

| op | 校验方式 | 理由 |
|---|---|---|
| `memory.mergedSearch` | **AssertEq**（`results` item ↔ `MemoryFact`） | SDK `memory.mergedSearch` 有命名 DTO |
| `memory.getEnergyDistribution` | **AssertEq**（整响应 ↔ `EnergyDistribution`） | 同上 |
| `memory.getL5Axioms` | **AssertEq ×2**（`axioms` item ↔ `Axiom`、`heuristics` item ↔ `L5Heuristic`） | 两个命名 DTO |
| `memory.listSticky` | **AssertEq**（整响应 ↔ client `memory.listSticky` 返回类型） | 无单一命名 DTO，锁 client 返回类型（`{entries, budget}`） |
| `lead.context` | schema-only | `internal` tag，host 每轮注入面，SDK 无 client / 无 DTO |
| `pods.lookup` | **AssertEq**（整响应 ↔ `PodDetail`） | 与 `pods.get` 同一 DTO |
| `pods.transcript` | **AssertEq**（整响应 ↔ client `pod.transcript` 返回类型） | 边界等价（`{transcript: unknown}`），无命名 DTO |
| `pods.goals.worktree.diff` | **AssertEq**（整响应 ↔ `PodWorktreeDiff`） | 命名 DTO 既有 |

即 **7/8 op 有编译期断言**（其中 `getL5Axioms` 贡献 2 条，共新增 8 个 `CHECK_*` 常量）；
唯一 schema-only 是 `lead.context`。

## 类型面 DTO 同步（handler 为事实源，零 wire 变化）

| DTO | 变化 | 依据 |
|---|---|---|
| `Axiom` | 补 `source: 'manual' \| 'distilled'` 与 `created_at: string` | `L5Store.addAxiom` 恒写这两列（原 DTO 只列 id/content/energy） |
| `L5Heuristic` | `success_rate` / `source_goal_ids` / `created_at` 由 optional **收紧为必填** | `addHeuristic` 恒写七列（`success_rate` 初值 0.9） |
| `StickyNote.type` | `string` → `MemoryUnit['type']` | note-board 条目来自 `HarmonicUnit`，与 `memory.search` 同一词表；desktop `NotesDock` 用自有 `type: string`、TUI 只读 → **0 破坏性消费者** |

历史数据可能比契约短：`~/.mafw` 下更早版本 / 手工编辑过的 `axioms.json` / `heuristics.json`
若缺列，读路径 `JSON.parse` 不校验、wire 仍会缺键——OpenAPI 只是元数据（不做运行时拒绝），
契约描述的是**当前 store 写入面**。

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `60cc5793`（E10c 终值） | **53 / 318** | memory 1/7（`memory.get` 在 `internal`）、lead 2/11、internal 11/73 |
| **E10d 终值** | **61 / 318（19.2%）** | +8（memory 4 / `lead.context` 1 / pods 3），分母不变；未覆盖 **257** |

- 台账 `gateway/tests/unit/architecture/schema-coverage.test.ts` 钉住 **61 / 318**（`TOTAL_OPS` 318），
  `npm run schema:coverage` 实测 by-tag 分区和 = 61：`memory 5/7`、`lead 2/11`
  （`lead.context` 挂 `internal`）、`pods 13/39`、`internal 12/73`。
- **override 12 → 12**：本批不涉及；`merge-contract` 仍只输出
  `session.list: catalog response schema wins over overrides`（历史遗留，非本批）。
- 生成物 diff 审计：`gateway-paths.json` / `openapi.json`（各 `1782+/155-`，changed 恰为 8 个目标 op、
  added 0 / removed 0）、`api-schema.gen.ts`（`238+/8-`，changed 恰 8 块）；`npm run gen:api` 二次运行幂等。
- 生成链不变：catalog `RouteDef.response` → `npm run emit:openapi` → SDK `npm run gen:api` →
  `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## 行为变化 / Breaking

**无。** 本批零 handler 改动、零路由增删、请求 / 响应字节不变；变化只有 OpenAPI 文档与
SDK 生成类型的**类型面**收紧（三处 DTO 以 handler 为准，编译期可见；运行时 wire 早已是这些字段）。

## 验证（worktree @ E10d-2）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7256 tests：7244 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 919 passed（922 of 923）**；**9 条失败恰好是 3 个已知 env-red suite，零 E10d 红**；439.8s（明细见下） |
| 覆盖率台账 | `npm run schema:coverage` | **61/318 operations（19.2%）**，by-tag 分区和 = 61，未覆盖 257 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 无生成物改动） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（基线 226） |
| SDK contract | `node --import tsx --require ../test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| SDK 生成幂等 | `npm run gen:api`（二次） | **幂等**（无生成物 diff；`overrides 命中 12`） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3852 tests / 735 suites：3851 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/view_dto_test.dart test/vocabulary_parity_test.dart --concurrency=1` | **15 / 15 passed** |
| mobile analyzer | `dart analyze lib test`（先 `flutter pub get`） | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（全仓同；本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 919 passed, 922 of 923 total
Tests:       9 failed, 3 skipped, 7244 passed, 7256 total
Snapshots:   0 total
Time:        439.84 s
```

## 新增测试（对基线 `60cc5793` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+6** | `tests/unit/api-contract.test.ts`：8-op 200 schema 属性/数组元素必填（非整响放宽）、嵌套形状（L5 heuristic 七列 / note-board budget / lead block 词表 + optional topicId/title）、`pods.transcript` 边界对象、`worktree.diff` ↔ `PodWorktreeDiff` 字段集、`Value.Check` 线样（含反向用例：非法 source / 缺 bucket / 非法 note.type / 非法 block kind / 不完整 diff file / `pods.lookup` ≡ `pods.get`） |
| SDK | **0 运行时 / +8 编译期** | `contract-compat.checks.ts` 新增 8 个 `CHECK_*`（`AssertEq` 是编译期检查，`npm test` 仍 226） |
| desktop | 0 | 无代码变更 |
| mobile | 0 | 无代码变更 |
| **合计** | **+6** | 可执行 test case 数（非断言数） |

- gateway 全量 **7256** = E10c 收口口径 **7250** + 6；commit 内 `gateway/tests` 只有两个文件改动
  （`git show --numstat bcc344c2`：`api-contract` +210/−1 / `schema-coverage` +11/−3 行），无删除用例。

## 已知红（非本波代码问题）

1. **gateway env-red**：`tests/integration/plugin-package-e2e.test.ts`、
   `tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
   ——esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk`；与 E10c 基线同集合
   （**9 条 / 3 suites，0 新增**）。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到 `null`。
3. **desktop 类型 `node:tls` 2 条**：`@types/node` 比运行时 `node:tls` 旧，既有噪声。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。

## Deferred（E10d 后仍保留）

- 剩余约 **257** 个 op 的 response schema 覆盖（61/318；继续按同族读接口 7–8 ops/批推进）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema；错误体仍不建模（`memory.get` 404 只在测试里反向断言）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **`memory.get` 的 HarmonicUnit 手工镜像漂移风险**（E10c 遗留）：`HarmonicUnitSchema` 镜像
  `core/memory/harmonic-types.ts`，没有 gateway 侧 `AssertEq` 桥 → 新增 harmonic 字段不会打红任何测试。
- TUI / mobile 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 只有
  `summary` / `source` / `state` / `proposedGoal`）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- 后续候选：`pods.memory.get`、`pods.goals.techLead.messages`、`memory.setSticky` 等同族读接口。
