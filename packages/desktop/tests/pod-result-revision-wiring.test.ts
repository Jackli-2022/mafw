// Task 21 + Task 9 接线契约：结果通知 / 打回 / revision 历史。
//
// 关键不变量：
//   1. 完成通知归 main 的 presence 轮询（事件层唯一所有）；渲染层只保留「有新结果」点，
//      且不增加 attention 数字徽标。
//   2. `pod.event` 进 inbox store；「未查看」标记在结果数据加载成功后才清（seenAll），
//      打开面板本身不算，加载失败要保留结果点。legacy localStorage 只读兜底旧 gateway。
//   3. 结果面板可打回（反馈必填），成功后打开同一 Goal 的 Tech Lead 讨论（新 revision）。
//   4. 队列/详情显示 revision；旧 revision 历史（verdict/feedback）永不丢。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { podRailBadge } from "../src/renderer/mafw/pod-rail-badge"
import { resultStatus } from "../src/renderer/mafw/pod-model"
import { techLeadTabTitle } from "../src/renderer/mafw/pod-store"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const podResultView = read("../src/renderer/mafw/components/PodResultView.tsx")
const podDock = read("../src/renderer/mafw/components/PodDock.tsx")
const workOverview = read("../src/renderer/mafw/components/WorkOverview.tsx")
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
  assert.match(podResultView, /resultStatus\(/)
  assert.match(podResultView, /revisionHistory\(/)
  assert.match(podResultView, /goalAcceptance/)
  assert.match(podResultView, /逐任务证据/)
  assert.match(podResultView, /版本历史/)
  assert.match(podResultView, /revisionStatusLabel\(|statusLabel/)
})

test("打回：反馈必填、按钮文案单一来源、调 pod.rejectResult", () => {
  assert.match(podResultView, /rejectButtonLabel\(/)
  assert.match(podResultView, /TextareaV2/)
  assert.match(podResultView, /disabled=\{!feedback\(\)\.trim\(\)/)
  assert.match(goalDetail, /pod\.rejectResult\(/)
  assert.match(goalDetail, /requestPodTechLeadOpen\(/)
  assert.match(shell, /podTechLeadOpenRequest\(\)/)
  assert.match(shell, /openTechLead\(/)
  // 失败必须冒泡到面板做内联提示：调用方不得自己吞掉错误（面板 rejectError 会成死分支）。
  assert.match(podResultView, /setRejectError\(rejectErrorMessage\(podHttpStatus\(err\)\)\)/)
  assert.doesNotMatch(podDock, /rejectErrorMessage/)
})

test("结果点由事件层驱动（完成通知归 main presence，不掺 attention）", () => {
  assert.match(shell, /onPodEvent/)
  assert.match(shell, /podEvents\.ingest\(/)
  assert.match(shell, /podResultBadge\(/)
  assert.match(shell, /podResultDot=/)
  assert.match(rail, /podResultDot/)
  assert.match(rail, /mafw-icon-rail-result-dot/)
  assert.match(cssBlock(".mafw-icon-rail-result-dot {"), /var\(--accent\)/)
  // 渲染层 toast/OS 通知链已退役（spec 2026-11-04 §7）：否则同一个结果会双通知。
  assert.doesNotMatch(shell, /podResultEvent\(/)
  assert.doesNotMatch(shell, /podResultNotice\(/)

  const attention = [{ id: "a", goalId: "g1" }]
  assert.equal(podRailBadge({ attention, unread: 4, resultReady: true }), 1)
})

test("pod.event 进 inbox store，工作概览给未查看结果加标记", () => {
  assert.match(shell, /onPodEvent: \(event\) => \{ podEvents\.ingest\(event\) \}/)
  assert.match(workOverview, /is-unviewed/)
  assert.match(cssBlock(".mafw-work-chip.is-unviewed {"), /var\(--accent\)/)
})

test("查看结果清除未读点（seenAll；只在加载成功后标记；legacy localStorage 只读兜底）", () => {
  assert.match(podResultView, /markResultViewedAfterLoad\(/)
  assert.doesNotMatch(podDock, /markPodResultViewed\(/, "打开面板不算查看")
  assert.match(resultStore, /events\.markSeen\(/)
  assert.match(resultStore, /isResultViewed\(/)
  assert.match(resultStore, /mafw-pod-result-viewed/)
  assert.match(resultStore, /addViewedResult/)
  assert.match(resultStore, /resultViewedKey/)
})

test("队列/详情显示 revision，旧版本历史保留", () => {
  assert.match(workOverview, /rev \$\{goal\.revision\}/)
  assert.match(workOverview, /goal\.revision/)
  assert.match(goalDetail, /revisionHistory\(/)
  assert.match(goalDetail, /版本历史/)
  assert.match(goalDetail, /revisionStatusLabel\(/)
  assert.match(cssBlock(".mafw-pod-result-revision {"), /grid|flex/)
})

test("进度条按 revision 标注旧结果不冒充当前版（纯函数）", () => {
  assert.equal(resultStatus({ verdict: "PASS", revision: 2 }), "revision 2 · 已通过")
})

test("打回后的 Tech Lead tab 标题带新 revision（rev 1 不啰嗦）", () => {
  assert.equal(techLeadTabTitle("Pod loop", 2), "Tech Lead · Pod loop · rev 2")
  assert.equal(techLeadTabTitle("Pod loop", 1), "Tech Lead · Pod loop")
  assert.equal(techLeadTabTitle("", 3), "Tech Lead · 未命名目标 · rev 3")
  assert.doesNotMatch(techLeadTabTitle("Pod loop", 2), /ses_|session/i)
})

test("设计契约：结果面板/版本历史无裸 button/input/title", () => {
  for (const [name, src] of [
    ["PodResultView", podResultView],
    ["GoalDetailOverlay", goalDetail],
  ] as const) {
    assert.doesNotMatch(src, /<button/, `${name} 不得用裸 button`)
    assert.doesNotMatch(src, /<input/, `${name} 不得用裸 input`)
    assert.doesNotMatch(src, /\stitle=/, `${name} 不得用裸 title`)
  }
  assert.match(podResultView, /ButtonV2/)
  assert.match(podResultView, /TextareaV2/)
})
