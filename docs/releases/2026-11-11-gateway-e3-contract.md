# Gateway E3 契约硬化交付记录（2026-11-11）

## 波次

- 分支：`feat/gateway-e3-contract-hardening`（worktree `.superpowers/e3-worktree`）
- 基线：`4a9592c2`（main，E1/E2 合并后）
- 范围：E3 七项——可达性守卫 + 幽灵清理（A7）、Mode B 删除（B7）、框架错误码（B6）、
  Experience 动作绑定（B8）、opt-in 版本握手（B5）、4 个读接口 schema（B9）、收口
- spec：`docs/superpowers/specs/2026-11-11-gateway-e3-contract-hardening-design.md`
- plan：`docs/superpowers/plans/2026-11-11-gateway-e3-contract.md`
- 架构现状：`docs/architecture/gateway.md` §「E3 契约硬化（2026-11-11）」
- TDD：每项先写失败测试并按预期失败 → 最小实现 → 一个 commit；证据见
  `.superpowers/sdd/2026-11-11-gateway-e3-contract/batch{1,2,3,4}-report.md`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `9823e619` | E3-1 | 可达性守卫替换幻影源码断言；删除 12 个幽灵 op + 死 dashboard 模块 |
| `d1252e47` | E3-2 | 删除 Mode B（per-session SSE）；`?sessionID` 降级为 Mode A；SDK `subscribeToSession` 删除 |
| `0441f925` | E3-4 | Experience 动作 → catalog `operationId` 绑定（20 动作） |
| `5dd0e31e` | E3-3 | 框架边界错误加 `code`（transport 401/403/500、registry 401、capGuard 503） |
| `79be3e2c` | E3-5 | opt-in `X-MAFW-Schema-Epoch` 握手；主动错配 → 409 `schema_epoch_mismatch` |
| `8176ed1b` | E3-6 | 4 个读 op 的 200 response schema（goals.get / project.list / presence.get / session.usageSummary） |
| `07305725` | E3-4 fix | terminal 投影期望同步 `operationId`（全量门禁暴露的遗漏断言） |
| 本 commit | E3-7 | 架构现状 + 本记录 + 全量门禁 |

## Breaking / 契约变化

1. **SDK `event.subscribeToSession` 删除**（Mode B 死面）。`event.url(sessionID?)` 与
   `sessions.events()` 仍保留并构造 `?sessionID`，但服务端现在忽略该参数、返回 Mode A
   全局流（旧调用不 404/不挂起）。
2. **14 个 catalog op 删除**：`dashboard.costs`、`dashboard.alignment`、
   `dashboard.userAnswer`、`feedback.record`、`session.metrics`、`health.check`、
   `gateway.pause`、`gateway.resume`、`gateway.cancel`、`gateway.checkpoint`、
   `gateway.rollback`、**`memory.getL5Heuristics`**（唯一实现只在死模块
   `dashboard/api.ts`；`/api/l5/axioms` 已同时返回 axioms + heuristics），以及收口
   修复轮删除的 **`goals.loops` / `goals.loopsAt`**（dashboard catch-all 实际返回
   goals 列表，形状不对；请求仍由 catch-all 兜底）。这些 op 从未出现在 SDK 客户端
   调用面，只存在于生成的 schema；`openapi.json` 318 → **304 ops**。
3. **死模块 `gateway/src/dashboard/{api,server,types}.ts` 删除**（`DashboardServer` 从未
   实例化）。`gateway/src/dashboard/public/` **保留**：SPA 仍由 transport 的 `spaRoot()`
   服务且被 build 脚本复制，删除会破坏 `/` 与 `/index.html`。
4. **`/api/events?sessionID=x` 语义变化**：从 per-session Mode B 流改为 Mode A 全局流
   （参数被忽略）。仓库内零 Mode B 消费方；外部若有依赖该流的客户端需迁移。
5. **Additive**：框架错误 `{error, code, retryable?}`；响应头
   `X-MAFW-Schema-Epoch`；`ActionDescriptor.operationId`；4 个读 op 的 response schema。
   正常路径响应体不变（错误字符串逐字保留）。

## 逐项要点

- **E3-1**：`tests/unit/api-contract.test.ts` 数据驱动守卫：catalog × attach 扫描
  （字面 `attachHandler('id')`、`for (const op of [...])`/命名数组、`attachTypedRoute`
  的 `operationId`）× 三类 allowlist（transport 9 / dashboard residue 2 / runtime proxy 1，
  每项带 reason）。allowlist 条目必须存在于 catalog、唯一、未被 attach（只减不增）。
  RED 暴露 12 个不可达 op（11 个 spec 幽灵 + `memory.getL5Heuristics`）。
- **E3-2**：`events-sse.ts` 单分支化；`event-dispatch` 24 → 23 段（`modeBDelta` 删除）；
  kernel/api-routes 的 `chatSessions` 接线全部移除；`chat/chat-sessions.ts` 删除。
- **E3-3**：`core/http/api-error.ts` 的 `API_ERROR_CODES` / `errorBody()`；应用点仅框架
  边界（transport 401 / 3×403 / outer 500、registry-dispatch 401、kernel
  `capGuard` + `capGuardQuestion` 503）。路由内业务错误信封不变。
- **E3-4**：`EXPERIENCE_ACTION_OPERATIONS` 20 条映射；复合动作取入口路由
  （`run.control → session.suspend`、`background.jobs → background.jobs.list`、
  `mcp.manage → mcp.servers`、`approval.* → *.reply` 等）。无路由动作省略字段。
- **E3-5**：`TransportDeps.schemaEpoch`（kernel 接 `releaseMetadata?.schemaEpoch`）；
  header 在 CORS 之后、OPTIONS/auth 之前写出；校验在 auth 之后、registry 之前，
  仅当客户端**主动携带**且不匹配时 409。
- **E3-6**：`routes/schemas/read-models.ts`（TypeBox）；catalog 挂 `response:`；
  `emit:openapi` → `merge-contract.mjs` → `openapi-typescript 7.13.0` 重新生成
  `api-schema.gen.ts`。四个 op 的 200 schema property 数：goals.get 8 / project.list 1 /
  presence.get 3 / session.usageSummary 4。

## 收口修复轮（2026-11-11，final review）

- **SDK 类型门**：`Goal` DTO 对齐 `projectGoalView`（`phase: string | null`、
  `error: string | null`、`updatedAt: string | null`、`currentWave/totalWaves` 必填）；
  `goals.list` override 同步该形状，删除陈旧的 `goals.get` override（catalog 现在是
  唯一来源）。`CHECK_goals_list` / `CHECK_goals_get` 均对齐真实 DTO，SDK
  `tsc --noEmit -p tsconfig.json` 回到 **0 errors**。
- **dashboard-residue 诚实化**：删除 `goals.loops` / `goals.loopsAt` 两个 catalog 误登记
  （无 handler，catch-all 返回列表形状）；`DASHBOARD_RESIDUE_ALLOWLIST` 清空。运行行为
  不变（请求仍落 `/api/goals*` catch-all）。catalog/emission 306 → **304 ops**、
  274 → **272 paths**。
- **文档漂移**：`docs/architecture/gateway.md` 的 24 段 stage / 26 成员 DispatchCtx
  → **23 段 / 25 成员**（历史 D2 表述标注来源），kernel 注释同步；runtime-plugin-authoring
  skill 的 Mode B 描述改为「已删除，per-session 客户端走 Mode A + sessionID 过滤」。

### 修复轮门禁

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `jest --no-coverage --forceExit --runInBand` | **6303 tests：6293 passed / 9 failed / 1 skipped**；**815 suites：811 passed / 3 failed / 1 skipped**（同上 3 个 env-red） |
| 契约/架构/http | `jest tests/unit/api-contract.test.ts tests/unit/architecture/ tests/unit/http/` | **8 suites / 60 tests passed** |
| SDK 类型 | `tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors**（修复目标） |
| SDK 全量 | `node --import tsx ... --test "src/*.test.ts"` | **213/213 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **4/4 passed** |
| desktop | `npm run test:desktop` | **3289 tests：3288 passed / 1 failed**（同一 env-red resolver） |

## 验证（worktree @ E3-7 文档改动前）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `node node_modules/jest/bin/jest.js --no-coverage --forceExit --runInBand`（`gateway/`） | **6302 tests：6292 passed / 9 failed / 1 skipped**；**815 suites：811 passed / 3 failed / 1 skipped**（3 个均为 env-red，见下） |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"`（`packages/gateway-sdk`） | **213/213 passed**（较 E2 的 214 少 1：删除 `subscribeToSession` 用例） |
| SDK contract | 同上 `--test src/contract.test.ts` | **4/4 passed** |
| desktop | `npm run test:desktop`（repo root） | **3289 tests：3288 passed / 1 failed**（env-red resolver）；688 suites |
| TUI | `npm run test:tui` | **309 tests：308 passed / 0 failed / 1 skipped** |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `jest tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |

新增 gateway 测试（净增 **+20**，与 E2 的 6282 → 6302 一致）：E3-1 守卫重写净 +2、
E3-2 行为测试 +3、E3-4 绑定 +4、E3-3 错误码 +5、E3-5 握手 +5、E3-6 schema +1。
desktop/TUI 本波零代码改动（数字为当前基线）。

## 已知环境红（非本波代码问题；基线同样红）

1. `tests/unit/runtime/claude-adapter-acceptance.test.ts` +
   `claude-adapter-coverage.test.ts`：`adapters/claude` esbuild 无法解析
   `@anthropic-ai/claude-agent-sdk`（共享 node_modules junction 缺包）。
2. `tests/integration/plugin-package-e2e.test.ts`：模拟 Desktop node_modules 的
   `@mafw/plugin-contract` staging 失败（依赖/构建环境）。
3. desktop `src/main/mafw-gateway-resolver.test.ts` "resolves dev path relative to
   module location"：worktree 无 `gateway/dist`（未构建）→ 解析 null；本波零改动。

## Deferred（明确不在 E3 范围）

- **dashboard 兜底本身**：`subsystems/dashboard-legacy.ts` 的 `/api/goals*` catch-all
  仍在（R5）；`goals.loops` / `goals.loopsAt` 的 catalog 误登记已在修复轮删除，但
  未迁 registry handler。
- **SDK Mode B 残留面**：`sessions.events()` 与 `event.url(sessionID?)` 仍构造
  `?sessionID`（现降级为全局流）；死面清理留后续波次。
- **response schema 覆盖**：其余 ~300 ops 仍无 200 schema（E3-6 只建立机制 + 4 个读接口）。
- **强制版本协商**：E3-5 只在客户端主动携带 epoch 时校验；SDK/desktop 尚未主动发送。
- **错误码全量**：路由内业务错误继续用原信封（错误格式按层收敛是长期策略）。
