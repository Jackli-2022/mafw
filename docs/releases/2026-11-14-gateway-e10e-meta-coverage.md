# Gateway E10e 契约覆盖第五批（元数据 / 注册面）交付记录（2026-11-14）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：**只加 OpenAPI 元数据**（`RouteDef.response` + 生成物入库）；
  handler / wire / 路由集合零变化，override 条目零变化（仍 12），**SDK DTO 零改动**

## 波次

- 分支：`feat/gateway-e10e-meta-coverage`（worktree `.superpowers/e10e-worktree`），
  基线 `2f4c3ecf`（E10e spec + plan），实现 commit `95f289f1`
- 范围：8 个元数据 / 注册面读接口的 200 response schema，
  无 override 迁移、无新增路由（catalog 仍 318 ops）
- spec：`docs/superpowers/specs/2026-11-14-gateway-e10e-meta-coverage-design.md`
- plan：`docs/superpowers/plans/2026-11-14-gateway-e10e-meta-coverage.md`
- 架构现状：`docs/architecture/gateway.md` §「E10e 契约覆盖第五批（2026-11-14）」
- TDD：先写 api-contract 失败用例（8 例）+ 覆盖率台账（61 → 69）→ 红 → 最小 schema 实现 → 一个 commit；
  批证据见 `.superpowers/sdd/2026-11-14-gateway-e10e-contract/{progress.md,batch1-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `95f289f1` | E10e-1 | `feat(contract)`: `routes/schemas/meta.ts` 8 op 的 200 schema + 覆盖率台账 61 → 69 + 6 条编译期断言 + 生成物（8 文件 / +2637 −70 行） |
| 本记录 | E10e-2 | `docs(gateway)`: 架构台账 + 本记录 + 全量门禁（docs-only，零产品代码） |

## 交付项（8 ops）

| 文件 | ops | 形状来源（handler = 事实源） |
|---|---|---|
| `gateway/src/routes/schemas/meta.ts`（new，329 行） | 全部 8 个 | 见下表 |
| `gateway/src/routes/route-catalog.ts` | 8 个 op 挂 `response` | 无新增 / 删除路由 |
| `gateway/tests/unit/api-contract.test.ts` | — | 新增 E10e-1 describe（8 个 test） |
| `gateway/tests/unit/architecture/schema-coverage.test.ts` | — | 覆盖清单 61 → 69 |
| `packages/gateway-sdk/src/contract-compat.checks.ts` | — | 6 个编译期断言 |
| `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` | — | 生成物（只动 8 个目标 op） |

逐 op 形状来源：

| op | path | handler | 建模依据 |
|---|---|---|---|
| `agents.list` | `GET /api/agents` | `routes/misc.ts:111` | `runtime/view-projections.ts` `projectAgents()` → `MafwAgent` |
| `providers.list` | `GET /api/provider` | `routes/misc.ts:96` | `projectProviderEnvelope()` / `projectProvider()` / `projectModel()` → `MafwProvider` |
| `mcp.servers` | `GET /api/mcp/servers` | `routes/mcp-mgmt.ts:35` | runtime mcp channel `list()` → `RuntimeMcpStatusInfo`（≡ SDK `McpServerEntry`） |
| `plugins.list` | `GET /api/plugins` | `routes/wave2-handlers.ts:108` | `plugins/hub.ts` `listPlugins()` + `plugins/package-inventory.ts` → `PluginsListResult` |
| `skills.list` | `GET /api/skills` | `routes/skills.ts:26` | kernel `listInstalledSkills()` = DB 行 + 零行补齐的 `SkillInvocationStats` |
| `tools.list` | `GET /api/tools` | `routes/tools.ts:29` | `runtime/mafw-tools.ts` `MAFW_TOOL_SPECS: MafwToolSpec[]` |
| `config.get` | `GET /api/config` | `routes/config.ts:20` | `config.raw: GatewayConfig`（26 个 section） |
| `scheduler.status` | `GET /api/scheduler/status` | `routes/scheduler.ts:31` | `SchedulerStatus` + `SchedulerPlan` |

关键建模决定：

- **`agents.list` / `providers.list`**：投影会在原生形状上条件展开字段（`description` / `default` /
  `planning` / `mode` / `model`），按 DTO 的 optional 面建模；`source`（`mafw` | `runtime`）与
  `selectable` 是 gateway 判定的封闭词表，客户端不自己重算。
- **`providers.list` 信封残余**：`projectProviderEnvelope()` 先摊平原生信封（删 `all`）再补 `items`，
  所以 200 body 还带 runtime 的 `connected: string[]` 与 `default: Record<providerID, modelID>`
  —— owner = runtime provider channel，gateway 只透传；这两个键显式建模（composer 默认模型唯一来源），
  `items` 仍要求必填（不把整个信封退化成任意 JSON）。其余原生残余键不在契约面承诺。
- **`mcp.servers`**：`{servers: McpServerEntry[]}`，`status` 五态、`type` local/remote 按 runtime
  契约收窄；`servers` 在 handler 恒发（SDK client 的 `{servers?}` 守卫不影响 wire）。
- **`plugins.list`**：`PluginsListResult` 逐键等价——`plugins[]`（4 type × 4 status）、`packages[]`
  （`PackageState` + `enabled` + `status: 'disabled'` 合成行，optional）、`revision?`
  （只在 envelope provider 存在时下发，故 optional）。
- **`skills.list`**：`{skills: SkillRegistryItem[]}`，DB 行（`installedAt` / `updatedAt` 为 epoch 毫秒）
  + 零行补齐的 `stats`（`lastAt: number | null`）；`status` 四态来自 `SkillStatus`。
- **`tools.list`**：`{tools: MafwToolSpec[]}`；`parameters` / `outputSchema` 是**工具作者拥有的 JSON
  Schema 对象**（owner = 各 tool spec 声明）→ 边界对象（`Record(String, Unknown)`），不逐键建模；
  `annotations` 是 MCP stable spec 注解五键（全 optional）。
- **`config.get`**：200 body = `config.raw`（defaults + `config.yaml` 深合并 + env 覆盖）。`deepMerge`
  对未知键同样写入 → section 内键集运营可扩展，逐字段转写会成为 `GatewayConfig` 的手抄第二副本（无
  编译期链接、静默漂移）。因此：**外层 section 键集 required 固定**（26 个名字 required，编译期断言 ≡
  `keyof GatewayConfig`；TypeBox 不输出 `additionalProperties: false`，闭包由 required 集合 + 编译期 pin
  保证，而非 schema 自身闭合），**section 内是边界对象**（owner = gateway config loader，`Config.buildData`）。
  顶层不额外放宽（无 `additionalProperties` / `patternProperties`）。
- **`scheduler.status`**：`{active, queued, capacity, plan}`；`plan` 四键恒在（`humanSlot` 打开时
  capacity +1）；404 的 `{error}` 不是 200 body。

## AssertEq vs schema-only（逐 op）

| op | 校验方式 |
|---|---|
| `agents.list` | **AssertEq**：`items` item ≡ `MafwAgent` |
| `providers.list` | **AssertEq**：`items` item ≡ `MafwProvider`；另加信封残余 `connected ≡ string[] \| undefined`、`default ≡ Record<string,string> \| undefined`（对齐 client 返回类型） |
| `mcp.servers` | **AssertEq**：`servers` item ≡ `McpServerEntry` |
| `plugins.list` | **AssertEq**：整个响应 ≡ `PluginsListResult` |
| `skills.list` | schema-only（tags: internal，无 SDK client） |
| `tools.list` | schema-only（tags: internal，runtime 经 loopback HTTP 取） |
| `config.get` | schema-only（SDK `config.get()` 返回 `any`，无命名 DTO） |
| `scheduler.status` | schema-only（tags: internal） |

即 **4/8 op 有编译期断言**（`providers.list` 贡献 3 条：item + 信封两键），共新增 **6 个 `CHECK_*` 常量**：`CHECK_agents_list_item`、`CHECK_providers_list_item`、
`CHECK_providers_list_connected`、`CHECK_providers_list_default`、`CHECK_mcp_servers_item`、
`CHECK_plugins_list`；其余 4 个 op 是 schema-only。

SDK DTO **零改动**（4 个 DTO 已与 handler wire 一致，AssertEq 一次通过）。负向探针实测：
把 `CHECK_agents_list_item` 改成 `AssertEq<GenAgentItem, { id: string }>` → tsc 报
`["MISMATCH", 生成形状, 手写形状]`，断言不是空转（已还原）。

## 生成物 diff 审计

`emit:openapi` → `318 routes → 284 paths / 318 operations`；`gen:api` → `284 paths / 318 operations
（overrides 命中 12）`。

| 产物 | ops | paths | added | removed | changed |
|---|---|---|---|---|---|
| `contract/gateway-paths.json` | 318 → 318 | 284 → 284 | **0** | **0** | **恰好 8 个目标 op** |
| `contract/openapi.json` | 318 → 318 | 284 → 284 | **0** | **0** | **恰好 8 个目标 op**（顶层键集不变；overrides 命中仍 12） |
| `src/api-schema.gen.ts` | — | — | — | **0** | **恰好 8 个 `operations` 块** |

（diff 行数：`gateway-paths.json` / `openapi.json` 各 `+869/−25`（25 行 = 8 个原 op 块被替换），
`api-schema.gen.ts` `+229/−8`；`npm run gen:api` 二次运行工作树无新增变化（幂等）；`merge-contract`
仍只输出 `session.list: catalog response schema wins over overrides`。）

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `2f4c3ecf`（E10d 终值） | **61 / 318** | memory 5/7、lead 2/11、pods 13/39、internal 12/73 |
| **E10e 终值** | **69 / 318（21.7%）** | +8（`agents` +1 / `config` +1 / `mcp` +1 / `plugins` +1 / `providers` +1 / `internal` +3），分母不变；未覆盖 **249** |

- 台账 `gateway/tests/unit/architecture/schema-coverage.test.ts` 钉住 **69 / 318**（`TOTAL_OPS` 318），
  `npm run schema:coverage` 实测 by-tag 分区和 = 69：`agents 1/1`、`config 1/2`、`internal 15/73`、
  `mcp 1/8`、`memory 5/7`、`plugins 1/12`、`providers 1/1`、`session 11/51`、`pods 13/39`、`work 1/1`。
  `skills.list` / `tools.list` / `scheduler.status` 三个 op 的 tag 是 `internal`（catalog 无独立
  skills / tools / scheduler tag），故本批在 `internal` 区贡献 +3（12/73 → 15/73）。
- **override 12 → 12**：本批不涉及；`merge-contract` 仍只输出历史的
  `session.list: catalog response schema wins over overrides`。
- 生成链不变：catalog `RouteDef.response` → `npm run emit:openapi` → SDK `npm run gen:api` →
  `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## 行为变化 / Breaking

**无。** 本批零 handler 改动、零路由增删、请求 / 响应字节不变、零 SDK 类型面改动；
变化只有 OpenAPI 文档与生成类型的**新增覆盖面**。

## 验证（worktree @ E10e-2）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7265 tests：7253 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 919 passed（922 of 923）**；**9 条失败恰好是 3 个已知 env-red suite，零 E10e 红**；589.6s（明细见下） |
| 覆盖率台账 | `npm run schema:coverage` | **69/318 operations（21.7%）**，by-tag 分区和 = 69，未覆盖 249 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 无生成物改动） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（基线 226） |
| SDK contract | `node --import tsx --require ../test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| SDK 生成幂等 | `npm run gen:api`（二次） | **幂等**（无生成物 diff；`overrides 命中 12`） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3855 tests / 735 suites：3854 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/view_dto_test.dart test/vocabulary_parity_test.dart --concurrency=1` | **15 / 15 passed** |
| mobile analyzer | `dart analyze lib test` | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（全仓同；本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 919 passed, 922 of 923 total
Tests:       9 failed, 3 skipped, 7253 passed, 7265 total
Snapshots:   0 total
Time:        589.63 s
```

失败 suite 恰好三个已知 env-red：`tests/integration/plugin-package-e2e.test.ts`、
`tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
（同一根因：esbuild 解析不到 `@anthropic-ai/claude-agent-sdk`），零 E10e 红。

## 新增测试（对基线 `2f4c3ecf` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+8** | `tests/unit/api-contract.test.ts` E10e-1 describe：8 个 op 逐条 schema 属性 / 数组元素必填 / 封闭词表 / 边界对象 / `Value.Check` 线样（含反向用例：未知 agent source / models 非数组 / 非法 mcp status / 非法 plugin type / 未知 skill status / 缺 description / 缺 section / section 非对象 / plan 缺键 / 404 error body） |
| SDK | **0 运行时 / +6 编译期** | `contract-compat.checks.ts` 新增 6 个 `CHECK_*`（`AssertEq` 是编译期检查，`npm test` 仍 226） |
| desktop | 0 | 无代码变更 |
| mobile | 0 | 无代码变更 |
| **合计** | **+8** | 可执行 test case 数（非断言数） |

- commit 内 `gateway/tests` 只有两个文件改动（`git show --numstat 95f289f1`：
  `api-contract` +288/−0 / `schema-coverage` +11/−3 行），无删除用例。
- gateway 全量 **7265** = E10d 收口口径 **7256** + 基线新增 `b30ab0d1`（`fix(goal): make llm goal eval
  advisory`，经 merge `6cecf9cb` 带入；+1 用例）+ E10e-1 新增 **8**。

## 已知红（非本波代码问题）

1. **gateway env-red**：`tests/integration/plugin-package-e2e.test.ts`、
   `tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
   ——esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk`；与 E10d 基线同集合
   （**9 条 / 3 suites，0 新增**）。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到 `null`。
3. **desktop 类型 `node:tls` 2 条**：`@types/node` 比运行时 `node:tls` 旧，既有噪声。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。

## Deferred（E10e 后仍保留）

- 剩余约 **249** 个 op 的 response schema 覆盖（69/318，21.7%；继续按同族读接口 7–8 ops/批推进）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema；错误体仍不建模（`memory.get` 404 / `scheduler.status` 404
  只在测试里反向断言）。
- 强制版本协商 / SDK 全量 schema 类型化。
- TUI / mobile 的 triage phantom 字段渲染（`reason` / `goalId` / `severity`；真实 wire 只有
  `summary` / `source` / `state` / `proposedGoal`）。
- **`memory.get` 的 HarmonicUnit 手工镜像漂移风险**（E10c 遗留）：`HarmonicUnitSchema` 镜像
  `core/memory/harmonic-types.ts`，没有 gateway 侧 `AssertEq` 桥 → 新增 harmonic 字段不会打红任何测试。
- **note-board budget 的 `perNoteCap` 未建模**（E10c `recall.pinned` / E10d `memory.listSticky` 同一选择）。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- 后续候选：`automations.list` / `automations.get` / `automations.history`（下一批，含 override 转 code-first）、
  `plugins.client`、`runtime.get`。
