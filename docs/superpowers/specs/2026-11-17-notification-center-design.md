# 自绘通知中心 + 悬浮通知窗（2026-11-17）

## 0. 结论

OS 级通知不再由 Windows 原生 toast 承担，改为 MAFW 自绘的两层：

1. **应用内通知中心**：rail 铃铛 → 锚定面板，列表 + 未读 + 已读/清空；
2. **自绘悬浮通知窗**：独立无边框置顶窗口，底部右侧堆叠，窗口在后台时出现。

两层共用同一套 `MafwNotification` 数据和 **target 路由**；点击任何通知都落到
desktop 的同一个位置（会话 tab / Goal 详情 / 审批卡 / 提问卡 / 执行面板 / Config）。

## 1. 为什么（业界参考）

| 产品 | 做法 | 采用点 |
|---|---|---|
| VS Code | 状态栏铃铛 + 通知中心（列表、清除、勿扰）；窗口失焦时系统通知；点击聚焦窗口并定位 | 铃铛 + 面板 + 点击聚焦 |
| Slack | Activity 列表 + 原生通知；点击打开频道/消息 | 点击落到具体对象 |
| Linear | Inbox：未读/已读、稍后处理；点击打开 issue | 未读/已读与持久 inbox |
| GitHub Notifications | 每条带 `reason`（mention / review_requested / ci_activity…）+ Done/Saved triage | 每条通知带 reason |
| 飞书 / 钉钉 | 自绘无边框置顶弹窗，点击回到应用 | 自绘悬浮窗 |
| Windows / macOS | 系统通知中心持久保留 | 通知中心持久化 |

补充（本地调研 `docs/research/2026-11-04-superagent-multichannel-info-grading-research.md`）：
- 架构性降噪 > 过滤：非可行动事件不进通知通道（本设计沿用 p1/p2/p3）；
- breakpoint principle：只在自然断点（完成 / 需要你）打扰；
- 每条实时通知都应有一个可执行动作 / 落点。

## 2. 数据模型（shared）

`packages/desktop/src/shared/notifications.ts`

```ts
export type NotificationSeverity = "p1" | "p2" | "p3"
export type NotificationKind = "goal_result" | "attention" | "permission" | "question"

export type NotificationTarget =
  | { type: "session"; sessionID: string; projectId?: string }
  | { type: "goal"; goalId: string; projectId?: string; focus?: "timeline" | "result" | "plan" | "direction" | "question" }
  | { type: "approval"; sessionID: string; requestId?: string; projectId?: string }
  | { type: "question"; sessionID: string; requestId?: string; projectId?: string }
  | { type: "work"; projectId?: string }
  | { type: "config"; section?: string }

export interface MafwNotification {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body?: string
  reason?: string
  projectId?: string
  createdAt: number
  readAt?: number
  target?: NotificationTarget
  dedupeKey?: string
}
```

规则：
- `dedupeKey` 唯一；重复 publish 更新内容并置顶，保留 `readAt`。
- 持久化上限 **200** 条；超限先丢最旧的已读，再丢最旧未读。
- `p1`：Goal 结果（PASS/FAIL/…）；`p2`：需要你（计划批准/方向/提问/权限）。
- **v1 中心只收 p1/p2**。子代理/后台任务完成（p3）保持现状：仅应用内 toast，
  不进中心、不计未读、不弹悬浮窗（避免徽标常亮与 toast 双响）。
- 必填 reason：`goal_result` / `attention` / `permission` / `question`。
- **ever-seen 墓碑**：`seenKeys`（cap 1000）记录所有出现过的 `dedupeKey`；
  已读/清空/被 200 条上限淘汰的条目，来源再次报告同一 key 时不再复活；
  新 revision / 新 requestId 才会成为新通知。

## 3. 主进程 `NotificationHub`

`packages/desktop/src/main/notification-hub.ts`（纯逻辑 + 注入持久化，TDD）：

- `publish(input): MafwNotification`
- `list(): { items, unread }`
- `markRead(ids | "all")`
- `clear()`（清空已读；未读保留）
- `remove(id)`
- `onChange(cb)` / `onNew(cb)`
- 持久化：`electron-store("mafw-notifications")`，`{ items: [] }`；损坏 fail-open 空列表。
- 所有窗口通过 `mafw-notifications:changed` 收到快照；悬浮窗额外收 `mafw-notifications:push`。

`packages/desktop/src/main/notification-prefs.ts`（沿用 `tray-prefs` 模式）：
- `selfDrawn`（默认 true）：关闭时退回原生通知（仅 p1/p2）；
- `doNotDisturb`（默认 false）：关悬浮窗，中心照常收；
- `fallbackToNative`（默认 true）：悬浮窗创建/加载失败时原生兜底。
三个开关都进 **Config › Desktop › 通知**（与托盘开关同节），IPC
`get-notification-prefs` / `set-notification-prefs`；变更后立即生效（关闭 DND
会重新显示尚未过期的 pending 卡片，或至少下一次通知生效）。

`NotifyState`（`mafw-notify.json`）退役：通知 once-only / 已读 / 清空全部由 hub 的
`dedupeKey + seenKeys` 承担；presence 轮询只负责 publish，不再自己写通知账本。
（tray 的 pending 计数与 presence 投影不受影响。）

## 4. 悬浮通知窗

`packages/desktop/src/main/notification-window.ts` + `notification-placement.ts`（纯函数）：

- 独立 `BrowserWindow`：`frame:false / transparent:true / alwaysOnTop:true / skipTaskbar:true /
  focusable:false / resizable:false / movable:false / show:false`；`showInactive()`。
- 渲染入口：`src/renderer/notification/index.html` + `notification.tsx`（electron-vite
  第二 renderer input；独立轻量 CSS，复用主题 token）。
- 位置（`notification-placement.ts`）：主窗口所在显示器 workArea（主窗口不可见时用光标所在屏），
  右下 16px，向上堆叠，最多 3 张；高度按卡片数计算并 clamp 到 workArea。
- 行为：新 p1/p2 → push；6s 自动消失；hover 暂停计时；关闭按钮 dismiss；
  点击卡片 → `hub.markRead` + 聚焦主窗口 + `navigateToTarget`。
- 勿扰 / `selfDrawn=false` 时不创建；p3 永不进窗。
- 主题：读取 `nativeTheme.shouldUseDarkColors` + 主窗口上报的 `theme`（新增
  `mafw-notifications:theme` 轻量 IPC），跟随 light/dark。

## 5. 应用内通知中心

- rail meta 组新增 **铃铛**（`approvals` 上方），未读角标（9+），
  `aria-label="通知（N 条未读）"`；新增注册图标 `bell`。
- 点击 → 锚定面板（`left: 52px; bottom: 16px; width: 380px; max-height: 60vh`），
  面板结构：
  - header：`通知` + 未读数 + `全部已读`；
  - filter：`全部 / 未读`；
  - list：每条卡片 = 严重度色条 / kind 图标 / title / body 1 行 / reason / 相对时间 / 未读点；
  - footer：`清空已读`；
  - empty：`暂无通知`。
- 点击卡片：markRead + `handleNotificationTarget(target)` + 关闭面板。
- Esc / 点击外部关闭；↑↓ 移动焦点，Enter 打开。
- 面板状态在 renderer Solid store（`notifications-store.ts`，订阅 `onChanged`）。

## 6. Target 路由（单一落点）

`packages/desktop/src/shared/notification-target.ts`（类型）+ renderer
`notifications/target-router.ts`（纯映射，可测）：

| target | 落点 |
|---|---|
| `session` | 切项目（如需）→ `openSessionTab(sessionID)` |
| `goal` | 切项目 → `openGoalAndDiscuss(goalId, focus)`；`focus:"question"` 用于 Goal 级 askUser |
| `approval` | `openSessionTab(sessionID)`（权限卡在该会话内；requestId 供后续定位） |
| `question` | `openSessionTab(sessionID)`（会话级提问卡；requestId 供后续定位） |
| `work` | 切项目 → `openProjectWork()` |
| `config` | `setShowConfig(true)`（可定位 section） |

**Goal 级提问**（`user_question` 事件只有 `goalId + questionId`，没有 sessionID）：
target 用 `{type:"goal", goalId, focus:"question"}`，直接打开 Goal 详情的问题面板；
不伪造 session tab。**不再有 `execution` target**：执行抽屉已退役，子代理/后台完成
（p3）保持 toast-only，不进通知中心。

主进程 `navigateToTarget(target)`：取最后焦点窗口；无窗口则 `createMainWindow()`，
`did-finish-load` 后发 `mafw-notification-open`；有窗口 `show()/focus()` 后发送。
renderer `navigate.onNotification` 消费 → `handleNotificationTarget`。
现有 `navigateToGoal` 保留为 `navigateToTarget({type:"goal"})` 的兼容壳。

## 7. 来源接线

| 来源 | 映射 |
|---|---|
| presence attention | `kind:"attention"`, `p2`, `reason:"需要你"`, target goal（`question` kind → focus question，`plan_approval` → plan，`direction` → direction，其余 timeline）；dedupe `item.id` |
| presence result | `kind:"goal_result"`, `p1`, target goal/result；dedupe `${goalId}:r${revision}`；文案用通用「Goal 结果就绪」（presence 不带 verdict，不额外拉详情） |
| `permission.asked` | renderer publish `kind:"permission"`, `p2`, target approval；dedupe `permission:${id}` |
| `question.asked` | `kind:"question"`, `p2`, target question（sessionID 来自事件）；dedupe `question:${id}` |
| `user_question`（Goal askUser） | `kind:"question"`, `p2`, target goal/focus question；dedupe `user-question:${questionId}` |

**解决即已读**：
- `permission.replied` / `question.replied` → `hub.markReadByDedupe(["permission:"+id])` /
  `["question:"+id]`（不删除，保留历史）；
- 每次 presence 快照的 attention 列表是权威活动集：`hub.reconcileAttention(activeIds)` 把
  不在集合里的 attention 条目标为已读（人已经在别处处理，铃铛不应继续催）；
- Goal 结果：用户打开结果（现有 `pod.events.seenAll`）→ 对应 `goalId:r<rev>` 标已读；
- 失败的 Goal 同时出现在 `unreadResults.latest` 和 attention `kind:"failed"` 时，
  **只保留 p1 结果条目**（跳过同 goal+revision 的 failed attention），避免双条。

原生 `new Notification` 在 presence 与 `mafw-notify` 两处全部移除；
`window.api.mafw.notify` 保留为 `notifications.publish` 的薄别名（防旧 renderer 断裂）。
子代理/后台任务终态继续走现有 toast（`buildTerminalNotice` / `buildBackgroundNotice`），
不进 hub。

## 8. 非目标（v1）

- 不做 Done/Saved/Snooze 三态 triage（只做未读/已读/清空）；
- 不做跨设备同步 / 手机 FCM；
- 不做通知时间窗、勿扰时段（只有 DND 开关）；
- 不做每通知多动作按钮（v1 单击即打开）；
- p3（子代理/后台任务完成）不进中心，保持 toast-only；
- 不改 gateway / SDK 契约（纯 desktop）。

## 9. 测试与门禁

- `notification-model.test.ts`：dedupe / cap / unread / 排序 / target 校验 / seenKeys 墓碑；
- `notification-hub.test.ts`：publish/list/mark/clear/persist/fail-open / reconcileAttention / markReadByDedupe；
- `notification-placement.test.ts`：右下、堆叠、3 张上限、多屏 clamp、DND；
- `notification-window.test.ts` / `notification-center-model.test.ts`：分组、过滤、文案；
- `target-router.test.ts`：6 种 target 的映射与项目切换（含 goal question）；
- wiring：`notification-center-wiring.test.ts`（rail 铃铛、面板、无原生 `new Notification`）、
  `notification-source-wiring.test.ts`（presence/permission/question 的 publish 与
  replied → markRead 接线）；
- 手工冒烟：隐藏窗口触发 p2 → 自绘窗出现 → 点击 → 主窗口聚焦并打开 Goal/会话；
  铃铛面板未读/已读/清空；权限答复后条目自动已读；p3 仍只有 toast、无铃铛徽标。

## 10. 风险 / 边界

- 透明置顶窗在 Windows 的点击/穿透与多屏 DPI：用单窗 + 固定卡片宽高，clamp 到 workArea；
- `focusable:false` 的鼠标点击在 Electron 可用，但键盘不可达；无障碍入口在中心面板；
- 应用完全退出后无通知（保持 tray 常驻语义）；
- presence 的 attention 解析（reply/timeout）依赖下一次 15s 快照；`pod.event` 到达会立即
  `presence.refresh()`，所以正常路径是秒级；
- 并行工作区存在其它未提交改动，本批只提交通知相关文件。
