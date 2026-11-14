# Gateway E10c 契约覆盖第三批（memory / recall / lead）交付记录（2026-11-14）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：**只加 OpenAPI 元数据**（`RouteDef.response` + 生成物入库），handler / wire / 路由集合零变化

## 波次

- 分支：`feat/gateway-e10c-memory-recall-coverage`（worktree `.superpowers/e10c-worktree`），
  基线 `4a506403`（E10c spec + plan），实现 commit `43101302`
- 范围：8 个读接口的 200 response schema（memory 2 / recall 4 / lead 2），
  并把 `memory.search` 从 `contract/overrides.json` 迁成 code-first
- spec：`docs/superpowers/specs/2026-11-14-gateway-e10c-memory-recall-coverage-design.md`
- plan：`docs/superpowers/plans/2026-11-14-gateway-e10c-memory-recall-coverage.md`
- 架构现状：`docs/architecture/gateway.md` §「E10c 契约覆盖第三批（2026-11-14）」
- TDD：先写 api-contract 失败用例 → 最小 schema 实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-14-gateway-e10c-contract/{progress.md,batch1-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `43101302` | E10c-1 | `feat(contract)`: `routes/schemas/{memory,recall,lead}.ts` 8 op 的 200 schema + `memory.search` override → code-first + 覆盖率台账 45 → 53 + 生成物 |
| 本记录 | E10c-2 | `docs(gateway)`: 架构台账 + 本记录 + 全量门禁（docs-only，零产品代码） |

## 交付项（8 ops）

| 文件（new） | ops | 形状来源（handler = 事实源） |
|---|---|---|
| `gateway/src/routes/schemas/memory.ts` | `memory.search` / `memory.get` | `routes/memory.ts` + `mcp/handlers/get-memory.ts` |
| `gateway/src/routes/schemas/recall.ts` | `recall.context` / `recall.pinned` / `recall.instructions` / `recall.priors` | `routes/recall.ts` / `pinned-recall.ts` / `recall-instructions.ts` / `agent-priors.ts` |
| `gateway/src/routes/schemas/lead.ts` | `lead.recall` / `lead.workingSet` | `routes/lead-topics.ts` + `core/lead/{topic-recall,working-set,lead-topic-store}.ts` |

关键建模决定：

- **`memory.search`**（override → code-first）：真实形状 `{results, t1Results?}`——
  `layer=gist`（默认）不带 `t1Results`，`layer=t1` 是 `{results: [], t1Results}`，`layer=both` 两者都有。
  `results` 元素与 SDK `MemoryUnit` **逐字段等价**（既有 `CHECK_memory_search` 继续绿）；
  降级分支（index 有、OKF 文件缺失）补的 `tier` 是索引级字段，**不建模**（JSON Schema 未关
  `additionalProperties`，多余键合法）。
- **`memory.get`**：200 成功体建模为 **3 变体 union**——Harmonic unit 体
  `{success:true, memory, latest?, source?}`、legacy 会话尾指针 `t1:<tail>:<turn>`、永久 `t1:<traceId>`；
  不做「全 optional 宽松对象」。**404 错误体**（`{success:false, error, candidates?}`，含 ambiguous tail 候选）
  **不是 200 schema 的一部分**，文件头 + 条目注释写明，并由 api-contract 用例**反向断言**
  （`{success:false, …}` 必须不通过 200 schema）。
- **`recall.*`**：四面都是 **fail-open 200**（内存服务缺失 / 渲染异常 / 检索异常 → 中性空体），
  没有 4xx/5xx 需要建模；`recall.pinned.entries` 的 `salience` / `created_at` 按 legacy OKF 缺键
  保守设 optional（与 `MemoryUnit` 同一处理）。
- **`lead.*`**：两路由恒 200；`LeadTopicView` 是 `toView` 投影（不含 session id / 索引行），
  `summary` / `resumedFrom` 是 DB 可空列 → `string | null`；`state` 用 `normalizeState` 四值闭词表。
- 本批**没有**新增 `additionalProperties: true` 的「整块放行」；`memory.get` 的 `HarmonicUnit` 是网关自有类型
  （owner `core/memory/harmonic-types.ts`），按字段建模，frontmatter 残留键不承诺。

## schema-only vs AssertEq

| op | 校验方式 | 理由 |
|---|---|---|
| `memory.search` | **AssertEq ×2** | `results` item ↔ SDK `MemoryUnit`（`CHECK_memory_search`）；新增 `CHECK_memory_search_t1_item`（`t1Results` item ↔ `T1SearchHit`） |
| `memory.get` | schema-only | `internal` tag，SDK 无 client / 无 DTO；三变体 union 由 api-contract 的 Value.Check 线样钉住 |
| `recall.context` | schema-only | `internal`，plugin / pi host extension 注入通道，SDK 不调用 |
| `recall.pinned` | schema-only | 同上 |
| `recall.instructions` | schema-only | 同上 |
| `recall.priors` | schema-only | 同上 |
| `lead.recall` | schema-only | `lead` tag，developer diagnostic 面，SDK 无 client |
| `lead.workingSet` | schema-only | 同上 |

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `4a506403` | **45 / 318** | E11 收口值（`humanToken.rotate` 后 317 → 318） |
| **E10c 终值** | **53 / 318（16.7%）** | +8（memory 2 / recall 4 / lead 2），分母不变；未覆盖 **265** |

- 台账 `gateway/tests/unit/architecture/schema-coverage.test.ts` 钉住 **53 / 318**（`TOTAL_OPS` 318），
  `npm run schema:coverage` 实测 by-tag 分区和 = 53：`memory 1/7`（`memory.get` 在 `internal`）、
  `lead 2/11`、`internal 11/73`（含 recall ×4 + `memory.get`）。
- **override 13 → 12**：删除 `memory.search.responseSchema`，`$comment` 记录 E10c-1；
  `merge-contract` 输出只剩 `session.list: catalog response schema wins over overrides`（历史遗留，非本批）。
- 生成物 diff 审计：`gateway-paths.json`（318 ops，added 0 / removed 0 / changed 恰为 8）、
  `openapi.json`（同 8 op）、`src/api-schema.gen.ts`（changed 恰 8 块）；`npm run gen:api` 二次运行幂等。
- 生成链不变：catalog `RouteDef.response` → `npm run emit:openapi` → SDK `npm run gen:api` →
  `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## 行为变化 / Breaking

**无。** 本批零 handler 改动、零路由增删、请求 / 响应字节不变；变化只有 OpenAPI 文档与 SDK 生成类型
（`memory.search` 的 `t1Results` 由 override 手写描述改为 catalog 生成，签名兼容）。

## 验证（worktree @ E10c-2）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS **5.9.3**） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7250 tests：7238 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 919 passed（922 of 923）**；**9 条失败恰好是 3 个已知 env-red suite，零 E10c 红**；255.1s（明细见下） |
| 覆盖率台账 | `npm run schema:coverage` | **53/318 operations（16.7%）**，by-tag 分区和 = 53，未覆盖 265 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 干净） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（基线 226） |
| SDK contract | `node --import tsx --require ../test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| SDK 生成幂等 | `npm run gen:api`（二次） | **幂等**（`git status` 干净；`overrides 命中 12`） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3845 tests / 731 suites：3844 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/view_dto_test.dart test/vocabulary_parity_test.dart --concurrency=1` | **15 / 15 passed** |
| mobile analyzer | `dart analyze lib test`（先 `flutter pub get`） | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（全仓同；本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 919 passed, 922 of 923 total
Tests:       9 failed, 3 skipped, 7238 passed, 7250 total
Snapshots:   0 total
Time:        255.09 s
```

## 新增测试（对基线 `4a506403` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+5** | `tests/unit/api-contract.test.ts`：8-op 的 200 schema 属性/数组必填（非整响放宽）、`memory.search` code-first 形状（override 已删 + `t1Results` 随 layer 可选）、`memory.get` 三变体 union + 404 体排除、handler 线样 `Value.Check`、生成物路径一致性 |
| SDK | **0 运行时 / +1 编译期** | `contract-compat.checks.ts` 新增 `CHECK_memory_search_t1_item`（`AssertEq` 是编译期检查，`npm test` 仍 226） |
| desktop | 0 | 无代码变更（本批无消费面变化） |
| mobile | 0 | 无代码变更 |
| **合计** | **+5** | 可执行 test case 数（非断言数） |

- gateway 全量 **7250** = 基线 `4a506403` 反推 **7245** + 5（基线未单独复跑；E11 记录里的 7243 是
  E11 worktree 合并前口径，main 合并后为 7245）。commit 内 `gateway/tests` 只有 2 个文件改动、
  无删除用例（`git show --numstat`：`api-contract` +225 / `schema-coverage` +13/−2 行）。

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e.test.ts`、
   `tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
   ——esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk`；与 E11 基线同集合，
   E10c 未触碰适配器 / 插件打包路径。
2. **`instance-lock-heartbeat` 负载 flake（首轮 1 条，非产品红）**：首轮全量里
   `tests/unit/runtime/instance-lock-heartbeat.test.ts` 的「≥10s 心跳 / >30s stale」用例
   `Exceeded timeout of 5000 ms`（真实时钟 + 5s 上限，机器同时跑 desktop / flutter 门禁）；
   **隔离重跑 4/4 passed（2.3s）**，第二轮全量回到 9 条已知红。判为环境 flake，零产品改动相关。
3. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到 `null`；
   `gateway npm run build` 后即全绿。
4. **desktop 类型 `node:tls` 2 条**：`@types/node` 比运行时 `node:tls` 旧，既有噪声。
5. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。

## Deferred（E10c 后仍保留）

- 剩余约 **265** 个 op 的 response schema 覆盖（53/318；继续按同族读接口 7–8 ops/批推进）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema；已有 8 op 的错误体仍不建模
  （`memory.get` 404 只在测试里反向断言）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **`memory.get` 的 HarmonicUnit 手工镜像漂移风险**：`HarmonicUnitSchema` 镜像
  `core/memory/harmonic-types.ts`，没有 `AssertEq` 桥 → 新增 harmonic 字段不会打红任何测试。
  缓解：未关 `additionalProperties`，多余键合法；强约束待加 gateway 侧编译期桥。
- TUI / mobile 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 只有
  `summary` / `source` / `state` / `proposedGoal`）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- 后续候选（本批 reserve 未动）：`lead.context` / `memory.mergedSearch` / `memory.listSticky`。
