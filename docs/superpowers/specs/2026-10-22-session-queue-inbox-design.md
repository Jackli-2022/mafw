# 会话队列 Inbox（Session Queue Inbox）设计

- 日期：2026-10-22（v2：builder check 三裁决并入——拦截点改 withIdentityPrompt 咽喉、busy 防楔死机制、G6 迁移目标修正）
- 状态：v2（builder check 完成，裁决已并入）
- 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` Tier 1 #6（服务端队列/inbox——取消/幂等/可见 + steer 并发前置，5/6 平台收敛，判定 PARTIAL/高价值）；地基：持久事件回放（`2026-10-22-persistent-event-replay-design.md`，queue 事件骑其上）

## 1. 意图与为什么

gateway 的 prompt 投递在 **busy/abort 边界**不可靠且不可见：

- **丢失路径**：goal driver / milestone-push / 自更新通知等 fire-and-forget 调用落在 busy 会话上时，行为取决于各 runtime 的内部处理（pi followUp 队列丢 noReply 语义——AGENTS.md 已文档化；claude adapter 自有队列；opencode 原生语义我们未消费）——**没有一个统一的、可依赖的语义**
- **不可见**：队列状态对 desktop/TUI 完全黑盒（无事件、无端点）——用户不知道自己的消息在排队
- **不可控**：无法取消已排队消息（排错了只能等它执行）
- **不幂等**：goal watchdog 重试/网络重发会双发

业界（研究 06 §3 #6）：opencode v2 持久 inbox（`delivery:'queue'`/可取消/幂等 id）、pi+dsh steer/followUp 双队列 + queue_update 事件 + clear_queue——**服务端队列语义已成收敛**。

本设计在 **gateway 核心**建统一队列：`delivery:'queue'` 的 prompt 在会话 busy 时由 gateway 拦截入队，回合终态自动续发，全程事件可见、可取消、幂等。

## 2. 关键裁决：gateway 核心队列而非 runtime 透传

三个候选：

| 方案 | 否决理由 |
|---|---|
| 透传 opencode 原生 inbox | SDK 1.18/1.19 的 `Session2.prompt` 参数无 `delivery`（落后 CLI 2.1.x 服务端）；inbox 管理端点在 OpenAPI-only 面（directNative 可达但成本高）；pi/claude 无对等面 → 三套实现 |
| adapter 级队列（claude 先例推广） | 三份重复实现 + 队列状态散落 + 事件/管理面仍需 gateway 统一 |
| **gateway 核心队列（选定）** | 单实现跨全部 runtime；事件/管理天然统一；**adapter 零改动**——`delivery:'queue'` 在 gateway 拦截，adapter 永远只收到 idle 会话的普通 promptAsync |

**方言自洽红利**：busy prompt 被 gateway 拦截 → opencode 永远不会在 busy 时收到 prompt → opencode 侧永不排队 → `session.next.prompted ≈ prompt.admitted`（无时差）→ **现有 @v2 方言映射（prompted→turn.started，admitted→drop）自动保持正确**。若走透传方案反而要修方言的 queued-prompted 误报 turn.started 问题。

## 3. 目标

- G1 契约：`SessionPromptOpts.delivery` 增 `'queue'`（与 `'steer'`/`'followup'` 并列）+ `idempotencyKey?: string`——两者均 gateway 层消费，adapter 透传容忍（忽略未知字段）
- G2 SessionQueue：per-session FIFO（内存态），busy 拦截入队 + 回合终态续发（每次终态 flush 队首一条，串行回合）
- G3 `queue.updated` canonical 事件：入队/出队/取消/清空全广播（经 broadcast → 自动持久化进 event_log → **骑回放地基**）；载荷含 items 全量快照（UI 单事件自足）
- G4 管理面：`GET /api/session/:id/queue`（列表）、`DELETE /api/session/:id/queue/:itemId`（取消单条）、`DELETE /api/session/:id/queue`（清空）
- G5 幂等：`idempotencyKey` 在**排队窗口内**去重（同 key 已在队 → 返回既有 itemId，不入队不报错）
- G6 示范迁移（v2 Q3 修正）：**milestone-push + 自更新通知 + BudgetGuard notify** 三个 notify 型调用点切 `delivery:'queue'`（丢失路径的实效兑现；全部直调 runtime.session.promptAsync——v2 Q1 咽喉天然覆盖）。~~goal driver~~（builder check 证伪：executeNode 建新会话后立即 prompt，永不 busy，queue 是语义 no-op——移出 G6）
- G7 busy 追踪：gateway 从事件流维护 per-session busy 状态（`turn.started` 起、三终态止）

## 4. 非目标 / 反目标

- **非目标**：持久化（gateway 重启丢队列——窗口小且 opencode 原生 inbox 覆盖 serve 重启场景；将来需要时 kv 序列化补）；opencode 原生 inbox 消费（SDK 补齐后再评估直通）；重排（dsh 有 updateQueue，我们 YAGNI——取消+重发即可）；desktop/TUI 队列 UI（事件已备，渲染留后续）；`resume:false`（仅入队不执行的变体——goal 编排暂无需求）
- **反目标**：改变 `delivery:'steer'`/默认投递的既有行为（steer 语义原样透传——gateway 只在显式 `'queue'` 时拦截）；队列在 idle 会话上截留（idle → 立即直发，队列只对 busy 生效）；flush 一次倒空队列（会撞 runtime 自身 busy 处理，串行一条才是正确语义）

## 5. 设计

### 5.1 busy 追踪（index.ts handleRuntimeEvent）+ 防楔死（v2 Q2）

`private busySessions = new Map<string, number>()`（value = busy 起始时间戳）：`turn.started` → set；`turn.completed/failed/aborted` → delete + 触发该会话队列 flush。

**防楔死机制（v2 Q2 裁决）**：`turn.started`→终态配对是本设计首个消费者（矩阵行标注 passthrough/ignore——无既有消费者证明配对可靠）。**noReply（expectReply:false）prompt 是否触发 prompted-无回合序列未经证实**（静态不可判定；CLI 升级也可能改变语义）——若发生，busy 永久楔死 → 后续 queue prompt 静默堆积且永不 flush（比今日更糟）。防御：

- **busy 陈旧清扫**：既有周期清扫（heartbeat sweep 30min 或独立 60s interval）清 busyStaleMs（默认 15min）以上的 busy 条目 + warn 日志——假 busy 的最大损害 = 15 分钟排队后自动恢复
- **队列项 TTL**：itemTtlMs（默认 24h）——过期项 cancel + queue.updated(action:'expire')——孤儿消息不无限堆积

竞态边界（诚实记录）：promptAsync 发出 → `turn.started` 事件到达前的窗口内，gateway 视为 idle——此时第二个 prompt 直发，行为退化为**今日现状**（runtime 自身处理 busy），不会更糟。此窗口毫秒级且自愈。

### 5.2 SessionQueue（新模块 `gateway/src/core/session-queue.ts`）

```typescript
export interface QueuedItem {
  id: string;                    // q_<uuid>
  sessionID: string;
  text?: string;                 // message 形态（与 parts 二选一，与 promptAsync 入参一致）
  parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  agent?: string;
  model?: { providerID: string; modelID: string };
  idempotencyKey?: string;
  enqueuedAt: string;            // ISO
  source: string;                // 'http' | 'goal' | 'milestone' | 'self-update' | ...
}

export class SessionQueue {
  enqueue(sessionID: string, item: Omit<QueuedItem, 'id' | 'enqueuedAt'>, opts: { maxPerSession?: number }): { item: QueuedItem } | { duplicate: QueuedItem } | { rejected: 'limit' };
  dequeue(sessionID: string): QueuedItem | null;
  cancel(sessionID: string, itemId: string): QueuedItem | null;
  clear(sessionID: string): QueuedItem[];
  list(sessionID: string): QueuedItem[];
  size(sessionID: string): number;
}
```

纯类（Map<sessionID, QueuedItem[]>），无 IO——事件发射与 flush 编排在 index.ts 接线层。

上限：per-session 默认 32 条（超限 `rejected:'limit'` → HTTP 400 显式拒绝，不静默丢弃）。

### 5.3 拦截点（v2 Q1 裁决：withIdentityPrompt 咽喉）

builder check 证伪了 v1 的"facade 单点"声明：~14 个 promptAsync 调用点只有 2 个（HTTP 路由 + goal driver）走 sdkSession facade，其余（WS send / enriched chat / milestone-push / 自更新通知 / BudgetGuard notify / mafw-commands / waitwhat / conformance / media executor）全部直调 `this.runtime.session.promptAsync`。**真正的咽喉是 `wrapRuntimeIdentity`（index.ts:1496-1508）应用的 `withIdentityPrompt` 包装器**——runtime 创建点（1427/1467）即包装，所有调用方（含 conformance/eval/media harness）都经过它。

拦截组合进 `withIdentityPrompt` 的 promptAsync 包装，**仅当 `opts.delivery === 'queue'` 且 busy 时入队**——显式 opt-in 使 harness 调用方（从不传 queue）零影响，**无需排除清单**：

```
promptAsync(sessionID, text, parts, agent, model, opts?):   // opts 增量形参（delivery/idempotencyKey）
  if (opts?.delivery === 'queue' && busySessions.has(sessionID)) {
    const r = queue.enqueue(...)
    duplicate → 返回既有 item（200，幂等兑现）
    rejected → 抛 400（HTTP 层转译）
    item    → emit queue.updated + 返回 { queued: true, itemId }
  } else {
    原路径直发（idle 或非 queue 交付——steer/默认/followup 行为不变）
  }
```

HTTP 路由 body 增 `delivery`、`idempotencyKey` 解构；`{ queued: true, itemId, position }` 响应（additive，直发路径响应形状不变）。

### 5.4 flush 编排（handleRuntimeEvent 终态分支）

三终态（completed/failed/aborted）→ `dequeue(sessionID)` 有项 → **异步**经原 promptAsync 语义直发（剥离 delivery/idempotencyKey——已出队）→ emit queue.updated（removed）。串行保证：flush 发出后 busySessions 将被下一 `turn.started` 重新置位；若 flush 后无新 turn（如 noReply 消息），队列下一项在下一次终端事件续发——**每终态一条**。

异步而非同步：事件处理器内同步调 runtime.promptAsync 可能与事件流处理互锁（pi 的 promptAsync 在 idle 会话 await 到回合结束——**绝不能 await**，`void` fire-and-forget + catch 记日志）。

### 5.5 事件与管理面

- `queue.updated`（canonical 新词）：`{ sessionID, items: QueuedItem[], action: 'enqueue'|'dequeue'|'cancel'|'clear', itemId? }`——items 全量快照（UI 单事件自足，且经 broadcast 持久化骑回放）。词汇单源 `mafw-vocabulary.ts` + SDK events union + 矩阵 + desktop `assertShellEventCoverage` + TUI KNOWN_EVENTS（三层守卫链 + 第四道，全部跟随——canonical v3 既有纪律）
- 路由：`GET/DELETE /api/session/:id/queue`、`DELETE /api/session/:id/queue/:itemId`（loopback 门与既有会话路由一致；route-catalog 登记 + 契约重生成）
- SDK（builder check 确认并行会话已收口、client.ts 干净）：`MafwClient.session.queueList/queueCancel/queueClear` + `SessionPromptOpts` 类型扩展**本批入计划**
- `queue.updated` 进 `MAFW` map（gateway 合成事件，`usage.updated` 先例——非 flat 直发列表）

### 5.6 契约注释语义

`SessionPromptOpts.delivery: 'steer' | 'followup' | 'queue'`：
- `'steer'`（默认，现状）：busy 时注入进行中回合（opencode steer / pi streamingBehavior）
- `'followup'`：pi 语义，busy 时 runtime 内部队列
- `'queue'`：**gateway 拦截**——busy 时入 gateway 队列（可见/可取消/幂等），回合终态自动续发；idle 时等价直发

`idempotencyKey`：排队窗口内去重（flush 后失效——不承诺跨回合幂等）。

## 6. 测试策略（TDD）

1. SessionQueue 纯类单测（enqueue/dequeue/cancel/clear/list/上限/幂等 dup 路径）
2. 拦截 wiring：busy + queue → 入队 + queue.updated 广播 + `{queued:true}`；idle + queue → 直发；busy + steer → 直发（现有行为）
3. flush：终态后队首续发一条、串行（两条排队 → 两终态各发一条）；noReply 等 opts 保全
4. 幂等：同 key 二次 → duplicate 返回既有 id，队列不增长
5. 管理路由：list/cancel/clear + queue.updated 事件
6. 词汇守卫：SDK union ↔ 矩阵 ↔ desktop coverage ↔ TUI KNOWN_EVENTS 全含 queue.updated
7. 回放集成：queue.updated 经 broadcast 进 event_log（已有管线自动覆盖——一条断言钉扎）
8. 四套全量回归

## 7. 我做的裁决（builder check 重点核对）

1. **gateway 核心队列**（§2）：单实现跨 runtime、adapter 零改动、方言自洽红利（busy prompt 不达 opencode → prompted≈admitted → 现有映射无需修）。代价：gateway 重启丢队列（§4 非目标，窗口分析）。
2. **每终态 flush 一条**（§5.4）：一次倒空会撞 runtime busy 处理（双队列竞态）；串行一条语义正确且对齐 TUI 客户端队列先例。
3. **flush 异步 fire-and-forget**：pi promptAsync 在 idle 会话 await 到回合结束——事件处理器内 await 会互锁。
4. **上限 32 显式 400**：静默丢弃比拒绝更糟（goal 重试语义需要明确的失败信号）。
5. **幂等窗口 = 排队期**：跨回合幂等是 runtime/会话层职责，gateway 队列只承诺排队窗口（goal watchdog 重试的实际窗口正是排队期）。
6. **items 全量快照入事件载荷**：UI 单事件自足（不需要 diff 计算）；事件经 broadcast 持久化，回放后 UI 可直接重建队列视图。
7. **示范迁移只挑 notify 型调用方**（milestone-push / goal driver 的通知 prompt）：用户交互路径（desktop/TUI composer）继续走客户端本地队列（服务端队列对它们是后续增量），避免一次改动两个交互范式。
8. **（v2 Q1）拦截点 = withIdentityPrompt 咽喉**：显式 opt-in（delivery:'queue'）使全部 ~14 调用点零改动覆盖且 harness 无需排除。若错选 facade 方案则 G6 三站点需逐个 reroute + 未来新调用点持续漏网。
9. **（v2 Q2）busy 防楔死优先于配对验证**：noReply-配对语义静态不可判定且随 CLI 版本漂移——清扫机制（15min busy TTL + 24h item TTL）把假 busy 最坏损害限制为"15 分钟排队延迟"，无论配对真实与否。宁可防御也不赌运行时行为。
10. **（v2 Q3）G6 迁移目标以调用图为准**：goal driver executeNode（新会话永不 busy）移出；milestone-push + 自更新 + BudgetGuard notify（真正暴露于 busy 边界的三个 notify 路径）移入。

## 8. 留给 builder 的

- flush 的具体挂点（handleRuntimeEvent 终态分支 vs goalDriver 旁的独立 listener——倾向前者，单点）
- sdkSession.promptAsync facade 的 opts 形参向后兼容方式（追加可选参数 vs opts 对象化——看现有调用方数量）
- queue.updated 是否需要 TUI/dispatcher 侧最小消费（漏接线检测 isTailAccountedAtShell 会不会拦未知事件——查 dispatcher 的 missTrace 行为）
- route-catalog + SDK 契约重生成的具体步骤（emit:openapi + gen:api 既有流程）
