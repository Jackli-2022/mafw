import type { PodGoalResult } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { PodResultView } from "./PodResultView"

/**
 * 兼容薄壳：PodDock 仍用「结果」独立面板打开，但正文、版本历史与打回
 * 只有 `PodResultView` 一套实现（Goal 详情渲染同一组件）。
 */
export function PodResultPanel(props: {
  podId: string
  goalId: string
  onClose: () => void
  onResubmit: (result: PodGoalResult) => void
  onReject: (feedback: string) => Promise<boolean>
}) {
  return (
    <div class="mafw-pod-result-panel">
      <div class="mafw-pod-section-head">
        <span>结果</span>
        <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>关闭</ButtonV2>
      </div>
      <PodResultView
        podId={props.podId}
        goalId={props.goalId}
        onResubmit={props.onResubmit}
        onReject={props.onReject}
      />
    </div>
  )
}
