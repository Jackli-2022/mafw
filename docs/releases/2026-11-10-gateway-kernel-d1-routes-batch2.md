# 2026-11-10 · Gateway 内核 D1 路由迁移（batch 2）

- **分支**：`feat/gateway-kernel-d1-batch2`（base `ed2e998e`）
- **前序 wave**：`21cca30a`（Tasks 1-3e：19 分支 / 9 个域，guard 135 → 116）
- **计划**：`docs/superpowers/plans/2026-11-10-gateway-kernel-d1-routes.md`
- **设计**：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md` §5.2
- **过程记录**：`.superpowers/sdd/2026-11-10-gateway-kernel-d1-routes/`（`progress.md` 台账、
  `task-{A..H2,9}-report.md`、`review-*.diff` / `rereview-*.diff`）

## 交付内容

- **legacy if 链 116 → 24**（10 match + 14 equals）。D1 结束态只剩三类残量：
  transport/静态/MCP/根路径（11 组，D3 归 `http-router.ts`）、dashboard 兜底（裁决 R5）、
  `/api/goals/control` 死臂（裁决 R6）。
- **路由模块**：`gateway/src/routes/` 38 个模块 / 40 个 `attach*` 入口 → `RouteRegistry`，
  共 208 个 handler；catalog 278 条 `operationId`。handler 体逐字搬迁（状态码 / 响应形状 /
  fail-open / 200-not-404 miss / 405-else 臂全保留），`this.x` 一律改 live getter。
- **`index.ts` 10098 → 8204 行**（−1894 / −18.8%），减的全是分支体；tombstone 注释留在原位。
- **新增 catalog 条目**：`automations.get`（NON_SDK/internal，SDK 无单条 GET）、
  `recall.instructions`、`recall.priors`（NON_SDK/internal）、`session.subagents.*` ×5
  （spawn / list / message / cancel / result，NON_SDK/internal）。
- **catalog 修正**：`session.queue.*` 的影子条目原为 `{id}` / `{itemId}` 路径模板——
  `RouteRegistry.match` 把 `{…}` 当字面量，那 3 个 op 本是**不可达影子**；规范化为
  `:id` / `:itemId` 后才接线（否则迁移后 3 个 queue 端点全部 404）。
- **测试守卫**：`tests/unit/architecture/legacy-route-inventory.test.ts` 钉死结束态
  （24 / 10+14、14 个 group 计数、31 个已迁空前缀），并新增 U+ 级注释说明残量归属。

## 本波提交（按批次；不含骑乘的 foreign 提交）

| 批次 | commits | 内容 | guard | 定向测试 |
|---|---|---|---|---|
| A1-A5 | `fab643ac` `8f0c3c2e` `0ed9881a` `7756f349` `f775685e` | projects / mafw-commands / merge-memory / triage / approvals | 116 → 103 | 398 |
| B1-B4 + fix | `a9bfd8ad` `ed3a6ec0` `fae87b11` `17e7fbfc` `3b52e3df` | questions+permissions / usage / recall 三薄条 / recall/context | 103 → 92 | 43 suites / 295 |
| C1-C4 | `6f952bb9` `a792d1d3` `cdddb246` `cf825a0c` | automations / chat / obs / media resolve-task | 92 → 84 | 47 suites / 323 |
| D1 + fix | `20ce16ee` `e67a4649` | sessions core（10 分支） | 84 → 74 | 全量 693 suites / 5451 |
| E1-E2 | `f7af4f82` `33a512a3` | sessions 读模型（5）+ permissions/subagents（7） | 74 → 63 | 50 suites / 359 + 扫描器 13/114 |
| F1-F2 + fix | `00969f43` `6406da38` `cb4366f8` | memory inline（9）+ goals inline（7 op） | 63 → 48 | 52 suites / 382 |
| G | `cd248558` | dashboard 影子条（4 条接线，ZERO 删除，R5） | 48（不变） | wiring 全绿 |
| H1 | `a279f8f5` | long-tail singles（voice/presence/eval/config/orchestration/provider/agents/media-plugins + llm.compress） | 48 → 37 | 57 suites / 421 + 扫描器 18/142 |
| H2 + fix | `3f047a6f` `4da9ef33` | devices/mobile 配对/pods events/mcp 管理/manager session/events SSE（15 分支） | 37 → 24 | 64 suites / 469；fix round 219 suites / 1897 |
| 9 | 本提交 | 结束态 guard 钉扎 + `gateway.md` 现状段 + 本记录 | 24（不变） | 见「门禁」 |

同分支上另有 **foreign 骑乘提交**（Lead/TechLead P0 与 serve/文档工作，不属于本波）：
`d50f4f18`（merge）、`6bee9da0`、`6c5ef817`、`a0f64054`、`8aeac927`、`137e438e`、
`3f79446f`（重锚 D1 后的 permissions/agents 源码守卫）、`06f395d8`、`e52ffc4a`、
`4d504f2f`、`c9359f93`。

## 裁决（R1-R10）

- **R1**：`/health` 与全部 transport 分支归 D3（guard 早已钉住），D1 只清 api 面。
- **R2**：`$` 锚定的 legacy 正则迁入 registry 后对 query string 不敏感（registry 先剥 `?`），
  尾斜杠同理；已知无客户端依赖 fall-through。**R2-extend**：registry 路径段已
  `decodeURIComponent`，参数路由的 id 单次解码语义整体前移（malformed `%` → 500 而非 404）。
- **R3**：手写 `req.on('data')` reader 统一换 `readRouteBody`（socket error → 500，不再挂住）。
- **R4**：`session.deleteLegacy`（`/api/session/:id`）与 `session.delete`（`/api/sessions/:id`）
  清理集合不同——两者分别逐字迁移，**不合并**（unification 是后续工作）。
- **R5**：dashboard 联合分支（`/api/goals|/api/stats|/api/memory`）+ `handleDashboardAPI`
  作为 catch-all 保留；只把 4 个明确影子条目接 registry-first（goals.list / dashboard.stats /
  memory.add / memory.setSticky），其余路径行为不变。
- **R6**：`POST /api/goals/control` 是死代码（自 `cdf678db2` 起被 dashboard 兜底遮蔽）——
  D1 不修，按潜在 bug 记录。
- **R7**：subagents 5 条分支补新建 SDK catalog 条目 + 两步 emit（它们经 `mafw_spawn_subagent`
  工具面调用）。
- **R8**：questions ×3 + permissions list + permission reply + usage ×2（7 条 session 邻接分支）
  随 B 批迁移。
- **R9**：analyzer 盲区（`manager/session` GET 无 `?.`、`/api/events` SSE、
  `matchRuntimeConfigRoute`）不在 guard 116 内——D1 照迁但不减计数，列给 D3。
- **R10**：`session.command` / `session.metrics` 是 catalog 幽灵（无任何实现），原样保留。

## 门禁

- `node scripts/analyze-routes.cjs` → **TOTAL 24（match 10, equals 14）**：
  `/api/memory` 4、`/api/goals` 3、`/api/stats` 2、`/mcp` 2、`/` 2、`/index.html` 2、
  `/health` 2、`/a2a` 1、`/.well-known` 1、`/a` 1、`/assets` 1、`/static` 1、`/register` 1、
  `/control` 1。
- `npx jest tests/unit/architecture/legacy-route-inventory.test.ts` → **6/6**。
- `npx tsc --noEmit -p tsconfig.json`（gateway）→ **rc=0**。
- gateway 全量 `npx jest --no-coverage --forceExit` → **714 suites / 5607 tests：5604 pass / 3 fail**。
  3 个失败全部是真实 git fixture 的 5s 超时（`tests/unit/checkpoint/restore-git.test.ts` ×1、
  `tests/unit/pod/pod-worktree-service.test.ts` ×2），与 D1 无关（本波只动 guard 测试与文档）；
  单独重跑这两个文件 → **2 suites / 23 tests 全绿**（负载导致的超时，非代码回归）。
- SDK 契约（`packages/gateway-sdk`，`node --import tsx --require packages/test-shim/require-hook.cjs
  --test src/contract.test.ts`）→ **4/4**（无死契约、无漂移）。
- 提交态无源码扫描器红灯：H2 报告里两个只在工作树修复的扫描器
  （`runtime/agents-list`、`runtime/architecture-boundaries`）已由骑乘提交 `3f79446f` 落库，全量绿。

## 已知残留与后续

- **D3 收口**：transport/静态/MCP/根路径 11 组 + dashboard 兜底 + `/api/goals/control` 死臂
  → `http-router.ts`（auth → registry → 404）；R9 的 analyzer 盲区一并处理。
- **R6 潜在 bug**：`/api/goals/control` 永远到不了自己的实现（被 dashboard 兜底拦截）。
- **Minor backlog**：每批 review 的 minor（`M-A1..M-H2`）集中记在 `progress.md`，主要有——
  `session.queue.*` 的 `{id}` 类 catalog 模板复检、SDK internal 豁免只到 path 级不到 method 级、
  `readRouteBody` 之外的手写 reader 残留、部分 wiring 测试只做冒烟覆盖。
- **解码语义**：R2/R2-extend 的 query/尾斜杠/percent-编码行为变化已在各批 report 逐条记录，
  客户端侧无需改动。
