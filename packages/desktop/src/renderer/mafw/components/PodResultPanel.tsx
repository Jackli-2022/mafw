import { For, Show, createEffect, createSignal } from "solid-js"
import type { PodGoalResult } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { podGoalResultLabel } from "../pod-model"

const TASK_RESULT_LABEL = { pass: "通过", fail: "失败", skipped: "跳过" } as const
const artifactName = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value

export function PodResultPanel(props: {
  podId: string
  goalId: string
  onClose: () => void
  onResubmit: (result: PodGoalResult) => void
}) {
  const [result, setResult] = createSignal<PodGoalResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  createEffect(() => {
    const goalId = props.goalId
    const podId = props.podId
    setLoading(true)
    setError(null)
    void window.api.mafw.pod.result(podId, goalId)
      .then((next) => setResult(next))
      .catch((err: any) => setError(String(err?.message ?? err)))
      .finally(() => setLoading(false))
  })

  const failed = () => {
    const verdict = result()?.verdict
    return verdict === "FAIL" || verdict === "MAX_RETRIES" || verdict === "ERROR"
  }

  return (
    <div class="mafw-pod-result">
      <div class="mafw-pod-section-head">
        <span>结果</span>
        <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>关闭</ButtonV2>
      </div>
      <Show when={loading()}>
        <LoaderV2 width={16} height={16} />
      </Show>
      <Show when={error()}>
        <div class="mafw-pod-result-error">{error()}</div>
      </Show>
      <Show when={result()}>
        {(value) => (
          <>
            <div class="mafw-pod-result-verdict" classList={{ failed: failed() }}>
              {podGoalResultLabel(value().verdict)}
            </div>
            <Show when={value().goalAcceptance.length > 0}>
              <div class="mafw-pod-result-label">目标验收</div>
              <ul class="mafw-pod-result-list">
                <For each={value().goalAcceptance}>{(item) => <li>{item}</li>}</For>
              </ul>
            </Show>
            <div class="mafw-pod-result-label">逐任务证据</div>
            <Show when={value().tasks.length > 0} fallback={<div class="mafw-pod-empty-line">没有可解析的逐任务证据</div>}>
              <For each={value().tasks}>
                {(task) => (
                  <div class="mafw-pod-result-task">
                    <span class={`mafw-pod-result-task-state is-${task.result}`}>{TASK_RESULT_LABEL[task.result]}</span>
                    <span class="mafw-pod-result-task-id">{task.taskId}</span>
                    <span class="mafw-pod-result-task-evidence">{task.evidence}</span>
                  </div>
                )}
              </For>
            </Show>
            <Show when={value().reviewFeedback}>
              <div class="mafw-pod-result-label">Review feedback</div>
              <div class="mafw-pod-result-feedback">{value().reviewFeedback}</div>
            </Show>
            <Show when={value().artifacts.length > 0}>
              <div class="mafw-pod-result-label">产物</div>
              <ul class="mafw-pod-result-list">
                <For each={value().artifacts}>{(item) => <li><code>{artifactName(item)}</code></li>}</For>
              </ul>
            </Show>
            <Show when={failed()}>
              <ButtonV2 variant="outline" size="small" onClick={() => props.onResubmit(value())}>
                基于失败反馈重新提交
              </ButtonV2>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
