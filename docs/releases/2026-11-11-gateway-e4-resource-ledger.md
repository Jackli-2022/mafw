# Gateway E4 资源台账交付记录（2026-11-11）

## 波次

- 分支：`feat/gateway-e4-resource-ledger`（worktree `.superpowers/e4-worktree`）
- 基线：`26859938`（main，E3 合并后；分支创建时点）
- 范围：E4-1..E4-8 资源台账 8 项 + 收口 E4-9
- spec：`docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md`
- plan：`docs/superpowers/plans/2026-11-11-gateway-e4-resource-ledger.md`
- 架构现状：`docs/architecture/gateway.md` §「E4 资源台账（2026-11-11）」
- TDD：每个 provider 先写失败测试（注入 statfs / memoryUsage / 时钟 / 假 socket）→ 最小实现 → 一个 commit；
  批次证据见 `.superpowers/sdd/2026-11-11-gateway-e4-resource-ledger/batch{4,5,6}-report.md`
  （batch 1–3 的记录汇总在同目录 `progress.md`）

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `8ece14eb` | E4-1 | `config.resources` + `core/timer-service.ts` + `resources/` 命名整理（`sdk-session` → `runtime/`） |
| `a8bc4359` | E4-2/E4-3 | `sampleDisk` / `sampleHeap` / `ResourceGovernor`（阈值 + 回滞 + fail-open） |
| `09b14a32` | batch1 review | 上限归一化单点（`limitOf` / `resolveCap`）+ governor 生命周期硬化 |
| `ebb568ed` | E4-4/E4-5 | `ConnectionTable` + SSE/WS 有界出站缓冲 + 准入拒绝路径 |
| `7dc140fa` | batch2 review | 关闭 SSE/WS 准入泄漏 + `BufferCounters` 聚合口径 |
| `107ce28b` | E4-6/E4-7 | `ProcessLedger` + `QuotaService` + SessionKernels 并发帽 + `/register`/session 429 |
| `452d8770` | batch3 follow-up | busy 内核保护、陈旧 sidecar 释放、quota 快照与判定对齐 |
| `3166f77a` | E4-8 | `/api/kernel/stats` + schema + kernel 组装（governor/连接/缓冲/配额/timer/serve） |
| `9603b25f` | E4-6a | 长驻 timer 迁移（ws/sse/python）+ stats 契约硬化 + SDK 死契约 TODO（review-items） |
| `c6e1cf3f` | E4-6b | 压力降级接线：scheduler / `memory.add` 200 `disk_low` / backfill 503 / event_log 边沿裁剪 |
| `d768d4b1` | batch6 review | universal admission seam（`admissionChecker`，submit-time）+ `shouldPruneEventLog` 边沿修正 |
| `b8e664c1` | final review | `disk.error` 只留机器码、python/llamacpp 台账 `owned:true`、quota limit 取整、plugin-web writer 异常释放连接租约 |
| 本 commit | E4-9 docs sync | final review 后的架构/spec/release 同步 |

## 交付项

- **E4-1**：`config.resources`（采样间隔 / 磁盘·堆阈值 / 连接·进程·配额上限 / 缓冲上限，深合并默认值）；
  命名 `TimerService`（同名冲突抛错、默认 unref、`clear` 幂等、`disposeAll`），`resources/` 只放台账。
- **E4-2**：磁盘 `statfs` 采样数据根，warn 2 GiB / critical 512 MiB，30s 一次 + 启动立即采样；
  critical→warn 回滞 1.5×、warn→ok 1.1×，`statfs` 失败 → `unknown` fail-open；
  失败时 `disk.error` 只上报机器码（`err.code`，如 `ENOENT`；否则 `'statfs_failed'`）。
- **E4-3**：堆 `memoryUsage` + `heap_size_limit`，warn 0.75 / critical 0.9，回滞 ±0.05；
  与磁盘共用 `governor:sample`，采样异常保留上一份样本。
- **E4-4**：`ConnectionTable`：HTTP `maxConnections` 256 硬帽 + 观测计数；SSE/WS 各 64、voice/terminal 各 16
  软帽；lease 幂等，`refused` 按 kind 计数，`0` = 不限。
- **E4-5**：SSE 有界出站队列（256 帧 / 1 MiB，`drain` 顺序冲刷，越界 destroy + overflow 计数）；
  WS 广播前检查 `bufferedAmount`（1 MiB）→ terminate；计数聚合进平铺 `buffers`。
- **E4-6**：`ProcessLedger`：python 会话逻辑槽位（`owned:true`，帽 4，空闲 >10min 可驱逐，busy 永不驱逐，仍满 429）、
  llamacpp 真实 child pid（`owned:true`）、serve 仅在实例存在时记一条 `owned:false` 逻辑条目。
- **E4-7**：项目 128 / 会话 1000 / 单项目会话记录 200；超限 429
  `{code:'quota_exceeded', resource, limit, current}`；同目录重复注册放行。
- **E4-8**：`GET /api/kernel/stats`（internal，catalog `kernel.stats` + 200 schema）：
  pressure/disk/heap/connections/buffers/timers/processes/quotas/handles/scheduler/events/serve；
  provider 缺席 fail-open，只有 provider 自身抛错才 500。

## 行为变化 / Breaking

1. **新增拒绝路径**（正常路径响应形状不变）：
   - 项目/会话/python 内核配额超限 → **429** `{error, code:'quota_exceeded', resource, limit, current}`；
   - SSE 超限 → 503 `{error:'too many sse connections', code:'connection_limit'}`；
     WS/voice/terminal 超限 → upgrade 阶段 503（不升级）；
   - 磁盘 critical 时 `POST /api/memory/add` → 既有 200 壳
     `{success:false, error:'disk space critical', code:'disk_low'}`（不写盘）；
     `POST /api/memory/embeddings/backfill` → 503 `{error, code:'disk_low'}`。
2. **配额 limit 归一化**：`check().limit` 与 `snapshot().limit` 统一为有限且 `>= 0` 的**整数**，
   负数/非有限配置一律输出 `0`（= 不限），有限正值向下取整（12.5 → 12；0.5 → 0）以保证 wire
   值与 `limitOf` 的执行值一致。此前 `check()` 会把原始负数（如 `-1`）或小数透出；
   判定逻辑（`limitOf`）未改。
3. **盘面错误不再回传原始 message**：`disk.error` 只放机器码（`err.code`，如 `ENOENT`；
   缺失时 `'statfs_failed'`），避免 `/api/kernel/stats` 泄露数据根路径。
4. **进程所有权**：python kernel 与 llamacpp sidecar 的台账条目为 `owned:true`（gateway 亲手
   spawn 并托管关闭）；serve 逻辑条目仍为 `owned:false`。
5. **SDK 死契约 TODO allowlist（非 E4 API 变更）**：`pods.goals.reviewItems{,.create,.resolve,.reopen}`
   4 个 op 来自前序 review-items 波次（`163b2001`），一直缺 SDK client/DTO；E4 重生成契约产物时
   暴露为 3/4 红。E4 在 `packages/gateway-sdk/src/contract.test.ts` 记入 `DEAD_CONTRACT_TODO`
   （含"仍存在于 contract"的陈旧守卫），**不新增 SDK 方法、不改这些 op 的 catalog 语义**。
   契约产物：E3 304 ops → **276 paths / 309 operations**（+`kernel.stats` +4 review-items），
   `emit:openapi` / `merge-contract.mjs` 重跑无 diff。
4. **serve 台账口径**：serve 逻辑条目只在 `serveInstance` 真存在时登记（能力存在 ≠ 进程存在），
   `owned:false` 且无 close 钩子；`serve.running` 就是 `!!serveInstance`（不额外探测进程存活），
   `serve.owned` 表示 gateway 是否亲手 spawn 了该 serve（`serveOwned`；受管启动为 `true`，
   external/adopted 为 `false`），不得用 `processes.entries[].owned` 推导。
5. **Additive**：`config.resources`、`GET /api/kernel/stats`、连接/缓冲/配额计数、可选错误 `code`。
   `/api/stats` 原样保留；无数据库 schema 变更（event_log 只新增 `pruneNow`，不改表）。

## 验证（worktree @ E4-9 文档改动后）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `node node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **6574 tests：6563 passed / 10 failed / 1 skipped**；**847 suites：842 passed / 4 failed / 1 skipped**（3 个 env-red + 1 个基线红，见下） |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **214/214 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **5/5 passed** |
| desktop | `npm run test:desktop`（worktree root） | **3302 tests：3301 passed / 1 failed**（690 suites；env-red resolver） |
| TUI | `npm run test:tui` | **309 tests：308 passed / 0 failed / 1 skipped**（2 suites） |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `jest tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（`gateway/`）+ `node scripts/merge-contract.mjs`（SDK） | **无 diff**（276 paths / 309 operations） |

新增 gateway 测试：**净增 +271**（E3 收口基线 6303 → 本波终值 **6574**，+32 suites；终审修复轮
+1 plugin-web 租约用例，其余为断言替换/收紧）。
其中包含 main 在 E3 之后带入的 pod/review-items 波次测试；E4 自身新增 37 个测试文件的改动
（+4857 行）覆盖：config/TimerService、disk/heap/governor、连接表、有界缓冲、进程台账/配额、
stats + route schema、`admissionChecker` 与降级/prune 接线。desktop/TUI 本波零代码改动，
数字为当前基线（desktop 较 E3 的 3289 增长来自其它波次，非 E4）。

## 已知红（非本波代码问题）

> 1–3 为 E3 起就存在的环境红（与 E3 基线一致）；4 为 E4 基线（`26859938`）即存在的测试期望漂移。

1. `tests/unit/runtime/claude-adapter-acceptance.test.ts` +
   `claude-adapter-coverage.test.ts`：`adapters/claude` esbuild 无法解析
   `@anthropic-ai/claude-agent-sdk`（共享 node_modules junction 缺包）。
2. `tests/integration/plugin-package-e2e.test.ts`：模拟 Desktop node_modules 的
   `@mafw/plugin-contract` staging 失败（依赖/构建环境）。
3. desktop `src/main/mafw-gateway-resolver.test.ts` "resolves dev path relative to
   module location"：worktree 无 `gateway/dist`（未构建）→ 解析 null；本波零改动。
4. **基线红（非 E4 改动）**：`tests/unit/pod/pod-accept-route.test.ts` "accepts a confirmed human
   request and returns the merge result" —— 期望 `acceptResult` 只收 `{revision}`，实际 route
   已传 `{revision, force:false, riskAcknowledged:false}`。`gateway/src/routes/pods.ts` 与
   测试文件自 E4 基线 `26859938` 起均未改动（`git diff 26859938..HEAD` 为空），来自 main 侧
   pod 验收波次的测试期望漂移；E4 未触碰该路径。

## Deferred（明确不在 E4 范围）

- **已入队任务的降级行为**：admission 是 submit-time only，降级前已入队的任务仍会启动；
  不做回撤/抢占，恢复后也不补跑被拒任务（若需要可在 pump 处二次校验）。
- **MCP 磁盘门**：`mafw_add_memory` 有意绕过 HTTP `disk_low` 门（spec §4.2 只覆盖 HTTP 面）。
- **全进程 timer inventory**：只迁移 4 类长驻 interval + governor 采样；
  kernel 的 serve watchdog/heartbeat/queue-sweep/session-sweep/discovery-heartbeat 与插件 loader 仍在本地。
- **插件/manager 会话配额副作用**：内部会话（manager/lead）失败按既有 catch 降级为 log；
  未给 UI 明确 429 文案，也未审计插件创建的会话是否应占用项目配额。
- **review-items SDK 债务**：4 个 `pods.goals.reviewItems*` op 需补 SDK client + DTO（或显式降级 internal），
  当前只在 `DEAD_CONTRACT_TODO` 记账；陈旧守卫只能发现 op 从契约消失。
- **worktree-before-quota 孤儿**：带 worktree 的 `POST /api/session` 先创建 worktree/branch，
  再进入 session/sessionRecordsPerProject 配额检查；被 429 拒绝时已创建的 worktree 与分支
  不会回收。修法需要在 `createSessionWithWorktree` 加入失败回滚（remove worktree/branch），留后续。
- 其余 op 的 response schema 覆盖（E4 只给 `kernel.stats` 加了 200 schema）。
