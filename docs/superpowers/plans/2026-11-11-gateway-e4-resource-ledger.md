# Gateway E4 资源台账 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给常驻 gateway 一个可观测、可强制、可降级的资源账本：TimerService、disk/heap governor、连接表、有界出站缓冲、进程台账、项目/会话配额、`/api/kernel/stats`。

**Architecture:** `resources/` 下的 provider 全部纯逻辑 + 可注入系统调用；`ResourceGovernor` 聚合 disk/heap 压力；kernel 组装并注入 live config getter；stats 路由只读快照。降级只拒绝非前台工作，正常路径响应不变。

**Tech Stack:** TypeScript (CJS), Jest（gateway）, Node 24 `fs.statfs` / `process.memoryUsage` / `v8.getHeapStatistics` / `process.getActiveResourcesInfo`。无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md`

## Global Constraints

- TDD 铁律；每项一个 commit `(E4-n)`。
- 正常路径响应形状不变；新增拒绝路径必须带机器码（`quota_exceeded` / `connection_limit` / `disk_low`）。
- 所有阈值/上限读 `config.resources` live getter；不缓存配置对象；`0` = 不限。
- 隔离工作区 `.superpowers/e4-worktree` + 分支 `feat/gateway-e4-resource-ledger`（基 main；若 main 前移以此为准）。
- 对既有模块的改动保持向后兼容：新 deps 可选，缺省时行为与当前一致；kernel 组装后必须显式传入。
- 已知环境红名单沿用（claude-adapter ×2、plugin-package-e2e、desktop resolver 需 gateway/dist）。
- TimerService 只迁 4 个 kernel 自有长驻 interval；短命 retry/sleep/超时不动。

## Review Focus

1. **上限不能误伤正常路径**：配额默认值偏高、`0=不限`；连接/缓冲上限可配置；拒绝只发生在显式上限。
2. **SSE 断开的恢复语义**：溢出断开慢客户端后，客户端必须能靠 `since`/Last-Event-ID 重连回放，不能丢事件。
3. **statfs/memoryUsage 失败 fail-open**：采样失败不得降级、不得阻塞启动。
4. **TimerService 关闭顺序**：`disposeAll` 幂等；SSE 连接级 timer 随连接关闭清理；WS hub dispose 清本组。
5. **进程台账真实性**：Python 用真实 spawn/exit 钩子；serve 标注 `owned:false`；不假装 gateway 能 kill runtime sidecar。
6. **stats 不泄敏**：只返回计数/比率/pid，不返回路径、文件内容、token。

---

### Task 1: Config + resources/ 整理 + TimerService（E4-1）

**Files:** Modify `gateway/src/config.ts`；Move `gateway/src/resources/sdk-session.ts` → `gateway/src/runtime/sdk-session.ts`（更新 `boot.ts`、`kernel.ts`、4 个 test import）；Create `gateway/src/core/timer-service.ts`；Test `gateway/tests/unit/core/timer-service.test.ts`、`gateway/tests/unit/config-resources.test.ts`

**Interfaces:** `GatewayConfig.resources`（spec §5 形状）；`Config.resources` getter；`TimerService.every/after/clear/clearByPrefix/disposeAll/stats`。

- [ ] Step 1: RED — config defaults/deep-merge/`0=不限` 语义测试；TimerService fake-timers 测试（回调触发、同名抛错、clear 幂等、disposeAll、stats、unref 不阻塞退出）。
- [ ] Step 2: GREEN — 加 `resources` 类型、`defaults()` 默认值、`get resources()`；实现 TimerService；移动 sdk-session 并修 import。
- [ ] Step 3: 跑 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` + 两个测试文件；确认无残留 `resources/sdk-session` import。
- [ ] Step 4: Commit `feat(resources): config section, TimerService, and resources/ cleanup (E4-1)`。

### Task 2: Disk/Heap Governor（E4-2/E4-3）

**Files:** Create `gateway/src/resources/disk.ts`、`gateway/src/resources/heap.ts`、`gateway/src/resources/governor.ts`；Test `gateway/tests/unit/resources/disk.test.ts`、`heap.test.ts`、`governor.test.ts`

**Interfaces:** `sampleDisk(path, statfsFn)`；`sampleHeap(memoryUsage(), heapLimit())`；`ResourceGovernor.start/stop/sampleNow/pressure/snapshot/isDegraded/onChange`；状态 `ok|warn|critical|unknown`（heap 无 unknown）。

- [ ] Step 1: RED — 阈值边界、回滞（critical→warn at 1.5×、warn→ok at 1.1×）、unknown fail-open、heap ratio、transition listener、`governor:sample` timer 注册。
- [ ] Step 2: GREEN — 实现三个模块；注入 `statfs`/`memoryUsage`/`heapLimit`/`timers`/`now`；采样间隔读 `config.resources.sampleIntervalMs`。
- [ ] Step 3: 跑 tsc + 3 个测试文件。
- [ ] Step 4: Commit `feat(resources): disk/heap governor with pressure hysteresis (E4-2/E4-3)`。

### Task 3: 连接表 + 有界出站缓冲（E4-4/E4-5）

**Files:** Create `gateway/src/resources/connections.ts`、`gateway/src/resources/outbound-buffer.ts`；Modify `gateway/src/http/ws-upgrade.ts`、`gateway/src/server/event-hub.ts`、`gateway/src/routes/events-sse.ts`、`gateway/src/events/sse-attach.ts`；Test `gateway/tests/unit/resources/connections.test.ts`、`outbound-buffer.test.ts`、`gateway/tests/unit/http/connection-limits.test.ts`、`gateway/tests/unit/events/sse-backpressure.test.ts`

**Interfaces:** `ConnectionTable.tryAcquire(kind)/lease.release()/noteHttpOpen/noteHttpClose/snapshot()`；`SseBoundedWriter.write/dispose/stats`；`sendWsBounded(ws, frame, cap)` 或 EventHub 内联检查。

- [ ] Step 1: RED — lease 幂等/按 kind 限额/0=不限/refused；writer 的 `write=false`→paused→drain flush、帧/字节双溢出 destroy、dispose 移除 listener；SSE 超限 503 且不写 greeting；WS `bufferedAmount` 超限 terminate + 从集合删除。
- [ ] Step 2: GREEN — 实现两个 provider；`events-sse.ts` 用 writer 包 `writeFrame`，连接关闭 dispose；`ws-upgrade.ts` 在 upgrade 前 `tryAcquire`，close/error release；`event-hub.broadcast` 检查 WS 缓冲。
- [ ] Step 3: 跑 tsc + 目标测试 + `tests/unit/events/ tests/unit/http/ tests/unit/routes/`（既有 SSE/WS 回归）。
- [ ] Step 4: Commit `feat(resources): connection table and bounded SSE/WS outbound buffers (E4-4/E4-5)`。

### Task 4: 进程台账 + 项目/会话配额（E4-6/E4-7）

**Files:** Create `gateway/src/resources/process-ledger.ts`、`gateway/src/resources/quotas.ts`；Modify `gateway/src/python/kernel-service.ts`、`gateway/src/routes/python.ts`、`gateway/src/runtime/sdk-session.ts`、`gateway/src/routes/session-create.ts`、`gateway/src/routes/sessions-core.ts`、`gateway/src/http/transport.ts`、`gateway/src/kernel.ts`；Test `gateway/tests/unit/resources/process-ledger.test.ts`、`quotas.test.ts`、`gateway/tests/unit/python/session-kernels-cap.test.ts`、`gateway/tests/unit/resources/session-quota.test.ts`、`gateway/tests/unit/http/register-quota.test.ts`

**Interfaces:** `ProcessLedger.register/count/list/snapshot/disposeAll`；`QuotaExceededError(resource,limit,current)`；`QuotaService.assert(resource,current)/snapshot(currents)`；`SdkSessionResource` 新增可选 `{ quotas, countSessions? }`；kernel 字段 `processLedger`、`quotas`。

- [ ] Step 1: RED — ledger register/release/幂等/count；SessionKernels 达上限先驱逐 >10min idle、仍满抛 `QuotaExceededError`；`POST /api/python/execute` 429；SdkSessionResource total/per-project 配额与 0=不限；`handleSessionCreate` 429；transport `/register` 429（重复注册同目录放行）。
- [ ] Step 2: GREEN — 实现 ledger/quotas；SessionKernels 注入 ledger+maxKernels；KernelManager spawn/exit 记账；Llamacpp spawn/exit register/release；SdkSessionResource 计数与配额；kernel 创建字段并接线；错误映射。
- [ ] Step 3: 跑 tsc + 目标测试 + `tests/unit/python/ tests/unit/routes/sessions* tests/unit/http/`。
- [ ] Step 4: Commit `feat(resources): process ledger and project/session quotas (E4-6/E4-7)`。

### Task 5: `/api/kernel/stats` + 组装（E4-8）

**Files:** Create `gateway/src/routes/kernel-stats.ts`、`gateway/src/routes/schemas/resources.ts`；Modify `gateway/src/routes/route-catalog.ts`、`gateway/src/subsystems/api-routes.ts`、`gateway/src/kernel.ts`；Test `gateway/tests/unit/routes/kernel-stats.test.ts`、`gateway/tests/unit/api-contract.test.ts`（可达性守卫自动覆盖，补 schema 断言）

**Interfaces:** `attachKernelStatsRoute(registry, { snapshot })`；`KernelStatsResponse` TypeBox；kernel 字段 `timers`、`connections`、`governor` 并接入 `startApiServer`/`stop()`。

- [ ] Step 1: RED — 路由返回 spec §4.8 形状；无 provider 时字段为空不报错；catalog `kernel.stats` 存在且有 200 schema；可达性守卫绿。
- [ ] Step 2: GREEN — 实现 route/schema/catalog；kernel 组装 `timers`、`connections`、`governor`（`start()` 在 server listen 后，`stop()` 里 `governor.stop()` + `timers.disposeAll()` + `processLedger.disposeAll()`）；`apiRouteDeps` 加 live getter；`/api/stats` 不动。
- [ ] Step 3: 跑 tsc + 新测试 + `tests/unit/api-contract.test.ts tests/unit/architecture/`；`npm run emit:openapi` + SDK `merge-contract.mjs` + `api-schema.gen.ts`（若工具可用）。
- [ ] Step 4: Commit `feat(kernel): resource stats endpoint and governor wiring (E4-8)`。

### Task 6: Timer 迁移 + 降级接线（E4-1/E4-2/E4-3 收尾）

**Files:** Modify `gateway/src/http/ws-upgrade.ts`、`gateway/src/events/sse-attach.ts`、`gateway/src/python/kernel-service.ts`、`gateway/src/kernel.ts`、`gateway/src/routes/dashboard.ts`、`gateway/src/routes/memory.ts`、`gateway/src/events/event-store.ts`；Test `gateway/tests/unit/resources/timer-migration.test.ts`、`degradation.test.ts`

**Interfaces:** `createWsHub` deps `timers`；`attachGlobalSse` deps `timers`；`SessionKernels` deps `timers`；`EventStore.pruneNow(retention)`；`ResourceGovernor.onChange`；scheduler budget checker 读 `governor.isDegraded()`。

- [ ] Step 1: RED — WS hub dispose 清 `ws:ping`/`ws:device-cleanup`；SSE close 清 `sse:ping:*`；SessionKernels dispose 清 `python:sweep`；disk critical 时 scheduler 非 foreground 拒绝、foreground 放行；heap critical 同；`memory.add` 返回 `code:'disk_low'` 且不写；event_log 边沿裁剪；恢复后重新接纳。
- [ ] Step 2: GREEN — 迁移 4 类 interval 到 TimerService；scheduler budget checker 接 governor；memory.add/backfill 接压力检查；event_store 加 `pruneNow`；kernel 订阅 `governor.onChange` 做 critical 边沿裁剪。
- [ ] Step 3: 跑 tsc + 目标测试 + `tests/unit/events/ tests/unit/routes/ tests/unit/scheduler*`；确认无残留长驻 `setInterval`（4 个迁移点）。
- [ ] Step 4: Commit `feat(resources): migrate kernel timers and wire pressure degradation (E4 closeout wiring)`。

### Task 7: 收口（E4-9）

- [ ] Step 1: `docs/architecture/gateway.md` E4 段（现状：config/resources、governor、连接/缓冲、进程/配额、stats、降级矩阵）；`docs/releases/2026-11-11-gateway-e4-resource-ledger.md`（分支/基 commit/各 task commit、默认值、拒绝路径、已知限制、test evidence）。
- [ ] Step 2: 全量门禁（gateway tsc + full jest 允许 env-red；SDK full + contract；desktop `npm run test:desktop` 允许 resolver env-red；TUI `npm run test:tui`；analyzer TOTAL 0；kernel-split guards）。
- [ ] Step 3: 终审 + ledger；commit `docs(gateway): E4 resource-ledger closeout (E4-9)`。

## Ledger

`.superpowers/sdd/2026-11-11-gateway-e4-resource-ledger/progress.md`
