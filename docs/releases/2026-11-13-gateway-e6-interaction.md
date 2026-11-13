# Gateway E6 交互模型交付记录（2026-11-13）

- 版本：desktop 5.1.0 / gateway 4.16.1

## 波次

- 分支：`feat/gateway-e6-interaction-model`（worktree `.superpowers/e6-worktree`）
- 基线：`9c67c43c`（main，E6 spec/plan 落库时点）
- 范围：E6-1 desktop replay 补页 + E6-2 session 单一实体缓存 + E6-3 `decision.updated` 增量补丁
  + E6-4 mobile 会话列表增量 + E6-5 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e6-interaction.md`
- 架构现状：`docs/architecture/desktop.md` §「交互模型：replay 补页 / 单一实体缓存 / 决定增量补丁
  （2026-11-13，E6）」、`docs/architecture/mobile.md` §7.9
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e6-interaction/{progress.md,batch1-report.md,batch2-report.md,batch3a-report.md,batch3b-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `f247fc9e` | E6-1 | `event-replay-gap.ts`（分页 replay、seq 注入、reset/truncated、页数上限）+ `SseConnectionDeps.recoverGap`：开流前补 `(cursor, headSeq]`，成功以 `headSeq` 开流 |
| `730cac44` | E6-1 review | replay 信封解包 canonical `{type:'mafw_event',data}`（否则补页事件全被 dispatcher 丢弃）；单请求 5s 超时（Abort + race）；干净补页后 `writeSeq(headSeq)`；`headSeq < since` 回退旧路径 |
| `c58a0f15` | E6-2 | `session-entities.ts` 成为唯一元数据来源；`session-store` 只存 project bucket `{ids,fetchedAt,failed}`；`session-title.ts` 单读标题；`retitleOpenTab` 只写实体；全量重同步 reset 实体 |
| `60cf4581` | E6-2 review | 恢复/打开 tab 不覆盖新标题与用户改名（`resolveOpenSessionTitle`、layout 快照存 live label）；标题单一写者 `retitleSessionEntity`；dispatcher 拆分 title 与 lifecycle；`hydrateSessionInfo` 补实体字段 |
| `7cf25fed` | E6-3 | `decision.updated` 携带完整 `record`（additive）；`DecisionStore.ingest` 就地 upsert + attention patch + 无全量请求；旧 gateway 回退 refresh |
| `bac6227a` | E6-3 review | refresh 合并改 freshness guard（旧快照不得覆盖刚 ingest 的记录）；项目切换 bump seq + 回调校验 `projectDir`，在途响应不跨项目落地 |
| `b1e00f29` | E6-4 | `applySessionListEvent`（update/delete/create；Lead-first 共享比较器）+ `SessionsPage.events` 订阅/重订阅/dispose；`main.dart` 传 `_ws?.events` |
| `63ed1b80` | E6-4 review | 隐藏会话镜像 gateway `isHiddenSession`（created 不落列表、不置 dirty）；dirty 代际修复（飞行期间 created 不丢）；类型噪声防御 |
| E6-5 closeout（本记录） | E6-5 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E6-1 desktop replay gap recovery**：`SseConnection.openOnce` 读到持久化游标后先
  `recoverGap(since, 500)`；实现 `sse/event-replay-gap.ts#recoverEventGap` 循环
  `GET /api/events/replay`（limit 500/clamp 1000、页数上限 100、`nextSince` 必须前进），
  每页逐条 `dispatch`（canonical `mafw_event` 先解包 `data`，再以 `item.seq` 覆盖 seq）。
  成功 → 以 `headSeq` 开流 + 游标钉到 headSeq（SSE 零回放）；`reset/truncated` → 清游标 +
  `onFullResync` + headSeq 开流；404/HTML/503/网络/超时/形状不符/headSeq 倒挂 → null 回退原
  `since`（E2-3 路径，greeting 分级）。单请求 5s 超时；`MafwShell` 用 `gateway.info().url` +
  `dispatchShellEvent` 注入。首次连接（无游标）不 replay。
- **E6-2 session 单一实体缓存**：`session-entities.ts` 持有全部会话元数据（merge 语义、
  `undefined` 不清空、`version()` 反应式心跳）；`session-store` 只存 bucket id[] + fetchedAt/failed，
  公共 API 不变；`session-title.ts`（`sessionTitle`/`sessionTabTitle`/`resolveOpenSessionTitle`/
  `sessionSnapshotTabs`）是唯一标题读写路径；tab 的 `title` 仅作持久化恢复的首帧 fallback，
  Lead 等角色 tab 永远显示角色标签；`workspace.sessionRole` 从实体 metadata 派生；
  `onFullResync` 先 `sessionEntities.reset()` 再 invalidate。
- **E6-3 decision 增量补丁**：`DecisionRecordEvent` 增 `record`（写入后的完整记录，既有
  `action/projectDir/goalId/revision/recordId` 不变；内部事件，route/catalog/openapi/SDK 不动）；
  `DecisionStore.ingest` 校验 action/record 形状后按 id upsert（`updatedAt` 相同复用对象、新记录
  newest-first），patch 同 id 的 attention 行（status/summary，schema-tolerant），返回 true 不发请求；
  更旧记录零写入（freshness）；foreign project 返回 true 不 patch；形状不符/缺 record → false，
  `MafwShell` 回退 200ms 合并 refresh。
- **E6-4 mobile 会话列表增量**：纯函数 `applySessionListEvent` 只吃 canonical
  `session.created/updated/deleted`：updated 只 merge present 字段且不重排（`time.updated` 未建模）、
  deleted 按 id 移除、created 要求 id+title 并按 `compareSessionRows`（Lead 先、newest-first）重排，
  不完整 created → 页面 dirty + 250ms 合并全量；`isHiddenSessionRow` 镜像 gateway 隐藏谓词；
  active 项目下可证明属于别项目的 created 直接忽略（路径规范化）；`SessionsPage.events` 可空、
  WS 重建重订阅、dispose 取消；dirty 在拉取开始时兑现并用代际标记，飞行期间到达的 created
  结束时补一次（普通 rebuild 仍不重试）；`events:null` 保持旧行为。

## 行为变化 / Breaking

1. **纯增量（无 breaking）**：SSE/WS 协议、`event_log` 表结构/retention、路由与 SDK 契约零改动。
   唯一 payload 变化是 `decision.updated` 增 `record`（additive，旧消费者忽略即可）。
2. **desktop 重连语义**：有游标的重连从「直接开 SSE 由 greeting 回放」变为「先 REST 补页再以
   headSeq 开流」；补页失败/旧 gateway 逐字回退旧行为。补页半途失败时已 dispatch 的行可能在
   greeting 回放中重复出现，消费侧为幂等 upsert（at-least-once）。
3. **session 元数据单一来源**：`session.updated` 不再双写 tab/store；`ChatSession.title` 降级为首帧
   fallback，标题/角色显示统一读实体。tab 持久化格式不变（`{id,title}`）。
4. **decision 刷新**：带 record 的事件不再触发 attention+decisions 两次全量请求；attention 投影没有
   独立轮询，靠下一次 `decisionStore.refresh()`（项目/Pod 切换、显式动作、旧 gateway fallback）收敛。
   `refresh` 合并从「updatedAt 相等复用」改为「不旧于现有才替换」。
5. **mobile 会话列表**：事件到达即就地更新（不再等切 tab/下拉）；隐藏会话与别的项目的 created 不进列表。

## 验证（worktree @ E6-5）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors** |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **7002 tests：6991 passed / 9 failed / 2 skipped**；**894 suites：890 passed / 3 failed / 1 skipped**（3 个失败 suite 与基线同集合：`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1，见已知红 #1；连跑两次结果一致） |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **229/229 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **5/5 passed** |
| desktop | `npm run test:desktop`（worktree root） | **3672 tests / 3671 passed / 1 failed**（`src/main/mafw-gateway-resolver.test.ts` "resolves dev path relative to module location"：worktree 未构建 `gateway/dist`，与基线同红） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json` | **env-red**：本 worktree 未安装 `tsgo`（`npx` 404 `tsgo@*`）；回退 `node ../../node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json` → **仅既有 `node:tls` 噪声 2 条**（`getCACertificates` / `setDefaultCACertificates`，`src/main/index.ts:6`） |
| TUI | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同）；本波零 TUI 改动 |
| mobile 定向 | `flutter test test/session_list_events_test.dart` / `test/sessions_page_test.dart` | **30/30 + 11/11 passed**（合计 41；两文件合并跑在并发负载下命中已知 runner 中止，单独跑全绿） |
| mobile 对比套件 | `flutter test test/tab_shell_test.dart` / `test/lead_entry_test.dart` | **7/7 + 13/13 passed**（合计 20；合并/并发跑曾命中 runner 中止，单独跑全绿） |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| mobile 全量 | `flutter test` | **483 passed 后 runner 中止**（mass `did not complete`，已知 Windows 并发 flake）；被中断文件隔离复跑全绿 |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `node ../node_modules/jest/bin/jest.js tests/unit/architecture/kernel-split-guards.test.ts --no-coverage --runInBand --forceExit`（`gateway/`） | **7/7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（`gateway/`，316 routes → 282 paths / 316 operations）+ `node scripts/merge-contract.mjs`（SDK，overrides 命中 19） | **内容无 diff**（工作区仅 docs 变更） |

## 新增测试（对基线 `9c67c43c` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| desktop | **+93** | E6-1 30（`tests/event-replay-gap.test.ts` 18 + `tests/sse-replay-gap.test.ts` 12，含 review 的 9 条）；E6-2 48（`session-entities` 7、`session-title` 15、`session-title-writer` 5、`session-workspace-role` 5、`session-entity-cache-wiring` 6、`session-store` +5、`session-info` +3、`dispatcher` +2）；E6-3 15（`decision-store.test.ts` 25 中新增 15：ingest 矩阵 12 + freshness/项目切换 3） |
| mobile | **+41** | `session_list_events_test.dart` 30（update/delete/create/缺字段/隐藏谓词/排序/类型噪声）+ `sessions_page_test.dart` 11（无全量刷新、单次 debounce、项目与路径守卫、`events:null`、重订阅、dispose、飞行期间 created） |
| gateway | **+1** | `tests/unit/decision-record-service.test.ts`：`decision.updated` payload 携带完整 `record` 且既有字段不变 |

> 计数口径：可执行 test case 数，不是断言数。desktop 基线 **3579**（3672 − 93）；mobile 定向文件
> 41 条全部为本波新增。

## 已知红（非本波代码问题）

1. **gateway env-red**：`integration/plugin-package-e2e`（Desktop `node_modules` 的
   `@mafw/plugin-contract` staging）、`claude-adapter-acceptance` / `claude-adapter-coverage`
   （`@anthropic-ai/claude-agent-sdk` 缺失），与基线同集合。
2. **TUI**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`），本波未触碰 TUI。
3. **desktop 1 条环境红**：worktree 内未构建 `gateway/dist` 时 `mafw-gateway-resolver` 的 dev-path
   用例拿到 `null`；E5b 同现象，`gateway npm run build` 后即全绿。
4. **desktop 类型门禁**：`tsgo` 在本 worktree 不可用（未安装，`npx` 走 registry 404），改用等价的
   `tsc -p tsconfig.json`；只剩既有 `node:tls` 噪声。
5. **mobile 全量 flake**：Windows `flutter test` 并发 widget 套件偶发 runner 中止
   （`did not complete` / `Connection closed before test suite loaded`），被中断文件单独跑全绿。

## Deferred（明确不在 E6 范围）

- **`pod.updated` 的更强 payload**：当前 kind 级刷新足够，未做记录级增量。
- **mobile 工作 tab 增量渲染**：已有 `goalId` 局部更新（`WorkRefreshBus.consumeEvent`），
  E6 只覆盖会话列表，工作 tab 不重做。
- **attention → decision 投影**：`/api/attention` 目前不产出 decision 记录行，E6-3 的 attention patch
  实际为空操作（代码已 schema-tolerant，投影落地即生效）；attention 状态仍靠下一次 `refresh()`
  （项目/Pod 切换、显式动作、旧 gateway fallback）收敛。
- **持久化 tab 标题 fallback**：实体未取到（离线/桶被裁剪）时仍显示 `{id,title}` 里的旧标题，
  直到 bucket fetch 或 `session.updated` patch 到实体。
- **decision foreign-project guard 的边界**：只比 `record.projectDir`；记录缺该字段时按本项目处理。
- **replay 补页与 greeting 的重复**：半途失败回退会重放已 dispatch 的行（幂等消费吸收），
  未做 exactly-once 去重。
