// Task 21 接线契约：结果通知 / 打回 / revision 历史。
//
// 关键不变量：
//   1. 结果事件（pod.updated kind=result）→ 隐藏时 OS 通知 + toast；rail 上出现
//      「有新结果」点，但不增加 attention 数字徽标。
//   2. 点通知回到窗口后直接打开该 Goal 的结果面板；打开即标记已查看（持久化）。
//   3. 结果面板可打回（反馈必填），成功后打开同一 Goal 的 Tech Lead 讨论（新 revision）。
//   4. 队列/详情显示 revision；旧 revision 历史（verdict/feedback）永不丢。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { podRailBadge } from "../src/renderer/mafw/pod-rail-badge"
import { podResultEvent, resultStatus } from "../src/renderer/mafw/pod-model"
import { techLeadTabTitle } from "../src/renderer/mafw/pod-store"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const podResultPanel = read("../src/renderer/mafw/components/PodResultPanel.tsx")
const podDock = read("../src/renderer/mafw/components/PodDock.tsx")
const board = read("../src/renderer/mafw/components/PodTaskBoard.tsx")
const goalDetail = read("../src/renderer/mafw/components/GoalDetailOverlay.tsx")
const rail = read("../src/renderer/mafw/components/IconRail.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const resultStore = read("../src/renderer/mafw/pod-result-store.ts")
const css = read("../src/renderer/mafw/mafw.css")

/** 取选择器（首次出现）的规则体；找不到返回空串。 */
function cssBlock(selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) return ""
  const open = css.indexOf("{", start)
  let depth = 1
  let i = open + 1
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++
    if (css[i] === "}") depth--
    i++
  }
  return css.slice(open + 1, i - 1)
}

test("结果面板：revision 状态 + Goal 验收/证据 + 版本历史", () => {
  assert.match(podResultPanel, /resultStatus\(/)
  assert.match(podResultPanel, /revisionHistory\(/)
  assert.match(podResultPanel, /goalAcceptance/)
  assert.match(podResultPanel, /逐任务证据/)
  assert.match(podResultPanel, /版本历史/)
  assert.match(podResultPanel, /revisionStatusLabel\(|statusLabel/)
})

test("打回：反馈必填、按钮文案单一来源、调 pod.rejectResult", () => {
  assert.match(podResultPanel, /rejectButtonLabel\(/)
  assert.match(podResultPanel, /TextareaV2/)
  assert.match(podResultPanel, /disabled=\{!feedback\(\)\.trim\(\)/)
  assert.match(podDock, /pod\.rejectResult\(/)
  assert.match(podDock, /requestPodTechLeadOpen\(/)
  assert.match(shell, /podTechLeadOpenRequest\(\)/)
  assert.match(shell, /openTechLead\(/)
})

test("结果事件：隐藏时 OS 通知 + 未查看结果点（不掺 attention）", () => {
  assert.match(shell, /podResultEvent\(/)
  assert.match(shell, /notifyIfHidden\(/)
  assert.match(shell, /podResultBadge\(/)
  assert.match(shell, /podResultDot=/)
  assert.match(rail, /podResultDot/)
  assert.match(rail, /mafw-icon-rail-result-dot/)
  assert.match(cssBlock(".mafw-icon-rail-result-dot {"), /var\(--accent\)/)

  const attention = [{ id: "a", goalId: "g1" }]
  assert.equal(podRailBadge({ attention, unread: 4, resultReady: true }), 1)
})

test("从通知打开结果：visibilitychange 后请求打开结果面板", () => {
  assert.match(shell, /visibilitychange/)
  assert.match(shell, /requestPodResultOpen\(/)
  assert.match(podDock, /podResultOpenRequest\(\)/)
  assert.match(podDock, /setResultGoalId\(request\.goalId\)/)
})

test("查看结果清除未读点（localStorage 持久化，键含 revision）", () => {
  assert.match(podDock, /markPodResultViewed\(/)
  assert.match(resultStore, /mafw-pod-result-viewed/)
  assert.match(resultStore, /addViewedResult/)
  assert.match(resultStore, /resultViewedKey/)
})

test("队列/详情显示 revision，旧版本历史保留", () => {
  assert.match(board, /goalRevisionOf\(/)
  assert.match(board, /rev \{/)
  assert.match(goalDetail, /revisionHistory\(/)
  assert.match(goalDetail, /版本历史/)
  assert.match(goalDetail, /revisionStatusLabel\(/)
  assert.match(cssBlock(".mafw-pod-result-revision {"), /grid|flex/)
})

test("进度条按 revision 标注旧结果不冒充当前版（纯函数）", () => {
  assert.equal(resultStatus({ verdict: "PASS", revision: 2 }), "revision 2 · 已通过")
  assert.deepEqual(
    podResultEvent({ type: "pod.updated", properties: { podId: "pod_1", kind: "result", goalId: "g1" } }),
    { podId: "pod_1", goalId: "g1" },
  )
})

test("打回后的 Tech Lead tab 标题带新 revision（rev 1 不啰嗦）", () => {
  assert.equal(techLeadTabTitle("Pod loop", 2), "Tech Lead · Pod loop · rev 2")
  assert.equal(techLeadTabTitle("Pod loop", 1), "Tech Lead · Pod loop")
  assert.equal(techLeadTabTitle("", 3), "Tech Lead · 未命名目标 · rev 3")
  assert.doesNotMatch(techLeadTabTitle("Pod loop", 2), /ses_|session/i)
})

test("设计契约：结果面板/版本历史无裸 button/input/title", () => {
  for (const [name, src] of [
    ["PodResultPanel", podResultPanel],
    ["GoalDetailOverlay", goalDetail],
  ] as const) {
    assert.doesNotMatch(src, /<button/, `${name} 不得用裸 button`)
    assert.doesNotMatch(src, /<input/, `${name} 不得用裸 input`)
    assert.doesNotMatch(src, /\stitle=/, `${name} 不得用裸 title`)
  }
  assert.match(podResultPanel, /ButtonV2/)
  assert.match(podResultPanel, /TextareaV2/)
})
