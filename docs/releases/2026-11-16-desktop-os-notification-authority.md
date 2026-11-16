# 2026-11-16 · Desktop OS 通知收口到事务层

- **分支**：`main`
- **实现 commit**：`ab9adf8b`
- **契约测试**：`packages/desktop/src/renderer/mafw/completion-notify-wiring.test.ts`

## 决策

OS 通知只来自事务层：main process 轮询 `GET /api/presence`，按 `pod_events` 的 p1（Goal 结果）
与 attention（p2 / 「需要你」）通知。消息/任务"完成"属于工作台进度，不是用户事务，不再弹系统通知。

## 变更

- 删除 `notifyIdle`（`turn.completed` 的「MAFW：回合完成 / 「会话」已回复」，60s 节流 + hidden 门）；
  `ChatDeps` 不再携带该通道，`sse/dispatcher.test.ts`、`chat-stream.test.ts` 同步收窄。
- 子代理终态、后台任务终态：保留应用内 `ToastV2`，删除 hidden 时的 OS 通知；
  `buildTerminalNotice(row)` / `buildBackgroundNotice(job)` 改为返回 `string | null`，
  `createNotifyGate` / `shouldNotifyIdle` 随 OS 通道退役。
- 「需要你」类通知保留在 renderer：`permission.asked` / `question.asked`
  （阻塞用户动作，不是完成提示）。
- `isTrackedChildSession` 仅服务已删除的 notifyIdle，一并移除。

## 验证

- 新增 `completion-notify-wiring.test.ts`：源码契约钉扎完成类通道不得出现
  `notifyIdle` / `MAFW：回合完成` / `os:`，且「需要你」通知仍在。
- 改写 `subagent-notify.test.ts`、`background-notify.test.ts`、`chat-stream.test.ts`、
  `dispatcher.test.ts`、`subagent-tracker.test.ts`。
- desktop **3937/3937（747 suites）**；`tsgo --noEmit -p tsconfig.json` rc=0。
