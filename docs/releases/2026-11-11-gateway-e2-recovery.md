# Gateway E2 恢复闭环交付记录（2026-11-11）

## 波次

- 分支：`feat/gateway-e2-recovery`（worktree `.superpowers/e2-worktree`）
- 基线：`251968aa`（main @ 2026-11-11，E1 止血合并后）
- 范围：**重连后状态可恢复**（B1/B2/B4 + C2，含 B3 的降级裁决）6 项；不动回放机制本身
  （`event_log` / seq / 保留策略），不改 SSE 帧结构（只加 greeting 字段）
- spec：`docs/superpowers/specs/2026-11-11-gateway-e2-recovery-design.md`
- plan：`docs/superpowers/plans/2026-11-11-gateway-e2-recovery.md`
- 架构现状：`docs/architecture/gateway.md` §「E2 恢复闭环（2026-11-11）」
- TDD：每项先写失败测试并确认按预期失败 → 最小实现 → 一个 commit；证据见
  `.superpowers/sdd/2026-11-11-gateway-e2-recovery/batch{1,2,3}-report.md`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `d664f875` | E2-1 | SSE greeting 带 `instanceId`/`schemaEpoch`；`since > headSeq` → `reset:true` 且零回放（reset 优先且与 truncated 互斥，maxReplayed 归零） |
| `749d47a9` | E2-4 | WS `connected` 带 `headSeq`；文档明确 WS 为 live-only（重连走 SSE 游标或 REST 快照） |
| `e7dfa056` | E2-5 | `EventStore.append` 失败计数 + 30s 限频日志；`/api/stats` 增 `eventAppendFailures`（无持久 store 时省略） |
| `b0c7e7e2` | E2-2 | SDK `subscribe(opts?)` 支持 `cursor` + `onReplayInfo`；仅 `id:` 帧写游标；不传 opts 行为不变 |
| `670079e8` | E2-3 | desktop 持久化 `mafw-sse-seq`/`mafw-sse-instance`、`?since` 重连、按 reset/truncated/instance 分级重同步；每次重连强制补拉活跃会话 |
| 文档 commit | E2-6 | 本节 + 架构现状 + 全量门禁（gateway / SDK / desktop / TUI / analyzer / kernel-split） |
| 修复 commit | F1/F2 | sticky-id greeting 分级不再被短路；接管重连按当前游标重建；按 seq 去重回放帧（终审阻塞项） |

## 逐项要点（补充架构节未覆盖的细节）

- **E2-1**：`sse-attach.ts` greeting 增加 `instanceId`/`schemaEpoch`/`reset`；接线从
  `releaseMetadata.schemaEpoch` + `runtimeIdentity.instanceId` 经 `ApiRouteDeps.releaseIdentity`
  交给 `attachEventsSseRoute`（`EventsSseRouteDeps.releaseIdentity`，live getter）。`since >
  headSeq` 时跳过 `replaySince`，`maxReplayed = 0`（重置后低 seq 直播帧不被陈旧 since 过滤）。
- **E2-2**：`SSEConnection.subscribe(baseUrl, opts?)` / `connect(baseUrl, opts?)`；URL 以
  `withSince` 语义拼 `?since=`（SDK 内联判断）；`onReplayInfo` 只在 greeting 的 `headSeq` 为
  number 时回调；`MafwClient.event.subscribe(opts?)` 透传，缺省路径仍调用 `connect(baseUrl)`。
- **E2-3**：`SseConnectionDeps` 新增 `onFullResync(reason, info)` / `onReconnect()` /
  `storage?: SseCursorStorage | null`（默认 `globalThis.localStorage ?? null`）；`open` 接收
  `since: number | null`，MafwShell 用 `withSince(await event.url(), since)` 构造 EventSource。
  MafwShell 的整表 invalidate 块从 `onOpen` 移到 `onFullResync`（`initial` 保持旧行为）；
  `onReconnect` → `loadSessionHistory(sid, { force: true })`（覆盖已有消息/部件、状态按 REST 对账）。
- **E2-4**：`WsHubDeps.headSeq?: () => number | null`（kernel 接
  `this.eventStore?.headSeq() ?? null`）；`headSeq` 始终出现在 `connected`，无 store 为 `null`。
- **E2-5**：`APPEND_FAILURE_LOG_INTERVAL_MS = 30_000`；计数 `appendFailures()` 进程级累计，
  恢复成功后不清零；dashboard stats 的 `eventAppendFailures` 仅在 `eventStore != null` 时出现
  （既有 stats payload 形状契约不破）。

## 终审修复轮（F1/F2，2026-11-11）

终审在 desktop SSE 模块发现两个阻塞缺陷，均已用 RED→GREEN 修复（仅 `packages/desktop`，
gateway / SDK 无改动）：

- **F1 — sticky `lastEventId` 吞掉 greeting 分级**：真 EventSource 的 `lastEventId` 是 sticky 的，
  无 `id:` 的 `connected` greeting 会继承上一帧 id；旧实现先看到数字 id 就 `return`，
  `handleGreeting` 在浏览器原生重连路径上永远不执行（reset/truncated/instanceId 分级失效）。
  修复：每帧都解析，按 `type === 'connected'` 判定 greeting 并始终分级；只有真实数据帧推进
  游标（greeting 的 sticky id 不写游标）。
- **F2a — 冻结的 `?since` + 原生重连复用旧 URL**：Chromium 自动重连沿用 open 时 URL，且
  gateway `parseSince` 让 query 优先于 `Last-Event-ID` → 每次抖动都从旧游标重放（最多 2000 帧）。
  修复：接管重连——任何 `onerror` 关闭当前 source 并由模块按**当前持久化游标**重建；
  reset/instanceId 变化清游标后，下一次重建自动丢弃 `since`。`dispose()` 语义不变。
- **F2b — 回放无去重**：同一 seq 帧会分发两次（TTS 重复朗读、idle 通知、markResponded 双触发）。
  修复：连接模块按 `data.seq ?? data.data?.seq` 维护 `lastAppliedSeq`，`seq ≤ lastAppliedSeq`
  的帧不再分发；无 seq 的 `part.delta` 永远应用；全量重同步（initial/reset/truncated/instance）
  重置闸门。`lastEventId` 不参与去重（sticky 且 part.delta 无 seq）。

## 验证（worktree @ `670079e8` + E2-6 文档改动 + F1/F2 修复轮）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `node node_modules/jest/bin/jest.js --no-coverage --forceExit --runInBand`（`gateway/`） | **6282 tests：6272 passed / 9 failed / 1 skipped**；**811 suites：807 passed / 3 failed / 1 skipped**（3 个均为下列 env-red；`--onlyFailures` 复核同名） |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"`（`packages/gateway-sdk`） | **214 tests：214 passed / 0 failed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **4/4 passed** |
| desktop | `npm run test:desktop`（repo root） | **3264 tests：3263 passed / 1 failed**（env-red resolver）；688 suites |
| TUI | `npm run test:tui` | **309 tests：308 passed / 0 failed / 1 skipped** |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `jest tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |

新增测试：**35**（gateway 16：E2-1 7 / E2-4 3 / E2-5 6；SDK 9：E2-2；desktop 10：E2-3）。
终审修复轮再 **+8**（F1 2 项 + F2a 2 项 + F2b 4 项，`packages/desktop/tests/sse-cursor.test.ts`），
本波合计 **43**。
对照 E1 收官记录：gateway **6266 → 6282**（+16）、desktop **3236 → 3264**（+28：E2-3 10 + 修复轮
8 + E1 合并后既有增量 10）、TUI **309 持平**、SDK contract 4/4 持平（SDK 全量本波
214，含 E2-2 新增 9）。

## 已知环境红（非本波代码问题；均在本环境基线同样红）

1. `tests/unit/runtime/claude-adapter-acceptance.test.ts` + `claude-adapter-coverage.test.ts`：
   `adapters/claude` esbuild 构建失败 — `Could not resolve "@anthropic-ai/claude-agent-sdk"`
   （共享 `node_modules` junction 缺包；`adapters/` 与本波无关）。
2. `tests/integration/plugin-package-e2e.test.ts`：模拟 Desktop `node_modules` 的
   `@mafw/plugin-contract` staging 失败（依赖/构建环境，非 E2 代码）。
3. desktop `src/main/mafw-gateway-resolver.test.ts` "resolves dev path relative to module location"：
   worktree 无 `gateway/dist`（未构建）→ 解析返回 null；该文件在本波零改动，基线同样失败。
4. desktop `npm run typecheck`（`tsgo -b`）：`src/main/index.ts` 两处 `node:tls`
   `getCACertificates` / `setDefaultCACertificates` 缺失（`@types/node` 环境级），与本波无关；
   E2 触及文件 0 类型错误。
5. TUI `tsc --noEmit`（若单独跑）：`TS5023 Unknown compiler option 'rewriteRelativeImportExtensions'`
   — 仓库 `typescript` 5.6.x，需 ≥5.7；配置级、与本波无关（沿用 E1 记录）。

## Deferred（明确不在 E2 范围）

- **mobile（Dart）游标**：Orcalore 客户端独立改造，后续波次（本波 mobile 保持「重连即全量」）。
- **C1：event_log 作为恢复源 / 消费者幂等** → E5（大项）。
- **定时器注册表** → E4 资源台账。
- **WS 总线化（cursor + replay）**：正式放弃，只保留 E2-4 的降级文档与 headSeq。
