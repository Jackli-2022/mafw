// 托盘/通知 → 打开 Goal 的接线契约（2026-11-17 自绘通知中心版）。
// 关键不变量：
//   1. main 的托盘状态行点击仍发 mafw-navigate-goal（navigateToGoal 保留）。
//   2. presence 快照进通知 hub（publishPresenceNotifications），不再有原生
//      notification.on("click") —— 通知点击统一走 navigateToNotificationTarget
//      → mafw-notification-open（悬浮窗/中心面板共用）。
//   3. preload 暴露 navigate.onGoal + navigate.onNotification。
//   4. renderer 收到后先切项目（跨项目）再打开统一 Goal 详情。
//   5. pod.event 到达时催一次 presence 轮询（完成通知不等 15s）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const main = read("../src/main/index.ts")
const tray = read("../src/main/tray.ts")
const preload = read("../src/preload/mafw-api.ts")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("main: presence goes to the hub; notification clicks navigate via the target router", () => {
  assert.match(main, /function navigateToGoal\(target: NavigateGoalTarget\)/)
  assert.match(main, /setTrayNavigateHandler\(navigateToGoal\)/)
  assert.match(main, /publishPresenceNotifications\(notificationHub, payload\)/)
  assert.match(main, /function navigateToNotificationTarget\(target/)
  assert.match(main, /webContents\.send\("mafw-notification-open", target\)/)
  // 旧通道也过 sanitize；悬浮窗销毁时解绑 ipcMain 监听（M-3/M-4）。
  assert.match(main, /sanitizeNotificationInput/)
  assert.match(main, /ipcMain\.removeListener\(channel/)
  assert.doesNotMatch(main, /notification\.on\("click"/)
  assert.match(tray, /NavigateGoalTarget/)
})

test("preload: navigate.onGoal and navigate.onNotification subscribe to their channels", () => {
  assert.match(preload, /navigate: \{/)
  assert.match(preload, /ipcRenderer\.on\("mafw-navigate-goal", handler\)/)
  assert.match(preload, /removeListener\("mafw-navigate-goal", handler\)/)
  assert.match(preload, /ipcRenderer\.on\("mafw-notification-open", handler\)/)
  assert.match(preload, /presence: \{[\s\S]{0,120}?mafw-presence-refresh/)
})

test("renderer: switch project then open the target; pod.event pokes presence", () => {
  assert.match(shell, /mafw\.navigate\.onGoal\(/)
  assert.match(shell, /handleSelectProject\(projectDir\)/)
  assert.match(shell, /openGoalAndDiscuss\(goalId, "result"\)/)
  assert.match(shell, /mafw\.navigate\.onNotification\(/)
  assert.match(shell, /mafw\.presence\.refresh\(\)/)
})
