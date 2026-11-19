# Recall Foreground Isolation and Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 snapshot/index-scan 在边界 recall 进行中启动，并把真实 session 的 dense、首轮 graph-aware search、expansion、scan merge 成本分别暴露出来。

**Architecture:** scheduler 增加供 HTTP handler 使用的外部前台作用域；IndexScanService 通过注入回调复用同一 scheduler 和 `snapshot` 互斥键，保持旧调用方兼容。search 内部用可选 observer 报告子阶段，新增只读 metrics route 投影现有有界聚合，不在热路径增加 I/O。

**Tech Stack:** TypeScript、Node HTTP、现有 Scheduler、Jest、TypeBox route catalog。

**Spec:** `docs/research/2026-11-19-recall-next-bottleneck.md` §8；用户要求质量门不退让、执行交给 `gateway/volcengine/deepseek-v4.1-flash` 子代理。

## Global Constraints

- 主 checkout 实施；不建 worktree/分支、不 push、不覆盖其他会话未提交改动。
- 不改 FOK、lexical veto、snapshot containment/当前轮质量门、固定 40 条期望或响应 `pointers` 形状。
- 已运行的后台任务不可抢占；本切片只保证其后的 defer-to-idle 工作不在 recall 前台作用域内启动。
- scheduler/metrics/observer 故障不得改变召回结果；scan 调度失败时跳过可选 prefetch，回退既有 BM25，不在前台立即补跑。
- 不在 `recall.context` 中等待 scan；scan prefetch 仍异步，60s per-session throttle 和旧 snapshot 语义不变。
- 子代理不 commit/build/restart、不跑全量 suite、不派生子代理、不调用记忆工具；父会话统一 review、验证与部署。
- 当前共享工作树已有 adapter 与调研文档改动；只允许触碰本任务列出的文件。

## Review Focus

- 嵌套/重复 release 不得让 `foregroundInFlight` 变负或提前放行 → Task 1 作用域测试。
- 空 query、成功、异常、snapshot serve 都必须释放前台作用域 → Task 1 route 测试。
- scan 被 scheduler 排队时不得先执行 HTTP；调度拒绝不得产生 unhandled rejection → Task 2 测试。
- observer 抛错不得改变逐 id/score 的检索结果；未传 observer 的其他调用方保持原行为 → Task 3 测试。
- metrics endpoint 必须返回新鲜副本和全部 stage，不得暴露可变内部 ring → Task 3 route/schema 测试。
- 新 route catalog 必须重新生成契约产物，不能手改生成文件 → Task 3 验证步骤。

---

### Task 1: External foreground scope for boundary recall

**Files:**
- Modify: `gateway/src/scheduler/scheduler.ts`
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/subsystems/api-routes.ts`
- Modify: `gateway/src/kernel.ts`（仅 `apiRouteDeps` 增加 live scheduler getter）
- Test: `gateway/tests/unit/scheduler/scheduler.test.ts`
- Test: `gateway/tests/unit/recall/recall-route-metrics.test.ts`

**Interfaces:**
- Produces: `Scheduler.enterForeground(): () => void`；同步增加外部前台计数，返回幂等 release，首次 release 后 decrement 并 `pump()`。
- Produces: `RecallRouteDeps.scheduler?: () => Pick<Scheduler, 'enterForeground'>`；缺省保持旧测试/调用方兼容。
- Consumes: 现有 `defer-to-idle` 的 `foregroundInFlight` 判断；不新增 task、不改变 `stats()` wire 形状。

- [ ] **Step 1: 写 scheduler 与 route 失败测试**

覆盖：外部作用域阻止 defer-to-idle 启动；嵌套作用域最外层 release 后才放行；重复 release 无效；真实 route 在 search 未完成时阻止后台任务，response/catch 后释放。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/scheduler/scheduler.test.ts tests/unit/recall/recall-route-metrics.test.ts --runInBand`
Expected: `enterForeground` 不存在或 route 未进入作用域而 FAIL。

- [ ] **Step 3: 最小实现并接线**

在 `recall.context` 的现有 `try` 前 acquire，在统一 `finally` release；不包裹/重写整个 handler。api-routes 和 kernel 只传 live getter。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/scheduler tests/unit/recall/recall-route-metrics.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS，类型门 exit 0。

### Task 2: Schedule index-scan prefetch behind foreground and snapshot mutex

**Files:**
- Modify: `gateway/src/recall/index-scan.ts`
- Modify: `gateway/src/kernel.ts`（仅 `getScanService` 注入调度回调）
- Test: `gateway/tests/unit/index-scan-http.test.ts`

**Interfaces:**
- Produces: `ScanHttpDeps.schedulePrefetch?: (sessionID: string, run: () => Promise<void>) => Promise<unknown>`。
- Consumes: Task 1 `Scheduler.enterForeground` 所形成的前台计数；现有 `Scheduler.submit`。
- Kernel descriptor 固定为 `{ id: \`index-scan:${sessionID}\`, priority: 'background', mutexKey: 'snapshot', strategy: 'defer-to-idle' }`。
- 未注入 `schedulePrefetch` 时保持旧 direct prefetch，兼容纯单元测试和独立使用方。

- [ ] **Step 1: 写失败测试**

用可控 scheduler callback 证明：调用 `prefetch` 后 HTTP 尚未运行；执行 injected `run` 后才写 snapshot；与真实 Scheduler 前台作用域组合时 release 前 fetch=0、release 后完成；调度 rejection 被吞且不影响既有 snapshot。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/index-scan-http.test.ts --runInBand`
Expected: 当前 prefetch 绕过 scheduler，新增断言 FAIL。

- [ ] **Step 3: 最小实现**

将现有 scan→setSnapshot 链封装为 `run`；有 scheduler 时只提交 `run`，无 scheduler 时直接 `void run()`；throttle 仍在 `prefetch` 调用时同步执行。kernel 与 snapshot build 共用 `mutexKey:'snapshot'`。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/index-scan-http.test.ts tests/unit/index-scan-cooldown.test.ts tests/unit/scheduler tests/unit/recall/recall-route-metrics.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS，类型门 exit 0。

### Task 3: Search sub-stage metrics and read endpoint

**Files:**
- Modify: `gateway/src/recall/recall-metrics.ts`
- Modify: `gateway/src/recall/recall-context.ts`
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/routes/schemas/recall.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Generate: `packages/gateway-sdk/contract/gateway-paths.json`
- Generate: `packages/gateway-sdk/contract/openapi.json`
- Generate: `packages/gateway-sdk/src/api-schema.gen.ts`
- Modify: `docs/architecture/memory.md`
- Modify: `docs/architecture/gateway.md`
- Test: `gateway/tests/unit/recall/recall-metrics.test.ts`
- Test: `gateway/tests/unit/recall/recall-route-metrics.test.ts`
- Create: `gateway/tests/unit/recall/recall-search-stage-metrics.test.ts`

**Interfaces:**
- Add stage keys: `'dense' | 'scan'`；保留现有 keys。
- Add `SearchRecallOptions.onStage?: (stage: 'graph' | 'expansion' | 'scan', ms: number) => void`。
- `graph` 是首轮 `fetchScored`（BM25 + base graph）总耗时；`expansion` 是 `expandQuery`；`scan` 是 `mergeScanResults`；外层 `search` 继续记录整个 `searchRecallMemories`，不是各子阶段之和的替代。
- route 对 `computeDenseScores` 记录 `dense`，并向 live search 传 `onStage: recordRecallStage`；snapshot build 不传 observer。
- Add `GET /api/recall/metrics` / operation `recall.metrics`，200 返回 `snapshotRecallMetrics()` 的 JSON 新鲜副本。

- [ ] **Step 1: 写失败测试**

覆盖新 stage ring；真实 `searchRecallMemories` 的 graph→expansion→scan observer 顺序与结果不变；observer throw fail-open；route dense/search 子阶段接线；metrics endpoint 200、全部 stage 与 request counters；契约包含新 route。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/recall-metrics.test.ts tests/unit/recall/recall-search-stage-metrics.test.ts tests/unit/recall/recall-route-metrics.test.ts tests/unit/api-contract.test.ts --runInBand`
Expected: 新 key/observer/endpoint 缺失而 FAIL。

- [ ] **Step 3: 最小实现、登记 schema/catalog 并更新文档**

observer 只包裹既有调用并 catch 自身异常；不得改评分/过滤。metrics route 无参数、无写操作。文档明确外部前台只阻止新后台启动、不能抢占已运行任务，以及各 stage 的口径。

- [ ] **Step 4: 重新生成契约并验证 GREEN**

Run: `cd gateway; npm run emit:openapi; cd ..; npm run gen:api -w @mafw/sdk; cd gateway; npx jest tests/unit/recall tests/unit/scheduler tests/unit/index-scan-http.test.ts tests/unit/index-scan-cooldown.test.ts tests/unit/routes/memory-receipt-route.test.ts tests/unit/api-contract.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS，类型门 exit 0；生成物只包含本 route 的必要变化。
