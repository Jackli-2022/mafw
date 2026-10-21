# 子代理生命周期面板设计（Subagent Lifecycle Panel）

> 日期：2026-10-21（rev2，含 builder check 四项修正）。来源：六方差距调研（`docs/research/2026-10-21-six-way-frontend-interaction-gap-survey.md` P0-2）+ 用户 brainstorm 三层需求（存在感/进度/完成提醒，进度=状态行）。
> 排期位置：P0 第一件（顺序：子代理 → diff 行级评论 → 后台任务）。

## 1. 背景

desktop 现在的子代理可见性只有两处静态入口：父会话里的 task 工具卡（状态随 part 流转）和 AgentPicker 的 children 列表（手动刷新）。子代理跑起来的几分钟里，用户没有「它还活着没 / 它做到哪了 / 它完了没」的任何信号——这是六方调研（Claude task_started/progress/notification、Codex SubAgentActivity、Kimi Background Agent 面板）确认的行业标配缺口。

## 2. 目标

1. **存在感**：跑着的子代理一行一个，实时出现在 RightDock 新「子代理」tab——agent 名 + 任务描述 + 运行计时 + 状态（跑着/完成/失败/已中止）。
2. **完成提醒**：子代理回合终态（完成或失败）→ toast 常显 + 窗口隐藏时 OS 通知；**节流**（见 §4.5，Claude #11716 通知洪泛是前车之鉴）。
3. **跳转**：点行 → `openSubagentSession`（现成）进子会话看全过程。

**runtime 范围：仅 opencode。** builder check 实锤：pi 无 task 工具（`dist/core/tools` 仅 bash/edit/find/grep/ls/read/write）、`PiSessionRegistry.children()` 恒返回 `[]`——pi 下无子代理可显示，面板恒空但不出错（空态文案）。原 rev1 的「pi enrich metadata.sessionId」切片（Task 6）随之**砍除**（无生产者）；pi 若未来引入子代理能力，本设计的 tracker 事件面天然兼容。

## 3. 非目标

- **canonical 词汇不加 `task.*`**：v3 设计已明确把「子代理树词汇」列为非目标（词汇冻结仅 +turn.started）——本设计**纯 desktop 侧从既有事件推导**，零词汇表改动、不碰 5 点 guard chain。跨会话聚合需要 gateway 级事件时（后台任务件），再随 v3 后续评审。
- 不做子代理工具调用实时流（用户拍板：状态行就够）。
- 不做 TUI 消费。
- 不做跨会话面板聚合（面板按当前会话过滤；通知/徽标是全局的，见 §4.4/§4.5——这是刻意的不对称）。
- pi runtime 的子代理支持（无此能力，见 §2）。

## 4. 设计

### 4.1 数据源（全部既有信号）

| 信号 | 推导 | 说明 |
|---|---|---|
| `session.created`（`info.parentID` 非空） | 行创建：childID/parentID/title/startedAt，状态 running | opencode 子会话创建即发 |
| `session.updated`（sessionID=child） | 行标题刷新 | |
| `turn.completed` / `turn.failed`（sessionID=child） | 行终态：completed/failed + endedAt；**首个终态生效** | |
| `turn.aborted`（sessionID=child） | 行终态：aborted（显示「已中止」，**静默**——多为用户中断父会话连带） | 防 running 僵尸行 |
| `session.deleted`（sessionID=running 行的 childID） | 行终态：aborted（静默） | 父会话 revert/外部删除时 |
| `GET /api/sessions/:id/children` 轮询（15s） | ①父会话打开时的**历史行 bootstrap**（children 里不在事件行的 → completed、endedAt 取 `time.updated` 或留空）；②**SSE 断线漏终态的自愈**：对 running 行调 `sessions.messages(childID, 1)` 查最后一条消息——assistant 且 `time.completed` 有值 → 落终态（有 `error` → failed，否则 completed） | ②只对 running 行做（通常 1-3 行，量小）；children API 本身不带状态，**快照不把未知态标 running**（运行态只信事件） |

子代理标题格式（opencode）：`<description> @<agent>`——agent 名从标题 `@` 后段解析，缺省「子代理」。

### 4.2 纯逻辑模块 `renderer/mafw/subagent-tracker.ts`

reducer 形态（无 Solid 依赖，node --test 可测）：

```ts
type SubagentStatus = "running" | "completed" | "failed" | "aborted"
type SubagentRow = {
  childID: string
  parentID: string
  title: string            // 子会话标题
  agent: string            // 从标题解析，缺省 "子代理"
  status: SubagentStatus
  startedAt: number
  endedAt?: number
}
type TrackerEvent =
  | { kind: "session-created"; info: { id: string; parentID: string; title?: string } }
  | { kind: "session-updated"; sessionID: string; title: string }
  | { kind: "turn-terminal"; sessionID: string; terminal: "completed" | "failed" | "aborted" }
  | { kind: "session-deleted"; sessionID: string }
  | { kind: "children-snapshot"; parentID: string; children: { id: string; title?: string; time?: { created?: number; updated?: number } }[] }
  | { kind: "child-last-message"; childID: string; message: { role: string; time?: { completed?: number }; error?: unknown } | null }

function applySubagentEvent(rows: SubagentRow[], ev: TrackerEvent): SubagentRow[]
```

规则：行键 childID；`session-created` 仅当 parentID 非空才建行；终态只落一次（幂等）；`session-deleted`/`child-last-message` 只对 running 行生效；`children-snapshot` 按 id 合并（已终态不回退；新 id 补历史行）；行按 startedAt 倒序。外层薄 store 包装（模块单例 signal + applySubagentEvent，模式同 `goals-rev` / `session-store`）。**tracker 全局**（记录所有父会话的子代理行），作用域过滤交给消费方。

### 4.3 SSE 接线（dispatcher）

`sse/dispatcher.ts` 新增 handler 组 `subagents`（deps 注入，逐分支可单测）：消费 §4.1 六类事件 → `applySubagentEvent` → bump `subagentsRev` signal。**不动既有 lifecycle 分支**（Rail 的 children-ignored 行为保留——同一事件两个消费者，各自语义）。SSE 重连（`source.onopen`）时触发一次立即对账（不等 15s）。

### 4.4 呈现：RightDock「子代理」tab

- `dock-tab.ts`：`DockTab` 联合 + `DOCK_TABS` 加 `"subagents"`（中文标签「子代理」，RightDock 标签为硬编码非 i18n 层）。
- 新组件 `SubagentDock.tsx`：行 = **当前活动会话**（`parentID === activeSessionId`）的行；running 行 1s 计时跳（模式同 ChatPane `metaNow`）；行点击 `onOpenSession(childID)`；空态文案「本会话暂无子代理」。
- **不自动切换 dock tab**；**tab 徽标 = 全局 running 行数**（不按当前会话过滤——后台会话的子代理在跑也要看得见）。

### 4.5 通知（节流规则写死）

子代理行落终态时：
- `completed` / `failed`：toast（3s，常显，标题含子代理描述）；`document.hidden` → `notifyIfHidden`（OS 通知）。
- `aborted`：**静默**（仅面板行状态变化）。
- **节流**：①每 childID 至多一次终态通知（首个终态触发）；②全局 OS 通知限频——10s 窗口内最多 1 条，超出只留 toast + 徽标。
- **抑制旧通道**（既有行为变更，rev2）：`chat-stream` 的 `notifyIdle` 今天对子会话 turn.completed 也会发一条泛泛的「回合完成」OS 通知——对**被 tracker 追踪的 childID** 抑制该旧通道，新通道（带子代理标题 + 可跳转语义）成为子会话的唯一通知源。plan 须为此写显式测试。

### 4.6 轮询生命周期

15s 对账轮询仅在有 running 行或 dock 开在 subagents tab 时运行（interval cleanup 防挂）；SSE 重连即触发一轮。

## 5. 文件清单（预估）

| 文件 | 动作 |
|---|---|
| `packages/desktop/src/renderer/mafw/subagent-tracker.ts` + `.test.ts` | 新建（纯 reducer） |
| `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` + handlers | 加 `subagents` 组 |
| `packages/desktop/src/renderer/mafw/components/dock-tab.ts` | 加 tab 值 |
| `packages/desktop/src/renderer/mafw/components/SubagentDock.tsx` | 新建 |
| `packages/desktop/src/renderer/mafw/MafwShell.tsx` | dock 接线 + 通知（含 notifyIdle 抑制）+ 轮询 |
| `mafw.css` | 行样式（token，禁字面值） |

（无 gateway 改动——原 pi enrich 切片已砍。）

## 6. 测试

- `subagent-tracker.test.ts`：建行/标题刷新/三值终态幂等/aborted 静默/deleted 收敛/children-snapshot 合并（历史 bootstrap、终态不回退、未知态不标 running）/child-last-message 自愈（completed、failed、仍 running 三态）/parentID 过滤/排序。
- dispatcher 增量：subagents 组路由（六事件各一）+ onopen 即时对账。
- dock-tab 契约：union 更新。
- notifyIdle 抑制：子会话 turn.completed 不触发旧通知、触发新通知。
- 手工冒烟：dev app（`npm run dev -- --remote-debugging-port=9222`）真实派子代理，验证行出现/计时/终态通知/跳转/中断父会话后子行落「已中止」。

## 7. 风险与开放问题

1. **子代理多回合**：首个终态即判完成的规则，对「任务工具子代理」成立（单回合语义）；若未来出现多回合子代理（如后台代理），此规则由后台任务件重定义。
2. **child-last-message 自愈的边界**：子代理最后一条消息为 assistant 但 `time.completed` 缺失（流被切断）→ 不落终态，等下一轮或真终态——宁可慢不可假活。多回合子代理会提前误判完成（与风险 1 同根，接受）。
3. **通知文案**：failed 的 toast/OS 文案需含失败语义但不吓人（「子代理失败：〈描述〉」），实现时定稿。

## 8. 工作流约束（既有约定）

- spec → plan → 实现 → 提交，各阶段经用户显式确认；确认后直接 master 提交。
- 本件零 gateway 改动，无 dist 重启负担（desktop dev 即时生效）。
