// 托盘/OS 通知 → 打开 Goal 的接线契约（2026-11-05 deferred 收口）。
// 关键不变量：
//   1. main 的托盘状态行与结果通知点击都能发出 mafw-navigate-goal（带 projectId）。
//   2. preload 暴露 navigate.onGoal，且只注册一个 IPC 监听。
//   3. renderer 收到后先切项目（跨项目）再打开统一 Goal 详情。
//   4. pod.event 到达时催一次 presence 轮询（完成通知不等 15s）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const main = read("../src/main/index.ts")
const tray = read("../src/main/tray.ts")
const preload = read("../src/preload/mafw-api.ts")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("main: tray and result-notification clicks navigate to the goal", () => {
  assert.match(main, /function navigateToGoal\(target: NavigateGoalTarget\)/)
  assert.match(main, /setTrayNavigateHandler\(navigateToGoal\)/)
  assert.match(main, /notification\.on\("click"/)
  assert.match(main, /webContents\.send\("mafw-navigate-goal", target\)/)
  assert.match(main, /projectId: latest\.projectId/)
  assert.match(tray, /NavigateGoalTarget/)
})

test("preload: navigate.onGoal subscribes and unsubscribes the IPC channel", () => {
  assert.match(preload, /navigate: \{/)
  assert.match(preload, /ipcRenderer\.on\("mafw-navigate-goal", handler\)/)
  assert.match(preload, /removeListener\("mafw-navigate-goal", handler\)/)
  assert.match(preload, /presence: \{[\s\S]{0,120}?mafw-presence-refresh/)
})

test("renderer: switch project then open Goal detail; pod.event pokes presence", () => {
  assert.match(shell, /mafw\.navigate\.onGoal\(/)
  assert.match(shell, /handleSelectProject\(projectDir\)/)
  assert.match(shell, /openGoalDetail\(goalId, "result"\)/)
  assert.match(shell, /mafw\.presence\.refresh\(\)/)
})
