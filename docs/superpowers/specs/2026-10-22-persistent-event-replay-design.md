# 持久事件回放（Persistent Event Replay）设计

- 日期：2026-10-22（v2：builder check 三问题已并入——limit 截断契约、seq 双层放置、part.delta 不入库）
- 状态：v2（builder check 完成，裁决已并入）
- 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` Tier 1 #7（持久事件历史 + seq 游标续传——6/6 平台收敛，研究判定 MISSING/高价值）
- 范围裁决：缺口研究 Tier 1 #6（队列 inbox）与 #7（本设计）是两个独立子系统，拆开实施。**先做 #7**：它是地基（队列 inbox 的 queue_update 事件本身要骑在回放机制上），且根治的是已文档化的生产脆弱性。

## 1. 意图与为什么

gateway 的全局事件流（Mode A）是 desktop/TUI/WS/移动端 push 的唯一活通道，但**没有任何持久化**：gateway 重启、SSE 断线、watchdog 恢复 serve 期间重订阅（AGENTS.md §5.15：SSE 建立在 serve 之上，进程重启后必须重连）、订阅竞态——任何一处窗口期内的事件**永久丢失**。客户端重连后只能靠全量历史重拉兜底，回合中途的 part.delta/permission.asked/question.asked 交互窗口直接失明。

业界（研究 06 文档 §3 Tier 1 #7）：Codex `thread/readState` revision + backwardsCursor、dsh follow 游标流 + page 分页（断线以最后已提交 seq 无缺口续传）、opencode v2 `session.history/events` + seq 游标——**先重放后直播**已是收敛语义。

本设计在 **gateway 层**（而非依赖任何 runtime 原生能力）给 Mode A 加持久事件日志 + 断点续传。关键杠杆：**两个客户端（desktop 浏览器 EventSource、TUI Node undici 全局 EventSource）都原生实现了 WHATWG SSE 规范的重连语义——自动携带 `Last-Event-ID` 头**。服务端只需给每帧发 `id:` 字段并在重连时处理该头，**零客户端改动**即得断点续传。

## 2. 目标

- G1 Mode A 每帧带单调 `id:`（SSE 规范字段）+ 载荷内 `seq`（additive）+ WS 帧带 `seq`
- G2 `GET /api/events` 支持 `Last-Event-ID` 头与 `?since=N` 双入口 → **重放后直播**（replay-then-live），无重无漏
- G3 连接建立竞态消除：重放查询与直播流之间不丢不重（缓冲-排水模式，§5.3）
- G4 截断信号：`since` 早于留存窗口最旧 seq 时 greeting 带 `truncated:true`（客户端兜底走全量历史重拉；今日客户端忽略未知字段，天然优雅降级）
- G5 留存治理：按行数裁剪（默认 20_000），摊销式 prune，seq 用 AUTOINCREMENT 保证跨 DELETE 单调（防裁剪后 seq 重用与陈旧游标碰撞）
- G6 greeting 携带 `headSeq`（additive）——客户端可自检陈旧度
- G7 失败安全：EventStore 缺席/写失败 → broadcast 无 `id` 降级（现状行为），**启动顺序永不可能因事件日志而卡**（6e622ba5 教训：启动路径上的重活必须 fail-open）

## 3. 非目标 / 反目标

- **非目标**：客户端代码改动（Last-Event-ID 自动生效；TUI/desktop 显式 `?since` 采用留后续，服务端协议已备）；Mode B（`ChatSessionManager`/`message_delta`——侦察确认**零源码消费方**，死协议不投资）；runtime 级回填（serve 重启窗口内 opencode 自身丢的事件，opencode v2 `session.history/events` 消费留 Phase 2）；WS 通道的回放（WS 消费方是移动端 push 网关，重连语义由它自理，本批只加 seq 字段）；事件 schema 变更（信封原样存储）
- **反目标**：每客户端独立游标会话状态（服务端无状态——游标在客户端，`Last-Event-ID`/`?since` 自带）；改 `mafwBroadcast` 信封形状（desktop 剥壳逻辑不动）；事件日志写失败阻塞 broadcast（fail-open 是硬约束）

## 4. 约束

- C1 broadcast 在 per-token delta 热路径上：seq 分配必须同步 O(微秒)（better-sqlite3 同步插入 ~2µs，每回合 ~2000 delta ≈ 4ms 总开销，可接受）；memory worker 的 token 噪音已在 broadcast 前丢弃（index.ts:1222），无洪水
- C2 `gateway.db`（WAL）为既有持久层；单写者（单实例守卫 + TAKEOVER 接力），无并发写
- C3 SSE wire 契约：desktop `assertShellEventCoverage` 三层守卫 + TUI 第四道弱守卫——`id:` 是 SSE 传输层字段（不进 JSON 载荷的既有键），`seq` 为 additive 新键，均不触词表
- C4 测试基线：gateway 334 套件 / desktop 1131 / tui 220 / adapter 24（工具面 MCP 对齐后全绿基线）

## 5. 设计

### 5.1 EventStore（新模块 `gateway/src/events/event-store.ts`）

```typescript
export class EventStore {
  constructor(db: BetterSqlite3.Database);          // 注入 gateway.db 句柄（测试可 :memory:）
  append(envelope: { type: string; [k: string]: any }): number | null;  // 同步插入，返回 seq；失败/非持久类型 null（fail-open）
  headSeq(): number;                                // 当前最大 seq（0 = 空）
  replaySince(since: number, limit: number): { rows: StoredEnvelope[]; firstReplayedSeq: number | null };
  maybePrune(retention: number, everyN = 1000): void; // 摊销裁剪（每 N 次插入执行一次 DELETE）
}
```

**非持久类型（v2 裁决 Q3）**：`part.delta` 不入库、不占 seq。理由：per-token delta 是唯一可从 `part.updated` 快照重建的事件（desktop part-upsert reducer 天然调和、TUI UpdatableBlock 快照替换契约同理）；入库则 20k 留存窗口按每回合 ~2000 delta 计只有 ~10 回合的有效覆盖（分钟级），剔除后窗口放大 10-50×，留给不可重建的事件（permission.asked / question.asked / turn.* / part.updated 快照）。连带推论：**seq 空间只由持久事件消耗**（连续无空洞）——`firstReplayedSeq > since + 1` 的截断检测因此保持可靠（若非持久类型也占 seq，跳号会成为常态，截断信号失效）。非持久类型的直播帧无 `id:` 行（EventSource 保留上一 id，重连语义不受影响），排水时按"无 seq 帧直接写出"处理（§5.3）。

表（gateway.db DDL 追加）：

```sql
CREATE TABLE IF NOT EXISTS event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,   -- ⚠️ AUTOINCREMENT 必须显式：普通 rowid 在全删后会从 1 重用，
  ts TEXT NOT NULL,                        --    与客户端陈旧 lastEventId 碰撞 → 回放漏帧。AUTOINCREMENT 保证跨 DELETE 单调。
  type TEXT NOT NULL,
  session_id TEXT,
  envelope TEXT NOT NULL                   -- broadcast 收到的完整信封（post-mafwBroadcast 形状）原样 JSON
);
CREATE INDEX IF NOT EXISTS idx_event_log_session ON event_log(session_id, seq);
```

`append` 同步执行：`INSERT ... RETURNING seq`（better-sqlite3 支持 RETURNING；不支持则 `lastInsertRowid`）。`envelope` 存 broadcast 入参原样（含 `properties`/`sessionID`/`directory`）——回放时补 `timestamp` 字段与直播帧同形（broadcast 现行为：`{...event, timestamp}`）。

### 5.2 broadcast 单点接线（index.ts:2782）

```
broadcast(event):
  1. seq = eventStore?.append(event) ?? null        ← 失败/缺席/非持久类型(part.delta) → null（fail-open）
  2. enriched = { ...event, timestamp: now, ...(seq !== null ? { seq } : {}) }
     if (enriched.data �� object) enriched.data = { ...enriched.data, seq }   �� v2 �þ� Q2��˫�����
  3. SSE 帧 = `id: ${seq}\n` + `data: ${JSON.stringify(enriched)}\n\n`   （seq null 时省略 id: 行）
  4. WS 帧 = enriched（seq additive）
  5. pushGateway.onBroadcast(enriched)
  6. eventStore?.maybePrune(cfg.retain, cfg.everyN)  ← 事件计数驱动，不挂定时器
```

**seq 双层放置（v2 裁决 Q2）**：broadcast 流过两种形状——mafw_event 信封（`{type:'mafw_event', data:{...}}`）与扁平事件（runtime_switched / project_registered / goal_node 等，AGENTS.md §5.6 明约**必须扁平无 data 键**）。两个活消费方剥壳后分发（desktop `raw?.data || raw`、SDK `data.data`）——信封级 seq 剥壳后不可见。因此 seq 同时放在：**顶层**（扁平事件消费方可见）+ **data 内**（信封事件消费方可见）。注入发生在 mafwBroadcast() 返回**之后**，不改信封构造函数——与顶层 timestamp 同为 post-constructor additive 键先例，不违 §3 反目标。

store 写入的内容 = broadcast 入参（step 1 在 enrich 之前取原始形状）——回放时以同式补 timestamp + 双层 seq，与直播帧逐字节同形。

**接线时机**：initServices 里 GatewayDatabase 打开之后立即 `new EventStore(gatewayDb.db)`，`startApiServer` 之前。store 缺席（极早期/构造失败）时 broadcast 全路径 fail-open——启动顺序不可能因事件日志而卡（G7）。

### 5.3 回放协议（GET /api/events Mode A 分支）

**入口**（优先级从高到低）：
1. `?since=N` 查询参数（显式；`N` 为非负整数，`0` = 回放留存窗口内全部可回放事件）
2. `Last-Event-ID` 请求头（原生 EventSource 重连自动携带；TUI 经 npm `eventsource@^3` polyfill，其重连同样携带——builder check 已核 polyfill `EventSource.ts:451`）
3. 都无 → 纯直播（现状行为）

解析失败/垃圾值 → 视为无游标（fail-open 纯直播，不 400——陈旧客户端不应因协议新字段被拒）。

**回放选取（v2 裁决 Q1：newest-window 契约）**：回放范围 `(since, headSeq]` 内取**最新** `min(limit, 可用)` 行，按 seq 升序写出。截断信号统一为一条规则：

- greeting 携带 `headSeq` 与 `firstReplayedSeq`（本次回放首行 seq；无回放为 null）
- **`truncated:true` ⟺ firstReplayedSeq ≠ null 且 firstReplayedSeq > since + 1**（limit 截断与留存窗口淘汰是同一形状：客户端游标与回放起点之间有洞），或范围内本应有行却全被留存窗口淘汰
- 客户端规则（将来显式采用时）：`truncated` → 全量历史重拉补洞；否则从 firstReplayedSeq 起连续覆盖到直播，无洞

正确性要点：newest-window 保证回放尾行 = headSeq，与直播续流**天然无缝**（buffer 排水只放 seq > maxReplayed 的帧，直播帧 seq > headSeq，恰好衔接）；洞（若有）在回放**起点**一侧，由 `firstReplacedSeq` 显式暴露——对比 v1 草案的 oldest-first + limit（洞在中间且不可检测，正是本特性要消灭的静默丢失模式）。

**竞态消除（缓冲-排水）**——重放查询与直播到达之间的窗口不能丢事件、不能重复：

```
attach(res):
  1. buffer: unknown[] = [];  buffering = true
     listener = (frame) => buffering ? buffer.push(frame) : res.write(frame)
     sseClients 加入 res（用同一 listener 语义）
  2. { rows, firstReplayedSeq } = eventStore.replaySince(since, limit)   ← 同步 better-sqlite3 查询
  3. 逐行写 `id: <seq>\ndata: <envelope+timestamp>\n\n`
  4. buffering = false
  5. drain: buffer 中 seq > maxReplayedSeq 的帧写出（≤ 的丢弃——重放已覆盖）；
     无 seq 的帧（part.delta 等非持久类型 / store 失败窗口期）→ 直接写出（宁重勿漏，消费方幂等）
  6. greeting 在步骤 3 之前写出（SSE 头 + connected 事件，含 headSeq/firstReplayedSeq/truncated）
```

正确性论证：broadcast 的 append 与 SSE 写出在**同一线程同步序列**内（better-sqlite3 同步 + broadcast 同步函数，builder check 已核 2782-2799 无 await）——listener 挂上后，任何后续 broadcast 必先进 buffer 或直接写；重放查询读到的是挂 listener 那一刻的 DB 状态，与 buffer 起点之间存在**全序**。实现约束：attach 的 1-5 步之间不得有 await 让出点（better-sqlite3 同步查询天然满足）。

**greeting 扩展**：`{ type:'connected', timestamp, vocab:'v2', headSeq, firstReplayedSeq?, truncated? }`（additive）。greeting 不持久化不经 broadcast（路由内直写，现状不变）。

### 5.4 配置

`config.ts` 的 `events` 段（env 前缀 `MAFW_EVENTS_*`，默认值单源在 config）：

```yaml
events:
  persist: true        # false = EventStore 不构造（纯直播，现状行为；测试/最小部署用）
  logRetention: 20000  # 留存行数（按 seq 裁剪）
  replayLimit: 2000    # 单次回放上限（防巨量重放卡连接）
  pruneEveryN: 1000    # 摊销裁剪间隔（每 N 次 append 触发一次 prune 检查）
```

体积估算：20k 行 × 均 ~1KB（part.updated 含 tool 快照）≈ 20MB 上限，`~/.mafw/memory/gateway.db` 可承受。

### 5.5 Mode B 与 WS

- **Mode B 不动**：`ChatSessionManager`（message_delta 通道）侦察确认零源码消费方（grep 全 packages 源码仅 dist/node_modules 噪音命中）——死协议，注释标注 deprecated 即可，不投资。
- **WS 只加 seq**：`handleWsMessage` 的对向通道不变；WS 广播帧带 additive `seq` 字段（移动端将来可用），回放语义不做（WS 消费方 push 网关自理重连）。

## 6. 测试策略（TDD）

1. **EventStore 单测**：append 分配单调 seq；headSeq/oldestRetained；replaySince 边界（since=0 全量/超窗口截断/limit 截断）；prune 后 seq **不重用**（AUTOINCREMENT 钉扎——最易回归的细节）；append 失败（坏 db）返回 null；part.delta 不入库不占 seq（seq 空间连续性钉扎）；replaySince 的 newest-window 语义与 firstReplayedSeq（limit 截断 / 留存淘汰 / 全覆盖三态）
2. **broadcast 集成**：seq 出现在 SSE `id:` 行 + 载荷 `seq` 键 + WS 帧；store 缺席时无 `id:` 行（现状形状）
3. **回放端到端**：写入 N 事件 → 新连接 `Last-Event-ID: k` → 收到 seq k+1..N 的重放 + 后续直播；`?since=` 参数等价
4. **竞态钉扎**：连接建立后立刻连续 broadcast（同步突发，混排 part.delta 无 seq 帧与持久类型有 seq 帧）→ 客户端收到集合 = 恰好全部持久事件一次 + delta 帧不重不漏（无 seq 帧排水规则）
5. **截断信号**：prune 到窗口外 → 重放带 truncated:true + oldestRetained
6. **fail-open**：persist=false / store 构造抛错 → broadcast/启动照常
7. 四套全量回归（C4 基线）

## 7. 我做的裁决（builder check 重点核对）

1. **gateway 层而非 runtime 层**：回放的根本场景（gateway 重启/SSE 断线/订阅竞态）都在 gateway 自己的管辖内；runtime 级回填（serve 重启窗口）留 Phase 2 消费 opencode v2 原生 history/events——不重复造 runtime 已有的东西。
2. **零客户端改动**：WHATWG EventSource 重连语义（`Last-Event-ID`）——浏览器端原生成立；TUI 实际跑 npm `eventsource@^3` polyfill（builder check 核实其 `EventSource.ts:451` 重连携带该头）。已知残余：TUI 监督环长断开路径（connection.ts 退避重订 = 全新连接）会丢游标——显式 `?since=` 采用留 TUI 后续小改。风险对冲不变：`?since=` 协议第二入口已备。
3. **AUTOINCREMENT 显式**：普通 rowid 表在全删后从 1 重用 seq——与陈旧游标碰撞会静默漏帧。这是本设计里最隐蔽的正确性细节，测试 #1 钉扎。
4. **缓冲-排水而非双阶段锁**：attach 的 1-5 步在无 await 区间同步完成（better-sqlite3 同步查询），单线程全序免锁。
5. **greeting 不持久化**：per-connection 握手不是流事件；headSeq 只作参考信息（计算时刻与 attach 时刻有微竞态，不影响正确性——回放正确性只由 §5.3 论证保证）。
6. **宁重勿漏**：store 失败窗口期的无 seq 帧在排水时直接写出（消费方按消息幂等处理，今日语义本就如此）。
7. **Mode B 判死**：零消费方证据（grep）；只加 deprecated 注释不删（desktop dist 可能残留历史引用，物理删除留给 desktop 会话）。
8. **（v2 Q1）回放 = newest-window + firstReplayedSeq 截断契约**：回放范围 (since, headSeq] 内取最新 min(limit, 可用) 行升序写出，回放尾行恒 = headSeq 与直播无缝衔接；洞只在回放起点一侧，由 greeting 的 firstReplayedSeq 显式暴露（truncated ⟺ firstReplayedSeq > since + 1）。否决 v1 草案的 oldest-first + limit——那会把洞留在中间且不可检测，正是本特性要消灭的静默丢失模式。
9. **（v2 Q2）seq 双层放置**：顶层 + data 内（当 data 是 object）。信封级 seq 剥壳后不可见（desktop/SDK 两消费方都剥壳），单放顶层则 G6 客户端自检不可达。注入在 mafwBroadcast() 之后，不违信封形状反目标。
10. **（v2 Q3）part.delta 不入库不占 seq**：delta 可从 part.updated 快照重建（desktop part-upsert / TUI UpdatableBlock 快照替换），入库则 20k 窗口只剩 ~10 回合覆盖；剔除后窗口放大 10-50× 留给不可重建事件。连带推论：seq 空间只由持久事件消耗（连续无跳号），firstReplayedSeq 截断检测因此可靠——非持久类型若也占 seq，跳号成常态、截断信号失效。

## 8. 留给 builder 的

- EventStore 构造的具体接线点（initServices 内 GatewayDatabase 打开后；`gatewayDb.db` 句柄暴露方式——若 GatewayDatabase 无公开句柄则加 `getStore(): BetterSqlite3.Database`）
- attach 缓冲实现形态（sseClients Set<res> 当前直接 write——需要包一层 per-connection 状态；评估是否抽 `SseConnection` 小类还是 Map<res, {buffer, buffering}>）
- replaySince 的 rows 映射成帧的精确构造（timestamp 补齐与直播同式）
- greeting headSeq 的取值时刻（写头之前取一次即可）
