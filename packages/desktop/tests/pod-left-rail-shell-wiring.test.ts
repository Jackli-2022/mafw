import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("../src/renderer/mafw/MafwShell.tsx", import.meta.url), "utf8")
const dock = readFileSync(new URL("../src/renderer/mafw/components/PodDock.tsx", import.meta.url), "utf8")

test("shell owns the pod subscription and feeds the rail badge", () => {
  assert.match(shell, /podRailBadge\(/)
  assert.match(shell, /podBadge=\{/)
  assert.match(shell, /podStore\.open\(/)
  assert.match(shell, /onPodOpenPanel/)
  assert.match(shell, /onPodOpenMessage/)
  assert.doesNotMatch(shell, /onPodSend/)
  assert.match(shell, /setActiveTab\("chat"\)/)
  assert.match(shell, /panel === "inbox"/)
  assert.doesNotMatch(shell, /void panel/)
  // 两个 shell effect 必须用 on() 隔离依赖，否则 refresh()/open() 的同步 signal
  // 读取会把 effect 绑到 detail/refreshing 上，形成刷新自激。
  assert.match(shell, /on\(\(\) => benchRoot\(\) \?\? currentProject\(\)/)
  assert.match(shell, /on\(\(\) => connPhaseLabel\(\)/)
})

test("right workbench no longer owns the first pod load", () => {
  // 自触发回归：refresh() 同步读 detail()/refreshing()，裸 createEffect 会订阅它们，
  // setRefreshing 再触发 effect → 无限刷新（pod listMessages / cost 打屏）。
  assert.match(dock, /createEffect\(on\(\(\) => props\.active/)
  assert.match(dock, /if \(active\) void podStore\.refresh\(\)/)
})
