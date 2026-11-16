# 事件层默认开启 + Decision → Lead 播报（2026-11-16）

- Commit: `eacd468d`（`feat(events): announce decision drafts to Lead by default`）
- 背景：Chat 决定板移除后，决定需要由 Lead 在对话里主动说明；事件层本来已有
  `subscriberType:'lead'`，但只声明未接线，且事件层默认关闭。

## 变更

- **事件层默认开启**：`eventLayerEnabled()` 默认 true，只有显式
  `MAFW_EVENT_LAYER=0` 才关闭；`/api/event-*` 路由、internal ingest、cron/github
  动作统一走该判定。外部 GitHub / webhook source 仍需显式创建，不会自动联网。
- **系统 source**：事件层启动时 `ensureSystemSource('internal' | 'cron')`，避免
  internal 事件因缺 source 静默 404。
- **Decision → Lead**：
  - `DecisionRecordService.emit('drafted')` → kernel `ingestDecisionEvent` →
    `internal` source 的 `decision.drafted` trigger；`externalKey=decision:<recordId>`，
    幂等键 `internal:decision.drafted:<recordId>`。
  - 为该线程建 `subscriberType:'lead'` + `mode:'context'` 订阅；evaluator 对
    `decision.*` + Lead context 返回 `accept/report`（不创建 GoalRun）。
  - `deliverContext` → `PodService.ensureLead` → `promptAsync` 一条
    `[LEAD EVENT] 决定待确认 …` 给 Lead 会话；确认 / 搁置仍是 human-only。
- **`deliverContext`**：事件层新增 context 投递出口；没有该 hook 时保持原行为
  （只标记 delivered）。失败进入 failed + 退避重试。

## 验证

- Gateway 全量：**7688 passed / 2 skipped / 7690 total**（953 suites）。
- `gateway tsc --noEmit -p tsconfig.json`：0。
- 新增测试：**12 个**
  - `event-flags`（默认开 / 0 关 / legacy 1）3
  - `lead-event`（消息渲染 / 非 decision 忽略 / lead context 判定）3
  - `decision-lead-wiring`（kernel 接线 3 断言）3
  - `ensureSystemSource` 1
  - event fan-out Lead context 投递 1
  - integration decision → Lead context 1

## 上线

- 本次只改 gateway；需要重启 gateway 才生效（`pending-restart.json`
  `action:'restart'`）。当前 review 节点在跑，重启前先确认是否要中断。
- 事件层默认开启后，旧 `MAFW_EVENT_LAYER=1` 环境不受影响；显式 `=0` 仍可关闭。
