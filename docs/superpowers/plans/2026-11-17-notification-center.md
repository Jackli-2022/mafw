# 自绘通知中心 + 悬浮通知窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 MAFW 自绘的通知中心 + 悬浮通知窗替代桌面原生通知，并让每条通知点击后落到 desktop 的对应位置。

**Architecture:** 主进程 `NotificationHub` 是唯一数据源（持久化、去重、未读/已读、墓碑）。presence 轮询与 renderer 的 permission/question 事件都 publish 到 hub；rail 铃铛面板读 hub，独立无边框置顶窗消费 p1/p2 新条目。两层共用 `NotificationTarget` 路由。

**Tech Stack:** Electron 42 + SolidJS + electron-store；desktop 测试用 `node --test` + `@mafw/test-shim`（必须 `--conditions=browser`）。

**Spec:** `docs/superpowers/specs/2026-11-17-notification-center-design.md`

## Global Constraints

- 只改 desktop（`packages/desktop` + `packages/ui` 的 bell 图标）；不改 gateway / SDK 契约。
- 中心只收 p1/p2；子代理/后台完成（p3）保持现有 toast，不进中心、不计徽标。
- 原生 `new Notification` 只允许作为悬浮窗失败时的兜底；presence / `mafw-notify` 不再直接发原生通知。
- 所有通知必须有 `reason`；`dedupeKey` + `seenKeys` 墓碑保证清空/淘汰后不复活。
- 不新增裸 `<button>` / `<input>` / 裸 `title`；用 `@mafw/ui` v2 组件。
- 工作区有并行未提交改动：每个任务只 `git add` 本任务文件，禁止 `git add -A`。
- 每个任务结束跑对应聚焦测试 + `npx tsgo --noEmit -p tsconfig.json`（desktop 目录）。

---

## Review Focus

- **同一 dedupeKey 在清空/淘汰后再次出现**：必须保持消失，不能复活；只有新 revision / 新 requestId 才是新通知。
- **权限/提问已答复**：对应通知自动已读，铃铛不应继续催；但历史仍可回看。
- **悬浮窗不抢焦点**：点击前不能把正在打字的窗口切走；点击后才聚焦主窗口并导航。
- **多显示器 / DPI**：悬浮窗始终完整落在当前 workArea 内，不能被裁到屏幕外。
- **p3 噪声**：子代理/后台完成不能计入铃铛未读，也不能弹悬浮窗（只保留现有 toast）。

---

### Task 1: 共享类型 + 纯通知模型

**Files:**
- Create: `packages/desktop/src/shared/notifications.ts`
- Create: `packages/desktop/src/main/notification-model.ts`
- Test: `packages/desktop/src/main/notification-model.test.ts`

**Interfaces:**
- Produces:
  - `NotificationSeverity = "p1" | "p2" | "p3"`
  - `NotificationKind = "goal_result" | "attention" | "permission" | "question"`
  - `NotificationTarget` 见 spec §2（`session|goal|approval|question|work|config`；goal focus 含 `question`）
  - `MafwNotification`, `NotificationInput`, `NotificationSnapshot`, `NotificationPrefs`, `DEFAULT_NOTIFICATION_PREFS`
  - `NotificationState = { items: MafwNotification[]; seenKeys: string[] }`
  - `NOTIFICATION_LIMIT = 200`, `NOTIFICATION_SEEN_LIMIT = 1000`
  - `emptyNotificationState()`, `normalizeNotificationState(raw)`
  - `publishNotification(state, input, now): { state, item, isNew }`
  - `markNotificationRead(state, ids | "all", now)`, `markNotificationReadByDedupe(state, keys, now)`
  - `reconcileAttentionNotifications(state, activeIds, now)`
  - `clearReadNotifications(state)`, `removeNotification(state, id)`, `unreadNotificationCount(state)`

- [ ] **Step 1: Write the failing model tests**

Cover: new publish unread; same dedupeKey updates in place and keeps `readAt`; cleared key tombstoned (publish again → `item === null`, no复活); mark read / all; `reconcileAttention` marks absent attention read; cap 200 drops oldest read first; `seenKeys` cap 1000; normalize drops malformed items.

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/notification-model.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `shared/notifications.ts` + `main/notification-model.ts`**

Pure functions only; no Electron imports. `publishNotification`: find by `dedupeKey` or `id`; if not visible but key in `seenKeys` → return `{state, item:null, isNew:false}`; else create with `id = input.id ?? dedupeKey ?? crypto.randomUUID()`, `createdAt = input.createdAt ?? now`, push key to `seenKeys` (cap), cap items.

- [ ] **Step 3: Run tests**

Run same command. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/shared/notifications.ts packages/desktop/src/main/notification-model.ts packages/desktop/src/main/notification-model.test.ts
git commit -m "feat(desktop): add notification model and shared types"
```

---

### Task 2: NotificationHub + prefs

**Files:**
- Create: `packages/desktop/src/main/notification-hub.ts`
- Create: `packages/desktop/src/main/notification-prefs.ts`
- Test: `packages/desktop/src/main/notification-hub.test.ts`, `packages/desktop/src/main/notification-prefs.test.ts`

**Interfaces:**
- Consumes: Task 1 model.
- Produces:
  - `class NotificationHub { constructor(store: { get(key, def?): unknown; set(key, value): void }, now?: () => number); snapshot(): NotificationSnapshot; publish(input: NotificationInput): MafwNotification | null; markRead(ids: string[] | "all"): void; markReadByDedupe(keys: string[]): void; reconcileAttention(activeIds: string[]): void; clearRead(): void; remove(id: string): void; onChange(cb): () => void; onNew(cb: (item) => void): () => void }`
  - `readNotificationPrefs(store?)`, `writeNotificationPrefs(patch, store?)`, `DEFAULT_NOTIFICATION_PREFS`

- [ ] **Step 1: Write failing hub tests**

Memory store; publish is persisted; dedupe no duplicate; `onNew` fires once for a new unread p1/p2; markRead persists; clearRead keeps unread; `reconcileAttention` marks absent read; corrupt store → empty; prefs default + patch + invalid values fallback.

Run: `... --test src/main/notification-hub.test.ts src/main/notification-prefs.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement hub + prefs**

Store key `"state"` for hub snapshot; prefs keys `notifySelfDrawn`, `notifyDoNotDisturb`, `notifyFallbackToNative` (booleans with defaults). Hub emits `onChange` after every mutation; `onNew` only when `isNew && item && item.severity !== "p3"`.

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/notification-hub.ts packages/desktop/src/main/notification-hub.test.ts packages/desktop/src/main/notification-prefs.ts packages/desktop/src/main/notification-prefs.test.ts
git commit -m "feat(desktop): add persisted notification hub and prefs"
```

---

### Task 3: 悬浮窗布局 + 可见队列

**Files:**
- Create: `packages/desktop/src/main/notification-placement.ts`
- Create: `packages/desktop/src/main/notification-presenter.ts`
- Test: `packages/desktop/src/main/notification-placement.test.ts`, `packages/desktop/src/main/notification-presenter.test.ts`

**Interfaces:**
- Produces:
  - `notificationWindowBounds({ workArea: {x,y,width,height}, count, cardWidth?, cardHeight?, gap?, margin?, maxVisible? }): {x,y,width,height}`
    - defaults: card 360×92, gap 10, margin 16, maxVisible 3; bottom-right, stack upward; clamp inside workArea.
  - `class NotificationPresenter { constructor(opts: { maxVisible?: number; autoDismissMs?: number; setTimer?: (fn, ms) => unknown; clearTimer?: (h) => void; onVisibleChange?: (items: MafwNotification[]) => void }); push(item); dismiss(id); hover(id, hovering); take(id): MafwNotification | undefined; visible(): MafwNotification[]; dispose(): void }`
    - max 3 visible: when full, drop the oldest visible (it stays in the center);
    - autoDismissMs default 6000; hover pauses that item's timer; `take` removes and clears timer.

- [ ] **Step 1: Write failing tests**

Placement: bottom-right math, 1/3/5 cards → height clamp to 3, small workArea clamp, zero count. Presenter: push shows, 6s timer removes, hover pauses/resumes, max 3 drops oldest, take returns item.

Run: `... --test src/main/notification-placement.test.ts src/main/notification-presenter.test.ts` → FAIL.

- [ ] **Step 2: Implement placement + presenter** (pure, injected timers).

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/notification-placement.ts packages/desktop/src/main/notification-placement.test.ts packages/desktop/src/main/notification-presenter.ts packages/desktop/src/main/notification-presenter.test.ts
git commit -m "feat(desktop): add notification placement and visible queue"
```

---

### Task 4: 主进程 IPC + preload API

**Files:**
- Create: `packages/desktop/src/main/notification-ipc.ts`
- Test: `packages/desktop/src/main/notification-ipc.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`, `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/main/index.ts`（创建 hub，注册 IPC；presence 接线留到 Task 6）

**Interfaces:**
- Consumes: `NotificationHub`, `readNotificationPrefs/writeNotificationPrefs`.
- Produces:
  - `registerNotificationIpc({ ipcMain, hub, prefs, broadcast }): void`（`broadcast(snapshot)` 注入，便于测试）
  - IPC 通道：`mafw-notifications:list|markRead|markAllRead|markReadByDedupe|clearRead|remove|publish`，`get-notification-prefs`，`set-notification-prefs`
  - preload `window.api.mafw.notifications.{list,markRead,markAllRead,markReadByDedupe,clearRead,remove,publish,onChanged}`
  - preload 顶层 `getNotificationPrefs()` / `setNotificationPrefs(patch)`（沿用 tray prefs 模式）
  - `window.api.mafw.notify` 改为 publish 薄别名（kind attention / p2 / reason 通知）

- [ ] **Step 1: Write failing IPC test**

Injected fake `ipcMain.handle/on` + fake hub; assert each channel maps to the right hub call, `get/set-notification-prefs` round-trip, `publish` returns item, and `broadcast` is called on hub change.

Run: `... --test src/main/notification-ipc.test.ts` → FAIL.

- [ ] **Step 2: Implement IPC + preload**

`registerNotificationIpc` registers handlers; in `index.ts` create `const notificationHub = new NotificationHub(getStore("mafw-notifications"))`, call `registerNotificationIpc` with `broadcast` that sends `mafw-notifications:changed` to `BrowserWindow.getAllWindows()` (skip destroyed). Preload types add the namespace; keep `notify` alias.

- [ ] **Step 3: Run test + tsgo** → PASS / rc=0.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/notification-ipc.ts packages/desktop/src/main/notification-ipc.test.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): expose notification hub over IPC"
```

---

### Task 5: Target 路由（main + renderer）

**Files:**
- Create: `packages/desktop/src/main/notification-target.ts`
- Test: `packages/desktop/src/main/notification-target.test.ts`
- Create: `packages/desktop/src/renderer/mafw/notifications/target-router.ts`
- Test: `packages/desktop/src/renderer/mafw/notifications/target-router.test.ts`
- Modify: `packages/desktop/src/main/index.ts`（`navigateToTarget`，`navigateToGoal` 兼容壳）
- Modify: `packages/desktop/src/preload/mafw-api.ts` / `mafw-types.ts`（`navigate.onNotification`）
- Modify: `packages/desktop/src/main/notification-ipc.ts`（可选：`open` 由浮窗调用）

**Interfaces:**
- Produces:
  - `main/notification-target.ts`: `attentionTarget(item: {kind, goalId, projectId?}): NotificationTarget`（plan_approval→plan、direction_review→direction、question→question、其余 timeline）
  - renderer `navigateNotificationTarget(target, deps): Promise<void>`，deps：
    `{ currentProject(): string | null; selectProject(p: string): Promise<void>; openSession(id: string): void; openGoal(id: string, focus: GoalDetailFocus): void | Promise<void>; openWork(): void; openConfig(): void }`
  - main `navigateToTarget(target: NotificationTarget): void`：取最后焦点窗口；无窗口 create + did-finish-load；有窗口 show/focus；发送 `mafw-notification-open`。
  - preload `navigate.onNotification(cb)`。

- [ ] **Step 1: Write failing tests**

`attentionTarget` mapping; router maps session/goal/approval/question/work/config, switches project only when different, approval/question open session. Run both tests → FAIL.

- [ ] **Step 2: Implement** the two pure modules + main navigation + preload channel.

- [ ] **Step 3: Run tests + tsgo** → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/notification-target.ts packages/desktop/src/main/notification-target.test.ts packages/desktop/src/renderer/mafw/notifications/target-router.ts packages/desktop/src/renderer/mafw/notifications/target-router.test.ts packages/desktop/src/main/index.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): route notifications to desktop targets"
```

---

### Task 6: Presence 接线 + 原生通知退役

**Files:**
- Create: `packages/desktop/src/main/presence-notifications.ts`
- Test: `packages/desktop/src/main/presence-notifications.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`, `packages/desktop/src/main/ipc.ts`
- Delete: `packages/desktop/src/main/notify-state.ts` + `notify-state.test.ts`（无消费者）

**Interfaces:**
- Consumes: `NotificationHub`, `attentionTarget`.
- Produces: `publishPresenceNotifications(hub, payload, deps?: { getGoalDetail? }): void`
  - attention: skip `failed` when `payload.unreadResults.latest` matches same goal+revision; publish `kind:"attention"`, p2, reason `"需要你"`, target `attentionTarget(item)`, dedupe `item.id`.
  - result latest: `kind:"goal_result"`, p1, title `${title} · 结果就绪`, body `"Goal 已归档，点击查看结果"`, reason `"Goal 结果"`, target goal/result, dedupe `${goalId}:r${revision}`.
  - `hub.reconcileAttention(payload.attention.items.map(i => i.id))`.
- `index.ts` presence `onSnapshot`: tray/presence updates unchanged, then `publishPresenceNotifications(notificationHub, payload)`; remove `NotifyState`, `new Notification`, `diffAttention` notifications.
- `mafw-ipc.ts` `mafw-notify` / `ipc.ts` `show-notification`: publish generic attention p2 (`reason:"通知"`, no target) instead of `new Notification`.

- [ ] **Step 1: Write failing presence mapping tests** (attention/result/duplicate failed/skip). Run → FAIL.

- [ ] **Step 2: Implement + wire**; remove native notification calls; delete `notify-state`.

- [ ] **Step 3: Run test + grep** `new Notification` in `main/index.ts`/`mafw-ipc.ts`/`ipc.ts` → none except fallback module (Task 8). Run `tsgo` → 0.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/presence-notifications.ts packages/desktop/src/main/presence-notifications.test.ts packages/desktop/src/main/index.ts packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/notify-state.ts packages/desktop/src/main/notify-state.test.ts
git commit -m "feat(desktop): publish presence events to the notification hub"
```

---

### Task 7: 通知 store + 中心面板 + rail 铃铛

**Files:**
- Create: `packages/desktop/src/renderer/mafw/notifications/notification-store.ts`
- Create: `packages/desktop/src/renderer/mafw/notifications/notification-view-model.ts`
- Test: `packages/desktop/src/renderer/mafw/notifications/notification-view-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/NotificationCenter.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/ui/src/components/icon.tsx`（`bell`）
- Test: `packages/desktop/src/renderer/mafw/notification-center-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（mount + rail props + `navigate.onNotification`）

**Interfaces:**
- Produces:
  - `notificationStore`（Solid）：`items()`, `unread()`, `ensure()`, `refresh()`, `markRead(ids)`, `markAllRead()`, `markReadByDedupe(keys)`, `clearRead()`, `remove(id)`；订阅 `notifications.onChanged`。
  - view model: `filterNotifications(items, "all" | "unread")`, `notificationKindLabel(kind)`, `formatNotificationTime(now, ts)`, `notificationBellAria(unread)`。
  - `IconRail` props: `onNotifications`, `notificationsUnread`, `notificationsActive`；meta 组铃铛在 approvals 上方。
  - `NotificationCenter` props: `{ open: boolean; onClose(): void; onOpenTarget(target): void }`；面板 `left:52px; bottom:16px; width:380px; max-height:60vh`。
- Wiring test asserts: `IconRail` contains `bell` + `onNotifications`; `MafwShell` mounts `<NotificationCenter`; no `new Notification` in renderer; `notification-center-wiring.test.ts` source reads.

- [ ] **Step 1: Write failing view-model tests** (filter, labels, time, aria). Run → FAIL.
- [ ] **Step 2: Implement view model** → PASS.
- [ ] **Step 3: Implement store + center + bell + icon + shell mount**.
- [ ] **Step 4: Write/execute wiring test** → PASS; `tsgo` rc=0.
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/notifications packages/desktop/src/renderer/mafw/components/NotificationCenter.tsx packages/desktop/src/renderer/mafw/components/IconRail.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/notification-center-wiring.test.ts packages/ui/src/components/icon.tsx
git commit -m "feat(desktop): add in-app notification center"
```

---

### Task 8: 悬浮通知窗

**Files:**
- Create: `packages/desktop/src/main/notification-window.ts`
- Test: `packages/desktop/src/main/notification-window.test.ts`（presenter/placement 组合 + prefs gating）
- Create: `packages/desktop/src/preload/notification.ts`
- Create: `packages/desktop/src/renderer/notification/index.html`
- Create: `packages/desktop/src/renderer/notification/main.tsx`
- Create: `packages/desktop/src/renderer/notification/notification.css`
- Test: `packages/desktop/src/renderer/notification/window-model.test.ts`
- Modify: `packages/desktop/electron.vite.config.ts`（preload + renderer 多入口）
- Modify: `packages/desktop/src/main/windows.ts`（export `loadWindow`）
- Modify: `packages/desktop/src/main/index.ts`（create controller on ready; wire hub.onNew）

**Interfaces:**
- Produces:
  - `createNotificationWindowController({ hub, prefs, navigate, getMainWindow, nativeNotify? }): { dispose(): void; refreshPrefs(): void }`
  - `notification-preload` API: `window.notificationApi = { onItems(cb), dismiss(id), hover(id, bool), open(id) }`，channel `notification:items|dismiss|hover|open`。
  - window: 360 宽，`frame:false/transparent/alwaysOnTop/skipTaskbar/focusable:false`，`showInactive`；bottom-right；max 3；6s。
  - prefs: `selfDrawn=false` → native fallback；`doNotDisturb` → no window；`fallbackToNative` → 创建/加载失败时 native。
- Window model test: items/theme state, no duplicate ids.

- [ ] **Step 1: Write failing window/controller tests** (gating: DND no show, selfDrawn false native, presenter integration). Run → FAIL.
- [ ] **Step 2: Implement window controller + preload + entry + CSS + vite inputs**.
- [ ] **Step 3: Run tests + `npx electron-vite build`** → PASS / rc=0 (check `out/renderer/notification/index.html` exists).
- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/main/notification-window.ts packages/desktop/src/main/notification-window.test.ts packages/desktop/src/preload/notification.ts packages/desktop/src/renderer/notification packages/desktop/electron.vite.config.ts packages/desktop/src/main/windows.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): add self-drawn floating notification window"
```

---

### Task 9: Renderer 来源接线（permission / question / result read）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts` + test
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` + test
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`（或 `pod-result-store`）
- Test: `packages/desktop/src/renderer/mafw/notification-source-wiring.test.ts`

**Interfaces:**
- `flowCards` deps: `publish(input: NotificationInput): void`, `markNotificationRead(keys: string[]): void`, `projectOf(sid): string | undefined`.
- `question.asked` → publish kind question / p2 / target question / dedupe `question:${id}`; `permission.asked` → publish permission / target approval / dedupe `permission:${id}`.
- `permission.replied` / `question.replied` → `markNotificationRead(["permission:"+id])` / `["question:"+id]`.
- `core.notify` (dispatcher `user_question`) → publish kind question / p2 / target `{type:"goal", goalId, focus:"question"}` / dedupe `user-question:${questionId}`.
- Goal result viewed: `PodResultView` after load → `markNotificationReadByDedupe([`${goalId}:r${revision}`])`.

- [ ] **Step 1: Write failing handler/source tests** (publish payloads, replied markRead, user_question goal target). Run → FAIL.
- [ ] **Step 2: Implement + wire MafwShell deps**; run tests → PASS; `tsgo` → 0.
- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.test.ts packages/desktop/src/renderer/mafw/sse/dispatcher.ts packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/notification-source-wiring.test.ts
git commit -m "feat(desktop): publish permission and question asks to notifications"
```

---

### Task 10: Config 开关 + 文档 + 全量门禁 + 真机冒烟

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `packages/desktop/src/preload/index.ts`（top-level prefs methods, if not Task 4）
- Test: `packages/desktop/src/renderer/mafw/notification-config-wiring.test.ts`
- Modify: `docs/architecture/desktop.md`
- Create: `docs/releases/2026-11-17-desktop-notification-center.md`

- [ ] **Step 1: Config UI** `Desktop › 通知` 三个 `SwitchV2`：自绘通知窗 / 勿扰 / 原生兜底；保存走 `setNotificationPrefs`，失败回滚 + toast。测试 source wiring。
- [ ] **Step 2: Run full gates**

```bash
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npm test -w @mafw/desktop
cd ../.. && npm run build
```
Expected: tsgo rc=0；desktop all pass；build rc=0。

- [ ] **Step 3: 真机冒烟**（dev app + CDP）：
  1. 隐藏窗口 + 触发 permission/question → 自绘窗出现、不抢焦点；点击 → 主窗口聚焦 + 打开会话；
  2. 铃铛面板未读数、全部已读、清空已读；清空后 presence 再报同一 key 不复活；
  3. p2 在 chat 内答复 → 铃铛条目自动已读；
  4. DND 开 → 不弹窗但中心仍收；自绘关 → 原生兜底；
  5. Goal 级提问点击 → Goal 详情问题面板。

- [ ] **Step 4: 文档 + release note + commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/preload/index.ts packages/desktop/src/renderer/mafw/notification-config-wiring.test.ts docs/architecture/desktop.md docs/releases/2026-11-17-desktop-notification-center.md
git commit -m "feat(desktop): expose notification preferences and document the center"
```

---

## Self-Review

- Spec §2–§9 均有对应任务：模型/ hub（1–2）、布局/队列（3）、IPC（4）、路由（5）、来源（6/9）、中心（7）、悬浮窗（8）、Config/文档（10）。
- 无 `execution` target；p3 不进中心；Goal 提问走 goal/question。
- 类型名跨任务一致：`NotificationHub`、`NotificationPresenter`、`navigateNotificationTarget`、`MafwNotification`、`NotificationInput`。
- Review Focus 五项均在 Task 1/2/3/8/9 有测试或冒烟。
