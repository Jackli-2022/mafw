# 2026-11-17 · 自绘通知中心 + 悬浮通知窗

- **分支**：`main`
- **Spec**：`docs/superpowers/specs/2026-11-17-notification-center-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-17-notification-center.md`
- **实现 commits**：Task 1-10（model → hub → 布局/队列 → IPC → 路由 → presence → 中心 → 悬浮窗 → 来源接线 → Config）

## 交付

### ① 应用内通知中心
- rail 铃铛（`bell` 图标 + 未读角标 9+）→ `NotificationCenter` 锚定面板：
  全部/未读筛选、全部已读、清空已读、键盘 ↑↓/Enter/Esc。
- 每条通知带 kind 图标、reason、相对时间、未读点。

### ② 自绘悬浮通知窗
- 独立无边框透明置顶窗（`focusable:false` + `showInactive`，不抢焦点）；
  右下堆叠最多 3 张、6s 自动消失、hover 暂停、可手动关闭。
- 只收 p1（Goal 结果）/ p2（需要你）；点击 → 标已读 + 聚焦主窗口 + target 路由。
- 创建失败或自绘关闭时退回原生通知（`fallbackToNative` 开关）；勿扰只静默弹窗。

### 统一数据源 `NotificationHub`（main）
- `electron-store("mafw-notifications")` 持久化；`dedupeKey + seenKeys` 墓碑（cap 1000）；
  条目 cap 200（先丢最旧已读）。
- 来源：presence attention/结果（`publishPresenceNotifications`）、`permission.asked`、
  `question.asked`、`user_question`（Goal 级 → Goal 问题面板）。
- 已读闭环：权限/提问 replied → `markReadByDedupe`；presence attention 消失 →
  `reconcileAttention`；Goal 结果被查看 → 自动已读。`NotifyState` 退役。
- 原生 `new Notification` 从 presence/`mafw-notify`/`show-notification` 全部退役，
  只保留悬浮窗失败兜底与 `tray-hint` 一次性提示。

### Target 路由
- `session` / `goal`（timeline/result/plan/direction/question）/ `approval` / `question` /
  `work` / `config`；跨项目通知先 `handleSelectProject` 再打开。
- p3（子代理/后台任务完成）保持 in-app toast，不进中心、不计角标（原决议不变）。

### Config
- `桌面集成 › 通知`：自绘悬浮窗 / 勿扰 / 原生兜底，即时生效（`onPrefsChanged` →
  controller.refreshPrefs）。

## 验证

- 新增测试：model 9、hub 7、prefs 3、placement 6、presenter 4、IPC 6、target 3、
  router 6、view-model 4、window controller 8、window model 2、config wiring 2、
  source wiring 6、center wiring 5（更新 completion-notify 3 + navigate-goal 3）。
- desktop 全量 **4016/4016（764 suites）**；`tsgo --noEmit -p tsconfig.json` rc=0；
  `electron-vite build` rc=0（`out/renderer/notification/index.html` +
  `out/preload/notification.js` 多入口产物确认）。

## 已知边界

- `notifyIfHidden` 已删除：renderer 完全不发系统通知（含"需要你"），全部经 hub。
- 通知中心面板锚定 `left:52px`（rail 右缘），覆盖在左 dock 之上（点外部/Esc 关闭）。
- 悬浮窗主题跟 `nativeTheme`（light/dark），不跟随应用内强制主题。
- presence attention 字段在 `presence-model.ts` 仍窄类型为 `{id}`——运行时校验
  （`normalizeAttention`），升级 gateway 后可放宽类型。
