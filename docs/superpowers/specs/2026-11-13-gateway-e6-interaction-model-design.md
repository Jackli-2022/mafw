# Gateway E6 交互模型：设计（2026-11-13）

> 来源：58 项清单中的交互模型面。目标：把 E5b 的 event_log 恢复源接到桌面；把 desktop 的会话元数据收敛到单一实体缓存；把 `decision.updated` 从"整表刷新"改为增量补丁；让 mobile 会话列表按事件增量更新。SSE/WS 协议与 gateway 既有事件词汇不变。

## 1. 意图

E5b 给了通用 replay 通道，但客户端交互层仍有四个缺口：

1. **desktop 在 SSE `truncated` 时仍整表重同步**：明明 event_log 能按 seq 补页，却选择 invalidate 所有 store。
2. **session 元数据有多份副本**：`session-store`（Rail/历史列表）与 `workspace.sessions`（tab 标题/Lead）各存一份标题/角色；`session.updated` 需要双写，容易漂移。
3. **`decision.updated` 只带 id/action**：desktop 收到事件后整表 `refresh()`（attention + decisions 两次请求），无法用事件本身增量更新记录。
4. **mobile 会话列表只在显式动作/重连时全量拉取**：`session.created/updated/deleted` 到达时列表不更新，用户要切 tab/下拉。

E6 保持协议不变，只改消费侧与事件 payload（additive）。

## 2. 非目标

- 不改 SSE 的 newest-window / greeting / 游标语义；不改 WS live-only 语义。
- 不重写 desktop 工作台布局、tab 持久化、ChatPane 渲染。
- 不做 mobile 全站增量渲染：E6 只覆盖会话列表；工作 tab 已有 `goalId` 局部更新（`WorkRefreshBus.consumeEvent`），不重做。
- 不改 gateway 的 event_log 表结构/retention；不新增 SDK-facing op（`event.replay` 已在 E5b internal）。
- 不引入第三方状态库；仍用 Solid signals/store 与 Flutter ChangeNotifier/State。

## 3. E6-1 Desktop replay gap recovery

### 3.1 行为

SSE 重连时，在打开 EventSource **之前**先用 REST replay 补 `(persisted cursor, headSeq]`：

- 有持久化游标 → 调 `GET /api/events/replay?since=<cursor>&limit=500` 循环分页；
- 每页把 `event.envelope` 交给现有 `dispatchShellEvent`（与 live 帧同一路由）；
- 补完后以 `headSeq` 作为 `?since=` 打开 SSE → SSE 不再回放，天然避免 live/replay 重复；
- replay 返回 `reset` / `truncated` / 404 / 503 / 网络失败 → 回退现有 `open(since)` 路径，由 SSE greeting 触发全量重同步；
- 首次连接（无游标）不 replay，保持现状。

### 3.2 接口

```ts
// sse/sse-connection.ts
interface GapRecovery {
  headSeq: number
  applied: number
  reset?: boolean
  truncated?: boolean
}

interface SseConnectionDeps {
  /** 可选：开流前补页。null = 不支持/失败，按原 since 打开。 */
  recoverGap?: (since: number, limit: number) => Promise<GapRecovery | null>
}
```

`openOnce` 顺序：`since = readSeq()` → `recoverGap(since)` → 若 `reset/truncated` 先 `onFullResync` + `clearSeq()` → `open(gap.headSeq ?? since)` → 设置 `resumeFromSeq/cursorSeq`。成功补页时 `lastAppliedSeq = headSeq`，live 帧 seq > headSeq 才应用。

### 3.3 Renderer 实现

新增 `sse/event-replay-gap.ts`（纯逻辑 + 注入 fetch）：
```ts
recoverEventGap(input: {
  baseUrl: string
  since: number
  limit?: number
  fetchImpl?: typeof fetch
  dispatch: (event: unknown) => void
}): Promise<GapRecovery | null>
```
- 循环 `since` → `nextSince`，`hasMore` 继续；`reset/truncated` 返回并停止；404/HTML/503/异常 → null。
- 每页事件：`dispatch({ ...envelope, seq: item.seq })`（seq additive，不依赖 envelope 自带）。
- `MafwShell` 在 `new SseConnection({ recoverGap })` 中注入：`gateway.info()` 取 baseUrl → `recoverEventGap({ dispatch: (e) => dispatchShellEvent(e, sseDeps) })`。

## 4. E6-2 Session 单一实体缓存

### 4.1 目标

`session-store` 的列表缓存不再保存实体副本，只保存 **project bucket → session id[] + 排序/时间/offline 元数据**；实体（id/title/directory/projectID/metadata/time/agent/parentID）集中在新的 `session-entities.ts`：

```ts
interface SessionEntity { id; title?; directory?; projectID?; metadata?; time?; agent?; parentID? }
const entities = Map<string, SessionEntity>; const [version, setVersion] = createSignal(0)
sessionEntities.get(id), upsert(entity), patch(id, partial), remove(id), version(), reset()
```

- `session-store.fetchFor`: 将 API 列表 `upsert` 进 entities，bucket 只存 id[]（已排序）+ fetchedAt/failed。
- `sessionsFor`: `ids.map(id => entities.get(id))`（保持 reactive version）。
- `patch/remove`: 更新 entities + 重排 bucket ids。
- `invalidate`: 清 bucket ids/refetch；entities 保留供离线读。
- `workspace.sessions`（tab）仍是 tab-local UI 状态（userMsgId/assistantMsgId/done）；**标题/Lead 从 entity 派生**：
  - `ChatSession` 保留 `title?` 作为首帧 fallback，但 `session.updated` 只写 entity cache；tab 渲染通过 `tabTitle(sid)` / `tabLead(sid)` 读 entity。
  - `MafwShell` 的 `retitleOpenTab` 改为 `sessionEntities.patch(id,{title})`，不再复制写 tab 数组；`openSessionTab` 初始 upsert entity。
  - `workspace.sessionRole(sid)` 从 entity metadata 派生（`tabSessionRole(entity)`）。
- 兼容：tab 持久化仍只存 `{id,title}`；resume 时 upsert 成 entity。

### 4.2 验收

- 同一 session 的标题只在 `sessionEntities` 存一份；`session.updated` 后 Rail、tab、ChatPane 标题同步。
- `session-store` 现有 API（sessionsFor/isLoaded/isOffline/invalidate/patch/remove）不变；测试更新为实体断言。
- 无 UI 行为回归（SessionStrip/ChatPane 测试）。

## 5. E6-3 Decision 增量补丁

### 5.1 Gateway payload（additive）

`DecisionRecordEvent` 增加 `record: DecisionRecord`（写入后的完整记录）。`decision.updated` properties 由 `{action,projectDir,goalId,revision,recordId}` 变为**额外**带 `record`；既有字段不变。类型/emit 测试更新。

### 5.2 Desktop

- `decision-store.ts` 增加 `ingest(event): boolean`：
  - 若 `properties.record` 是合法记录：按 id upsert `records`（保持旧的 `updatedAt` 相同则复用对象），更新 `revision`；同步 `attention.items` 中同 id 的 status/summary（有则 patch，无则保持）；返回 true。
  - 无 record / 形状不符 → 返回 false。
- `MafwShell` 的 `decisions.onEvent` 改为 `if (!decisionStore.ingest(event)) scheduleDecisionRefresh()`；保留 200ms 合并作为 fallback。
- 验收：带 record 的 `decision.updated` 不触发 attention/decisions 全量请求，记录列表立即更新；旧 gateway 无 record → 仍走原 refresh。

## 6. E6-4 Mobile 会话列表增量

### 6.1 纯函数

新增 `mobile/lib/src/models/session_list_events.dart`：
```dart
List<MafwSession> applySessionListEvent(List<MafwSession> current, MafwEvent event)
```
- `session.updated`：`properties.info` → 按 id 替换 title/directory/metadata/timeCreated（保持原顺序/Lead 排序）；不存在则忽略或 append（info 完整时）。
- `session.deleted`：移除 id。
- `session.created`：info 完整 → append/替换并按 `_compareSessions` 排序；不完整 → 返回原列表并由页面触发 debounced 全量刷新。
- 其他事件原样返回。

### 6.2 页面

`SessionsPage` 增加可选 `Stream<MafwEvent>? events`：
- `initState`/`didUpdateWidget` 订阅；`dispose` 取消。
- 事件到达且 chat tab 已加载 → `setState` 应用纯函数；`session.created` 不完整时置 `_chatDirty` + 250ms debounce `_loadChatSessions()`。
- `main.dart` 传 `events: _ws?.events`（WS 重建后 didUpdateWidget 重订阅）。
- `MafwSession` 增加 `copyWith`（或等价构造）供纯函数使用。
- 不做 work tab 改版：它已有 goalId 局部更新；在 release 记录"已满足"。

### 6.3 验收

- 纯函数矩阵：update/delete/create/缺字段/未知事件/顺序。
- Widget/页面测试：注入 fake stream，更新后列表不触发全量 listSessions；`session.created` 不完整触发一次 debounce refresh。
- 旧无 WS 场景（events=null）行为不变。

## 7. 测试与门禁

- Desktop：`node --test`（`--conditions=browser`）；SseConnection gap 测试、session-entities/session-store 测试、decision-store ingest、SessionStrip/ChatPane 回归；`tsgo --noEmit -p tsconfig.json`（允许既有 node:tls/SubjectPicker 噪声）。
- Mobile：`flutter test` 纯函数 + sessions page；`dart analyze`；全量 runner flake 记录。
- Gateway：decision event payload 测试；tsc/全量（允许 env-red）。
- 契约：`decision.updated` 是内部 event，不改 catalog/openapi；SDK contract 5/5 不变。
- 文档：`docs/architecture/desktop.md` 交互/事件段、`docs/architecture/mobile.md` 会话列表段、release 记录。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 开流前 replay 与 live 重复 | replay 完成后以 headSeq 开流，SSE 零回放；live 只从 headSeq+1 开始 |
| replay 404/旧 gateway | 回退原 `open(since)`，SSE greeting 触发全量重同步，行为不变 |
| 单一实体缓存重构破坏 tab 持久化 | tab 仍存 `{id,title}`；resume 只 upsert entity，不丢本地状态 |
| session.updated 只写 entity 后 tab 不刷新 | tab 通过 reactive version 读 entity；补 SessionStrip/ChatPane 测试 |
| decision 增量补丁漏 attention 状态 | record 有 status；attention patch 同 id，缺失则保留（下次 15s 轮询兜底） |
| mobile 事件顺序/缺字段 | 纯函数只做保守 patch；created 缺字段走 debounce 全量；seq 由 E5b 去重 |
| 全量门禁环境红 | 沿用已知红名单；不把 TUI/mobile runner flake 归因本波 |

## 9. 交付边界

- E6：上述四项 + 收口。
- 后续：pod.updated 的更强 payload（当前 kind 刷新足够）、mobile work tab 增量渲染（已部分满足）、更细的 event→entity patch。
