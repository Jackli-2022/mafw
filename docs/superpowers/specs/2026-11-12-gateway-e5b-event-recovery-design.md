# Gateway E5b 事件恢复源：设计（2026-11-12）

> 来源：58 项清单中的 **C1（event_log 作为恢复源 / 消费者幂等）**。目标：让"断线后补事件"不再只能靠 SSE newest-window 或全量重拉；event_log 提供**按 seq 升序、可分页、可检测截断**的恢复通道；mobile 持久化游标并按 seq 幂等消费。

## 1. 意图

E2 已交付 SSE 游标 + 重放，但恢复面仍有两个缺口：

1. **没有 REST 恢复源**：mobile 使用 WebSocket（live-only），重连后只能全量重拉；桌面在 SSE `truncated` 时也只能全量重同步。`event_log` 已持久化，却没有一个"从 seq 继续读"的稳定入口。
2. **消费者幂等没有统一契约**：事件帧有 `seq`（SSE `id:` / WS 顶层 `seq` / canonical `data.seq`），但 mobile 模型不解析、不持久化，重连后无法判断哪些已消费；重复投递可能重复触发刷新。

E5b 增加：

- `GET /api/events/replay?since=N&limit=M`：event_log 升序分页，返回 `headSeq / oldestSeq / hasMore / nextSince / reset / truncated`；
- mobile 持久化 `lastSeq`，断线重连先用 replay 补齐，再按 `seq` 去重；无法补齐（reset/truncated/请求失败）才走全量重拉；
- 明确消费者契约：**同一 seq 只应用一次；seq 缺失的瞬态帧（part.delta）不入日志、不推进游标**。

## 2. 非目标

- 不改 SSE 的 newest-window 回放语义（E2 已定；SSE 仍是 live + 最近窗口）。
- 不改桌面 SSE 游标/分级重同步（桌面已有 `?since` + `seq` 去重；E5b 只提供通用 replay，桌面接入留 E6）。
- 不做事件压缩/快照/状态物化（event_log 只存事件；状态仍由 REST 快照）。
- 不做 mobile UI 增量渲染（E6）；E5b 只保证事件补齐与幂等，页面仍可刷新。
- 不改 event_log 表结构/retention 策略。

## 3. Gateway：replay 端点

### 3.1 EventStore

新增：

```ts
replayAfter(since: number, limit: number): {
  rows: StoredEnvelope[];       // seq > since，升序，最多 limit
  headSeq: number;
  oldestSeq: number;            // 当前保留的最小 seq；空表 0
}
```

- SQL：`SELECT ... WHERE seq > ? ORDER BY seq ASC LIMIT ?`。
- `headSeq` = MAX(seq)，`oldestSeq` = MIN(seq)；异常 fail-open 返回空 + 0（与 `replaySince` 一致）。
- 不重置 `appendCount`，不做裁剪。
- `part.delta` 本就不入库，不占 seq。

### 3.2 路由

`GET /api/events/replay`（internal，非 SDK-facing）：

- 参数：
  - `since`：非负整数，缺省 `0`；非法 → 400 `{error:'invalid since'}`。
  - `limit`：1..1000，缺省 `500`（clamp；非数字 → 400）。
- 响应：
  ```jsonc
  {
    "events": [
      { "seq": 42, "ts": "2026-11-12T...", "type": "mafw_event", "sessionId": "ses_...", "envelope": { } }
    ],
    "headSeq": 100,
    "oldestSeq": 1,
    "hasMore": true,
    "nextSince": 42,
    "reset": false,
    "truncated": false
  }
  ```
- 语义：
  - `reset` = `since > headSeq`（DB 重置 / 新纪元）→ `events:[]`，客户端应全量重同步，游标置 `headSeq`。
  - `truncated` = `since + 1 < oldestSeq`（`since` 早于当前保留窗口，缺口无法补齐）→ 仍返回能读到的行，但客户端应全量重同步。
  - `hasMore` = 返回行数 `=== limit` 且最后 seq `< headSeq`。
  - `nextSince` = 最后一行 seq，否则 `since`（客户端循环用）。
- `envelope` 为 event_log 里原始事件对象；`type`/`sessionId` 为列投影。
- 鉴权：沿用普通 API（loopback / human / device / service）；不要求 human。
- 响应 schema：TypeBox `EventReplayResponse`，catalog `event.replay`，reachability guard 覆盖。
- 路由文件 `routes/events-replay.ts`，挂到 `attachAllRoutes`。

### 3.3 消费者契约

- 客户端按 `seq` 升序应用；`seq <= lastSeq` 丢弃（幂等）。
- `reset` / `truncated` / replay 请求失败 → 全量重拉（现有路径），并把游标置为 greeting/headSeq。
- `hasMore` → 继续用 `nextSince` 拉下一页，直到 false。
- 非持久事件（`part.delta`，seq 缺失）不推进游标；其丢失由会话消息 REST 对账补齐。

## 4. Mobile：游标 + 恢复

### 4.1 模型

`MafwEvent` 增加 `final int? seq`：优先取帧顶层 `seq`，否则取 `data['seq']`（canonical 内层）；`connected` greeting 的 `headSeq` 从 `data['headSeq']` 读取。

### 4.2 GatewayClient

新增：
```dart
Future<EventReplayPage> replayEvents({required int since, int limit = 500});
```
- 复用 `_get` + auth headers；解析响应为 `EventReplayPage(events, headSeq, oldestSeq, hasMore, nextSince, reset, truncated)`。
- `events` 为 `List<MafwEvent>`（`MafwEvent.fromJson(envelope)`，并把列级 `seq` 合并进模型）。
- 404/HTML → 视为不支持 replay（返回 null / 抛 `GatewayException`），调用方回退全量重拉。

### 4.3 EventRecoveryService

`mobile/lib/src/services/event_recovery.dart`：
```dart
class EventRecoveryService {
  EventRecoveryService({required Future<EventReplayPage?> Function(int since, int limit) fetch,
    required EventCursorStore cursorStore, required void Function(MafwEvent) emit,
    required void Function(RecoveryFallback reason) onFallback});
  Future<void> init();                 // load cursor
  void observe(MafwEvent e);           // record seq (max), persist debounced
  void observeHeadSeq(int? head);      // first-connect baseline
  Future<RecoveryOutcome> recover();   // loop pages; dedupe; reset/truncated/error → fallback
}
```
- `EventCursorStore`：SharedPreferences key `mafw_event_seq`（int）；可注入 memory store 测试。
- `recover()`：
  - cursor null → `noCursor`（首次连接，由调用方全量加载并 `observeHeadSeq`）。
  - 循环 `fetch(cursor, 500)`；对每个 `seq > cursor` 的事件 `emit`，更新 cursor；`hasMore` 继续；`reset/truncated` → `onFallback` + cursor=headSeq（或 0），返回 fallback；请求异常 → `onFallback`，保留旧 cursor（或 head？保留旧，下次重试）。
  - 去重：`seq <= cursor` 不 emit。
  - 不 emit `part.delta`（replay 本就不含）。
- `observe`：`e.seq != null && (cursor == null || seq > cursor)` 更新；持久化节流（如每 250ms/每 50 条；测试注入 clock）。
- `RecoveryOutcome { recovered, fellBack, reason, applied }`。

### 4.4 重连接线

`WsClientV2`：
- `onReconnected` 改为 `Future<void> Function()?`（或新增 `onBeforeReconnect` async），在成功后 **await** 回调，确保 replay 先于页面刷新。
- 新增 `void emitRecovered(MafwEvent event)`：把恢复事件送入 `_events`（未关闭时），与 live 帧同一消费面。
- `connected` greeting 触发 `observeHeadSeq`？由 `main.dart` 在事件流旁路处理，避免 WsClient 依赖 recovery。

`main.dart`：
- 创建 `GatewayClient` 后创建 `EventRecoveryService(fetch: client.replayEvents, cursorStore: ..., emit: ws.emitRecovered, onFallback: ...)`；`init()`。
- `ws.events.listen` 同时 `recovery.observe`（保留 `_workRefresh.onEvent`）。
- `_onReconnected` 改为 async：
  1. `await recovery.recover()`；
  2. `_workRefresh.onReconnected()` + `_connectionEvents.onReconnected()`（无论 recovery 是否成功，part.delta/状态仍需 REST 对账）；
  3. recovery fallback 时额外触发全量 `_refreshSessions()`（或由 `_connectionEvents` 已覆盖）。
- 首次连接：`connected` greeting 的 `headSeq` 作为 baseline（`observeHeadSeq`），不 replay；页面首载照旧。
- 游标持久化跨进程：App 冷启动重连时也能从上次 seq 恢复。

## 5. 测试

- Gateway：`replayAfter` 分页/空表/head/oldest/异常 fail-open；路由参数校验、reset/truncated/hasMore/nextSince、schema、reachability、鉴权。
- Mobile：`MafwEvent.seq` 解析（顶层/内层/缺失）；`EventReplayPage` 解析；`EventRecoveryService` 分页、去重、reset/truncated/异常 fallback、cursor 持久化/节流、首次无游标；`WsClientV2.emitRecovered` + async `onReconnected`；`main` 接线（widget/unit 可行范围内）。
- Contract：`flutter analyze` / `dart analyze`；`flutter test` 定向； gateway tsc/full 允许 env-red。
- 文档：`docs/architecture/gateway.md` E5b 段、`docs/architecture/mobile.md` 游标/恢复段、release 记录。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| replay 返回大量事件拖慢重连 | 分页 500；客户端循环；上限 1000；只在 reconnect 触发 |
| cursor 落后于 retention 导致静默漏事件 | `truncated` 显式信号 → 全量重拉；`reset` 同理 |
| 恢复事件与 live 帧重复 | 按 seq 去重；live 帧先/后到都只应用一次 |
| 恢复事件与页面刷新竞态 | `await recover()` 后再触发页面刷新；emit 与 live 同一 stream |
| WS 不支持 replay 的旧 gateway | 404/HTML → fallback 全量重拉，行为退化为现状 |
| 游标写放大 | observe 节流（250ms/50 条）；SharedPreferences 单键 |
| 事件顺序 | 升序 SQL + 客户端按 seq 应用；`nextSince` 单调 |

## 7. 交付边界

- E5b：gateway replay + mobile 游标/幂等/重连恢复。
- E6：desktop 单点扇出/实体缓存、事件→增量补丁、mobile 增量渲染；桌面接入 replay 可作为 E6 的可选优化。
