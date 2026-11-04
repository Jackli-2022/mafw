# Pod 事件层与常驻注意力设计

日期：2026-11-04
状态：**已定稿**——两轮 glm-5.3 评审（2C/8I/6M + 1C/6I/8M）全部回写（§12/§13），并已合并同日 composer/rail 批次移交的 attention 通知链（§14）。尚未写 plan。
关联调研：
- `docs/research/2026-11-04-superagent-multichannel-info-grading-research.md`
- `docs/research/2026-11-04-ambient-progress-indicators-research.md`

---

## 1. 问题

实证（2026-11-04 冒烟 Goal `goal-20261104-032632-7bd086`）：

1. Goal 在 04:17 归档为 `done / PASS`，**用户始终不知道已经完成**——最后是靠 CDP 脚本轮询发现的。
2. Lead 只有在用户对它说话时才读消息：`PodMessageDelivery.decide()` 只对 live coordination 会话 `push`，其余全 `pending`；而 **Lead 的 coordination 会话没有任何 pull 路径**（`claimPendingForSession` 只在 driver 节点 prompt 时调用）。
3. 系统其实「知道」：`pod_goals.verdict` 已落库、`resultReady=true`、`pod.updated {kind:'result'}` 已广播。缺的是**事件身份**与**注意力路由**。
4. 跨项目的完成事件**今天被静默丢弃**：`MafwShell.handlePodResultEvent` 在 `detail.pod.id !== info.podId` 时直接 return（MafwShell.tsx:2001-2005）。

一句话：**事实层有，路由层没有，注意力层自然没有。**

## 2. 目标 / 非目标

**目标**
- 用户说「不知道它在跑 / 跑完了」不再发生：常驻、不抢焦点、完成不消失、**跨项目**。
- Lead 能被事件叫醒（不需要用户先开口），但有预算、去重、恢复与暂停闸门，不刷屏、不闯运行态。
- 事件在 Pod 里是一等对象，人 / agent 两个投影共用同一份。

**非目标（v1 明确不做）**
- 不做 LLM 语义慢判（Slow Path）——分级全部走确定性规则。
- 不做手机 / TUI / web 端；只预留投影接口。
- 不把任务状态写进谐波记忆。
- 不做托盘逐帧动画。
- **事件不外投 A2A**（A2A 仍只承载既有 `pod_messages`；见 §3.3）。

**反目标**
- 任何「用户没看就反复提醒」的机制。
- 任何需要用户配置才能工作的默认路径。

## 3. 核心模型

### 3.1 一条事件

```ts
type PodEventSeverity = 'p1' | 'p2' | 'p3'   // p0 不落事件表（见 §3.2）

interface PodEvent {
  id: string                 // evt_<ts>_<rand>
  podId: string
  projectId: string          // canonical project key，给跨项目 presence 用
  goalId?: string | null
  revision?: number | null
  kind: string               // goal.result / goal.ended / member.request / member.escalation / node.started / wake.suppressed
  severity: PodEventSeverity
  reason: 'decision' | 'result' | 'blocked' | 'progress' | 'message'
  title: string              // ≤80 字，一行
  summary?: string | null    // 展开面用：结论 / 证据 / 下一步
  refs?: { kind: string; id: string }[]
  dedupeKey: string          // 见下表，必须含身份维度
  audience: 'human' | 'lead' | 'none'
  state: 'unread' | 'seen'   // v1 只有两态；done 无生产者，不暴露
  wakeState: 'none' | 'pending' | 'delivered' | 'suppressed'
  wakeAttempts: number
  wakeAt?: string | null
  wakeSessionId?: string | null
  createdAt: string
  seenAt?: string | null
}
```

### 3.2 存储：DB 是运行时真相，文件是审计

- **`pod_events` 表**（DB）= 运行时真相，含 `state` / `wakeState`。`UNIQUE(pod_id, dedupe_key)` 提供幂等。
- **文件** `~/.mafw/pods/<podId>/events/<createdAt>-<id>.json` = **创建时写一次的不可变审计快照**，不含 state。写盘失败只记日志，不影响可用性。
- 写序：DB insert（唯一键冲突即幂等返回）→ 文件 best-effort。
- 重启对账：以 DB 为准；文件缺失不重建事件。`reindex()` 仅灾备用，重建出的事件 `state='unread'`、`wakeState='none'`——**这一点写进运维说明，不假装无损**。

> 澄清：用户说的「任务还是文件形式」指 **Pod 任务**（`waves.json` / `pod_tasks` 投影），那部分不变。事件是**新增**的注意力对象，不占用任务文件格式。

### 3.3 三个投影

| 投影 | 消费者 | 形式 |
|---|---|---|
| 人 | Desktop（工作台 inbox / rail / 托盘 / 任务栏 / OS 通知） | `GET /api/pods/:id/events` + `pod.event` SSE |
| 本 Pod agent | Lead / Builder / Reviewer | `[POD EVENT]` 显式 prompt 注入（§4） |
| 外部 agent（A2A） | — | **v1 不外投**。`pod_messages` 的 A2A 通道（`PodA2AAgent` / `pod_a2a_links`）保持原样，事件层不接。 |
| 记忆 | 谐波检索 | 不投影（v1） |

### 3.4 分级（确定性规则，Fast Path）

| 来源 | 判定 | severity | audience | dedupeKey |
|---|---|---|---|---|
| Goal 归档，`verdict ∈ {PASS, FAIL, MAX_RETRIES, ERROR, UNREVIEWED}` | **`finishPodGoal`** | p1 | human | `goal.result:<goalId>:r<revision>` |
| Goal 归档，`verdict = null`（纯 ended）或 `CANCELLED`（用户取消 / `cancelQueued`） | `finishPodGoal` / `cancelQueued` | p3 | none | `goal.ended:<goalId>:r<revision>` |
| 成员消息 `kind ∈ {request, escalation}` 且 `to=lead` | **`PodStore.insertMessage`**（唯一收口点） | p2 | lead | `member.<kind>:<messageId>:<toMemberId>` |
| 成员消息其他 kind（note/review/decision） | 同上 | p3 | none | 同上 |
| 节点 started / finished | 轨迹 | p3 | none | `node.<transition>:<goalId>:<loop>:<node>:a<attempt>` |
| 唤醒超预算 | 见 §4.2 | p3 | none | `wake.suppressed:<podId>:<hourBucket>` |

**`resultReady` 不决定是否通知**，只决定「结果可否查看」与 title/summary 的措辞。硬失败（ERROR / archive_failed 早退 / watchdog 耗尽且无产物）同样必须 p1——那才是最该被看到的一种。用户主动取消（CANCELLED）才降 p3。

**p0 不进事件表。** `PodAttentionItem` 是读时投影（`PodGoalService.attention()` ← `buildPodAttention(views)`），没有写点；镜像它还要解决「attention 消失后事件怎么关」的整条生命周期，收益为零。L1 的 `attention` 态直接读 `PodDetailView.attention.length`。

**消息 kind 用真实枚举**：`note | request | review | decision | escalation`（`PodMessageKind` / `MESSAGE_KINDS` / MCP zod / A2A `KINDS` 四处一致）。v1 **不扩展枚举**——`request` 与 `escalation` 已覆盖「要 Lead 做事」的语义。

**dedupeKey 必须带身份维度**：Goal 级带 `revision`（`notifyResult` 的既有去重键就是 `${podId}/${goalId}#${revision}`）；消息级带 `messageId`。漏掉 revision 会让打回后的 revision 2 结果被 `UNIQUE` 永久吞掉。

### 3.5 写点

| 事件 | 写在哪 |
|---|---|
| `goal.result` / `goal.ended` | **`finishPodGoal`**（archive + reconcile 两条兜底路径都经过它）——不是 `notifyResult`（它只对 PASS/UNREVIEWED 调用，FAIL 会漏，且它还承担 `finishRevision`/`retireRevision`，职责不动）。双触发由 dedupeKey 吸收。 |
| `member.*` | **`PodStore.insertMessage()`**——全仓库唯一收口（REST `PodMessageService.send()`、`finishPodGoal` 的 decision note、**A2A `PodA2ABridge` 两处**都经过它）。挂在 service 层会漏掉 A2A 主通道，而 A2A 正是 agent 发 escalation 的默认路径。 |
| `node.*` / `wake.suppressed` | 对应执行点 |

### 3.6 Attention（p0）通知链

p0 不进事件表，但 p0 的**通知**归本设计（2026-11-04 composer/rail 批次已明确移交，见其 spec supersession note 2）。链路：

```
GET /api/presence（含 attention.items[]）
  → main 与上次快照做集合差
      ├─ 新出现的 id → 应用内 toast + OS 通知（一次）+ 托盘 attention
      ├─ 消失的 id   → 从「已通知」集合移除（不打扰，不补一条"已解决"）
      └─ 集合持久化 electron-store("mafw-notify").attentionIds → 重启不重发
```

**`PodAttentionItem` 需 additive `revision`，`id` 改为 `${goalId}:${kind}:r<revision>`。** 现有 id 是 `${goalId}:${kind}`（`pod-stage.ts:289`），跨 revision 重复——打回后第二次「计划批准」会被当成同一条而静默。桌面只消费 `attention.length` 与 `action`，改 id 形状是安全的。

**点击**：toast / OS 通知点击 → 聚焦窗口 → `mafw-navigate-goal { podId, goalId, action }`（action 直接复用 `PodAttentionItem.action`：`open_plan_review` / `open_direction` / `open_question` / `open_goal`）。

**与 switchAgent 门的关系**：coordination 会话切离 lead 会 403（2026-11-04 新增）。唤醒与通知**都不得调用 `switchAgent`**——Lead 身份由 `IdentityRegistry` 绑定注入，只走 `promptAsync`。

## 4. Lead 唤醒（P2）

### 4.1 路径

```
member.request|escalation 落库（to=lead）
  → PodEventService 写 p2 事件，wakeState='pending'
  → PodEventWake.scan()（启动 + 每 60s + 事件落库后立即触发一次）
      ├─ Pod 暂停              → 保持 pending
      ├─ **该消息对 Lead 已 delivered**（查 `pod_message_deliveries`）→ 直接置 delivered，跳过注入
      ├─ Lead run 处于 suspended → 保持 pending（RunStateService）
      ├─ Lead 忙（busySessions）→ 保持 pending（下次 scan 合并）
      ├─ 预算 6/h 或同 goal+kind 10min 内已唤醒 → suppressed + 落 p3
      └─ ensureLead() → promptAsync 一条聚合 [POD EVENT]
            成功 → wakeState='delivered' + commitDelivered(镜像 message ids)
```

**持久化**：`wakeState` / `wakeAttempts` / `wakeAt` / `wakeSessionId` 都在 DB。gateway 重启后 `scan()` 重新看到 `pending`，自动补发——不存在「重启丢唤醒」。

**真合并**：同一次 scan 里所有 pending 合成一条简报，不是 N 个 queued turn。

**投递后收口**：wake 成功时调用 `PodMessageDelivery.commitDelivered(ids, sessionId)`，避免镜像消息永远 `pending`、后被 retry 重复投递。

**注入形态**（Lead 会话用户可见，接受为系统缩写）：

```
[POD EVENT]
2 条待处理：
1. goal=<id> rev=1 kind=escalation from=builder
   title: ...
   summary: ...
   refs: task=w1-t2
2. ...
处理完即可；需要用户拍板时走 ask 流程。
```

### 4.2 闸门

| 闸门 | 默认 | 行为 |
|---|---|---|
| 每 Pod 每小时唤醒数 | 6 | 超出 → `wake.suppressed` p3 事件（只进日志/轨迹，不打扰用户） |
| 同 goal + kind 去重窗 | 10 min | 只刷新事件，不重复唤醒 |
| Lead 忙（在飞回合） | 合并 | 留 pending，下一次 scan 一条发出 |
| Lead run suspended | 暂缓 | 留 pending，恢复后补发 |
| Pod 暂停 | 不唤醒 | 留 pending |

**抑制条件不用 `decide()`**：`decide()==='push'` 只表示「有活会话」，不代表已投递（REST `notify:false` 路径根本不调 `deliver`）。抑制必须看**实际投递结果**。

**A2A 会抢先投递**：`PodA2ABridge` 落库后立刻 `deliver()`，Lead 有活会话时就以 `[POD HANDOFF]` 进去了。所以 scan **必须**先查 `pod_message_deliveries` 里这条对 Lead 是否已 delivered——已 delivered 就置 `wakeState='delivered'` 跳过注入。否则同一条 escalation 在 Lead 会话里出现两次（`[POD HANDOFF]` + `[POD EVENT]`），正撞反目标「不刷屏」。

**v1 不做 LLM 慢判**：P2 全部按规则，可预测、可测、零 token。

### 4.3 与既有 pull 的关系

`PodMessageDelivery` 的节点 pull 保持不变；事件层是**额外的 push 通道**，只针对 p2。两者不互相取代。

## 5. 常驻存在感（用户选定 A · 三层组合）

### 5.1 三层

| 层 | 位置 | 内容 |
|---|---|---|
| L1 | 托盘图标 | 三态：`idle` / `running`（有 Goal 在跑）/ `attention`（有 p0 attention 或未查收 p1） |
| L2 | 任务栏按钮 + tooltip | `win.setProgressBar(ratio)`；tooltip：`MAFW — 2 个 Goal 在跑 · 冒烟·入口验证 execute 2/3` |
| L3 | 托盘菜单顶部状态行（可点） | 打开**最近有进展**的 Goal 详情；多个在跑时菜单里逐条列出 |

### 5.2 完成时

- 任务栏：`setProgressBar(-1)` + `setOverlayIcon(✓)`。
- 托盘：切 `attention`。
- OS 通知与提示音：**每个 `goalId+revision` 各一次**，窗口在前台也发。已通知键持久化在 `electron-store("mafw-notify")`，**app 重启不重发**；该 goal+revision 被 `seen` 后清理键（反目标「用户没看就反复提醒」）。
- 提示音：**一次短提示音，默认开、Config 可关**（我的决定：无声的完成提示在「你正在干别的」场景等于没有）。
- 用户打开该 Goal 且结果数据**加载成功**后 → `seen`，清角标与未读。

### 5.3 防 change blindness

托盘用静态图标变体（不做动画）；任务栏进度是连续量，天然抗变化盲视；完成瞬间由 OS 通知兜底。

### 5.3b tooltip 合并规则

既有 tooltip 是 `MAFW Desktop — N pending approvals`（`tray-status.ts:21-24`），新增 Goal 行后固定为：

```
MAFW Desktop — 2 个 Goal 在跑 · 冒烟·入口验证 execute 2/3 · 1 pending approval
```

三段按「在跑 → 未查收结果 → 待审批」顺序拼，空段省略；单 Goal 时省略计数前缀。

### 5.4 数据通路：main 侧轮询（跨项目）

```
main/presence-poller（15s）
  → GET /api/presence
  → 托盘图标 / 任务栏进度 / tooltip / 菜单
```

渲染进程只持有一个 Pod（`pod-store.detail` 单例），推不出别的项目在跑什么，因此 **presence 归 main**。既有的 `startTrayStatusPolling` 就是同款 raw-fetch 轮询，直接扩展。

失败回落：连续 3 次失败（≈45s）→ `idle`。收到 `pod.event` 时由 renderer 触发一次立即轮询（`desktop.refreshPresence()`），避免最长 15s 滞后。

## 6. API / SDK

| 方法 | 路径 | 说明 |
|---|---|---|
| `presence.get` | `GET /api/presence` | 跨项目聚合，见下 |
| `pod.events.list` | `GET /api/pods/:podId/events?state=unread&limit=50` | `{ items, counts }` |
| `pod.events.seen` | `POST /api/pods/:podId/events/:id/seen` | 幂等 |
| `pod.events.seenAll` | `POST /api/pods/:podId/events/seen` | body `{ goalId, revision }` |

```jsonc
// GET /api/presence
{
  "running": [{
    "podId": "...", "projectId": "...", "projectName": "...",
    "goalId": "...", "title": "...", "phase": "EXECUTING",
    "node": "execute", "progress": { "current": 2, "total": 3 }, // null = 不确定态
    "startedAt": "...", "updatedAt": "..."
  }],
  "attention": {
    "count": 1,
    "items": [{ "id": "goal-x:plan_approval:r1", "podId": "...", "goalId": "...",
                "revision": 1, "kind": "plan_approval", "title": "...", "action": "open_plan_review" }]
  },
  "unreadResults": { "count": 1, "latest": { /* 同 running 条目形状 */ } }
}
```

**范围**与口径：

- 只统计非终态 Goal + 非 archived Pod。
- **`progress` 来自 `pod_tasks` 投影**（该 goalId 下 `done / total`），**不是** state 的 `currentWave/totalWaves`——后者只有 legacy 技能路径在写，NodeDriver 从不写，取它会恒为 `0/null`，任务栏永远停在不确定态。tasks 为空 → `null`（`setProgressBar(2)` 不确定态）。
- `node` 取 `nodeSession?.phase`（真正在飞的节点）；没有在飞会话时为 `null`，**不要**用 `nextNode` 冒充「正在跑」。
- **worktree 折叠**：`canonicalProjectDir` 只是 realpath，不映射 worktree→parent；折叠必须过 `parentProjectDirForWorktree`（同 `pod-service.ts` 的 `resolveProjectKey`），否则同一逻辑项目会显示成「2 个 Goal 在跑」。

**SSE 新增顶层扁平事件 `pod.event`**，只带路由字段（完整事件由 `pod.events.list` 拉取，避免载荷膨胀与状态不一致）：

```json
{ "type": "pod.event",
  "properties": { "podId": "...", "eventId": "...", "goalId": "...", "revision": 1,
                  "kind": "goal.result", "severity": "p1" } }
```

新增 canonical 事件必须同步这些位置（否则 CI 守卫全红）：
`packages/gateway-sdk/src/events.ts`、`gateway/src/runtime/mafw-vocabulary.ts`、`event-flow-matrix.ts`、`contract-events.ts`（含 `requiredFieldsOf`）、`packages/desktop/src/renderer/mafw/session-events.ts`（`assertShellEventCoverage` / `ShellHandledType`，注意**不在 `sse/` 下**）、`packages/tui/tests/event-coverage.test.ts`。
并跑 `npm run emit:openapi` **与 `npm run emit:runtime-contract`**——后者产物 `runtime-contract.json` 由 `contract-manifest-freshness` 守卫。

**seen 时机**：复用既有口径——**结果数据加载成功后**才 seen（`pod-result-store.ts` 的教训：面板打开不算，接口失败时必须保留「有新结果」）。

**导航**：main → renderer 新增 IPC `mafw-navigate-goal { podId, goalId, projectId }`（kebab-case，与既有 `mafw-quick-entry` / `navigate-mafw` / `menu-command` 一致，避免与 `navigate-mafw` 混淆）；renderer 需要时先切项目再 `openGoalDetail`。

**`seenAll` 的 revision 作用域**：只清**当前 revision**（`resultViewedKey` 含 revision，跨 revision 的未读不能被顺手清掉）；body 必须带 `revision`。

## 7. 兼容与迁移

- `pod_events` 新建表，不改既有表。
- `pod.updated {kind:'result'}` 保留（刷新用），但**通知逻辑退役**：`handlePodResultEvent` 的 toast + hidden-only 通知 + `pendingResultGoalId` 移除。
- **`viewedResults` 只读不写**。未查看判定 = `resultReady && !(events 里该 goal+revision 已 seen) && !viewedResults.includes(key)`。四个既有消费点逐个迁移：
  1. `MafwShell.podResultDot`（:1987-1994）→ 双读判定；
  2. `pod-model.latestUnviewedResult`（:786-807）→ 双读判定；
  3. `MafwShell.openPendingResult`（:2039）→ 双读判定；
  4. `PodResultView.markResultViewedAfterLoad`（:66）→ 改为调用 `pod.events.seen`。
  只退役写点不换读点会导致 `viewed` 恒 false，**结果点永不清**——验收 #3 直接失败。存量未查看结果（含 `goal-20261104-032632-7bd086`）因此不丢，随查看自然收敛，无需回填脚本。
- **特性门控**：`GET /api/pods/:id/events` 404 → UI 退回纯 `resultReady` 视图 + 旧 localStorage 逻辑，不报错。旧 gateway 用户看到的是「比现状弱一点」而不是「零信号」。
- 历史 Goal 不回填事件。

## 8. 测试策略（TDD）

**gateway（jest）**
- `event-severity.test.ts`：真实 kind 枚举逐条（`request`/`escalation` → p2）；`request` 发 builder 仍 p2；`review`/`decision`/`note` → p3；**FAIL / MAX_RETRIES / ERROR → p1，CANCELLED / verdict=null → p3**（不看 `resultReady`）。
- **`pod-store.insert-message.test.ts`**：REST `send()`、`finishPodGoal` decision note、**A2A bridge 两条路径**都产出 `member.*` 事件（回归 C-A——挂错层会漏掉整个 agent 通道）。
- `pod-event-service.test.ts`：DB 幂等（同 dedupeKey 第二次返回既有行）；**revision 2 产出新事件**（回归 C2）；state 迁移；文件写失败不影响可用性。
- `pod-event-wake.test.ts`：预算 6/h；10min 去重；忙时合并成**一条**；suspended 暂缓；Pod 暂停不唤醒；**重启后 pending 补发**；**镜像消息已 delivered 时跳过注入**（回归 I-A）；投递成功才抑制 + `commitDelivered` 收口。
- `finishPodGoal` 写点：FAIL / MAX_RETRIES 也产 p1（回归 I7）；双触发只产一条。
- `presence` 路由：跨项目聚合、只算非终态、**`progress` 来自 `pod_tasks`（不是 state.currentWave）**、tasks 为空 → null、worktree 过 `parentProjectDirForWorktree` 折叠、**`attention.items` 带 revision**。
- `pod-stage.attention.test.ts`：attention `id` 含 revision；revision 2 的同类 attention 不与 revision 1 混同。
- 契约：`route-catalog` + `emit:openapi` + **`emit:runtime-contract`** + `api-contract`；`pod.event` 的 `requiredFieldsOf` 断言。

**desktop（node --test）**
- `pod-events.test.ts`：inbox 排序（p1 > 时间）、未读计数、seen 幂等、viewedResults 兼容读。
- `presence.test.ts`：`podPresence(payload)` 纯函数 → `{ tray, progress, tooltip, clickTarget }`；不确定态；连续 3 次失败 → idle。
- **`attention-diff.test.ts`**：新 id → 通知一次；重启后不重发；id 消失只清集合不通知；revision 变更算新 id。
- `tray-navigation.test.ts`：左键仍 toggle；菜单状态行导航。
- dispatcher：`pod.event` 进 store 且不 missTrace。

**不测（人工冒烟）**：托盘图标在 Windows 溢出区的可见性、提示音是否真响。

## 9. 验收（真机）

1. 建 Goal → 任务栏出现进度、tooltip 一行、托盘变 running。
2. 切到浏览器干别的 → Goal 跑完 → 一声提示音 + OS 通知（**前台也发**）+ 任务栏 ✓ 角标。
3. 点托盘菜单状态行 → 打开该 Goal 详情；结果加载成功后角标消失。
4. **跨项目**：desktop 停在项目 A，项目 B 的 Goal 跑完 → 同样有 1~3 的全部表现。
5. **FAIL 路径**：Goal 归档为 FAIL → 有 p1 事件与通知（不是只有 PASS 才有）。
6. **打回 revision 2**：revision 2 完成后再次收到结果事件（不被去重吞掉）。
7. **Lead 唤醒**：Builder 发 `escalation` 给 Lead → 用户不说话，Lead 被唤醒并回应；10 分钟内同一件事不重复唤醒。
8. **忙时合并**：Lead 在跑回合期间连发 3 条 → 只收到 1 条聚合简报。
9. **暂停**：Pod 暂停期间不唤醒；恢复后补发。
10. **预算**：一小时内第 7 次 → 不唤醒，落 `wake.suppressed`，用户无感。
11. **重启**：唤醒落库后立刻重启 gateway → 重启后补发一次，不丢不重。
12. **旧 gateway**：events 路由 404 → UI 退回 `resultReady` 视图，无报错。
13. **p0 attention**：Goal 进入「待批准计划」→ toast + OS 通知各一次 + 托盘 attention；重启 app 不重发；批准后该 attention 消失，**不补发「已解决」通知**。
14. **打回后第二版 attention**：revision 2 再次等待计划批准 → 仍然通知（不被上一版的 id 吞掉）。

## 10. 我的决定（评审时请挑战）

1. 事件 **DB 为运行时真相、文件为不可变审计**（任务文件格式不变）。
2. v1 不做 LLM 慢判。
3. 完成提示音默认开、可关。
4. 不做托盘动画。
5. `PodAttentionItem` 仍是 p0 唯一来源，不进事件表。
6. 事件 v1 不外投 A2A。
7. `state` 只有 `unread/seen`，不暴露无生产者的 `done`。
8. 托盘左键保持 toggle，导航走菜单状态行。

## 11. 风险

- **托盘被 Windows 折叠**：三层兜底；验收时确认不在溢出区。
- **提示音打扰**：默认开可关；只有 p1 出声。
- **唤醒烧钱**：6/h + 10min 去重 + 暂停/挂起闸门；超额只记事件。
- **事件膨胀**：p3 保留 30 天（`PodEventService.prune`，每日一次）；p1/p2 永久。
- **presence 轮询成本**：只扫非终态 Goal、非 archived Pod；15s 一次与 `work.overview` 同量级。

## 12. builder-check + glm-5.3 评审的裁决

| # | 问题 | 决议 |
|---|---|---|
| 1 | p0 镜像谁写、谁关 | 不镜像，p0 只来自 `attention` 读时投影 |
| 2 | p2 与既有 push 重复 | 抑制看**实际投递成功**，不是 `decide()`；wake 成功顺手 `commitDelivered` |
| 3 | 完成通知归谁 | 事件层唯一所有；`notifyResult` 只保留广播；`viewedResults` 只读不写 |
| 4 | 指示器覆盖范围 | **跨项目聚合**（用户裁决）；`GET /api/presence` + main 15s 轮询 |
| 5 | inbox 位置 | 不新增第 6 桶；p1 落 `result_ready` 带「未查看」 |
| 6 | 忙时合并 | 真合并成一条 `[POD EVENT]` |
| 7 | presence 驱动 | main 轮询；`pod.event` 触发一次立即轮询 |
| 8 | 托盘左键 | 保持 toggle |
| 9 | `wake.suppressed` 可见性 | 只进日志/轨迹 |
| 10 | **P2 触发条件用了不存在的 kind（C1）** | 改用真实枚举 `request` / `escalation`；不扩展枚举 |
| 11 | **dedupeKey 未定义（C2）** | 分级表逐行写死，Goal 级带 revision、消息级带 messageId |
| 12 | 文件真相源与 state 冲突（I1） | 改为 DB 真相 + 文件审计；`reindex` 重置 state 并写明 |
| 13 | 唤醒无投递痕迹/无重启恢复（I2） | 新增 `wakeState/attempts/at/sessionId` + 启动扫描 + suspended 闸门 |
| 14 | 退役 viewedResults 丢存量（I3） | 只读不写 + 双读判定 + 特性门控 |
| 15 | seenAll 回退已修 bug（I4） | 改为结果加载成功后 seen |
| 16 | 新 SSE 词汇链未列（I5） | 六处同步点写进 §6 |
| 17 | `goal.result` 写点漏 FAIL（I7） | 钉在 `finishPodGoal`，全 verdict |
| 18 | 验收缺跨项目/FAIL/revision2/重启/合并/暂停（I8） | §9 补到 12 条 |
| 19 | presence 成本与口径（M4/M5） | 只扫非终态/非 archived；进度缺省 null；worktree 去重 |
| 20 | 失败回落数字打架（M2） | 统一为连续 3 次失败 → idle |
| 21 | `goal.needs_you` 示例自相矛盾（M1） | 删除 |

---

## 13. 第二轮评审（glm-5.3）修订

### 新增 Critical / Important

| # | 问题 | 决议 |
|---|---|---|
| C-A | `member.*` 写点钉在 `PodMessageService` 会漏掉 A2A 主通道（`PodA2ABridge` 直接 `store.insertMessage`），agent 的 escalation 永不产事件 | 写点下移到 **`PodStore.insertMessage()`** 唯一收口；测试覆盖 REST / decision note / A2A 两条路径 |
| I-A | A2A 落库后**立即** `deliver()`，同一 escalation 会被 `[POD HANDOFF]` + `[POD EVENT]` 注入两次 | scan 先查 `pod_message_deliveries`，已 delivered → 置 delivered 跳过 |
| I-B | `progress` 取 `state.currentWave/totalWaves`，但 NodeDriver 从不写它（只有 legacy 技能路径写）→ 任务栏永远不确定态 | 改从 **`pod_tasks` 投影**取 `done/total`；为空 → null |
| I-C | 非 PASS 且 `resultReady=false`（ERROR / watchdog 耗尽无产物）会掉进 p3，硬失败反而无声 | **verdict 非 null 一律 p1**，`resultReady` 只影响可查看性；CANCELLED 才 p3 |
| I-D | 只退役 `viewedResults` 写点不换读点 → 结果点永不清 | 四个消费点逐个迁移（§7 已列） |
| I-E | `pod.event` 载荷未定义；漏了 `emit:runtime-contract` | §6 定义载荷 + 补生成脚本 |
| I-F | OS 通知「一次」无去重机制与重启语义 | 键 `goalId+revision` 持久化 `electron-store("mafw-notify")`，重启不重发，seen 后清理 |

### Minor 处置

| # | 问题 | 处置 |
|---|---|---|
| M-A | `node.*` key 用了写入点拿不到的 `runId` | 改用 `attempt`（`goal_node` 广播就有） |
| M-B | 文档写 `sse/session-events.ts`，实际在 `renderer/mafw/session-events.ts` | 已改 |
| M-C | `canonicalProjectDir` 只是 realpath，折叠不了 worktree | 改走 `parentProjectDirForWorktree` |
| M-D | IPC 名用冒号不合仓库惯例 | 改 `mafw-navigate-goal` |
| M-E | tooltip 与待审批文案合并规则缺失 | §5.3b 定死三段式 |
| M-F | `seenAll` 的 revision 作用域未定义 | 只清当前 revision，body 带 `revision` |
| M-G | 「notifyResult 只保留广播」措辞误导（它还管 finishRevision/retireRevision） | 改为「不加通知逻辑，其余职责不变」 |
| M-H | `running[].node` 无来源 | 取 `nodeSession.phase`，为空则 null（不拿 `nextNode` 冒充） |

---

## 14. 与 2026-11-04 composer / rail 批次的合并

`docs/superpowers/specs/2026-11-04-inputbar-rail-attention-redesign-design.md` 在同日收窄范围（§5.28，commit `8346cf27`），把 **attention 通知链 / 托盘 presence / 跨项目聚合**整体移交本设计。合并后的影响：

| 事项 | 变化 |
|---|---|
| **attention 通知链** | **新增 §3.6**——此前本设计只写了「L1 读 attention.length」，没有通知、没有去重、没有点击回焦。现补齐：presence 差集 → toast + OS 一次 → 持久化集合 → 点击 `mafw-navigate-goal`。 |
| `PodAttentionItem` | additive `revision`；`id` 从 `${goalId}:${kind}` 改为 `${goalId}:${kind}:r<revision>`（跨 revision 必须区分）。桌面只消费 `length` 与 `action`，安全。 |
| **switchAgent 双向门**（新增 403 规则） | 唤醒与通知**不得调用 `switchAgent`**——coordination 会话切离 lead 会被 403；Lead 身份由 `IdentityRegistry` 绑定注入。 |
| 托盘 | 该批次「托盘不并入」的结论**作废**，presence 以其 L1/L2/L3 为准（即本设计 §5）。 |
| result 通知链 | 该批次**未动**，仍由本设计 §5.2/§7 接管。 |
| composer / SessionConfigMenu / Thinking / rail 46px 视觉 | **无交集**，不影响本设计的任何改动面。 |

状态：**设计已定稿（三轮：builder-check + 两轮 glm-5.3 + 批次合并），尚未写 plan**。
