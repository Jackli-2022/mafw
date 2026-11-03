import { For, Show, createEffect, createSignal } from "solid-js"
import type { PodGoalResult, PodGoalRevision } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import {
  podHttpStatus,
  podResultAssessmentLabel,
  rejectButtonLabel,
  rejectErrorMessage,
  resultStatus,
  revisionHistory,
} from "../pod-model"
import { markResultViewedAfterLoad } from "../pod-result-store"

const TASK_RESULT_LABEL = { pass: "通过", fail: "失败", skipped: "跳过" } as const
const artifactName = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value

/**
 * 结果正文（Task 13 单一实现）：
 * - 当前 revision 的结果 + Goal 验收条件 + 逐任务证据；
 * - 版本历史（新→旧，旧版本 verdict/feedback 永不丢）；
 * - 已收尾的版本可打回给 Tech Lead（反馈必填），quick 与协作结果同样可达。
 *
 * Goal 详情与兼容的 PodResultPanel 都渲染这个组件，不再维护第二套结果状态。
 */
export function PodResultView(props: {
  podId: string
  goalId: string
  onResubmit?: (result: PodGoalResult) => void
  onReject: (feedback: string) => Promise<boolean>
}) {
  const [result, setResult] = createSignal<PodGoalResult | null>(null)
  const [revisions, setRevisions] = createSignal<PodGoalRevision[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  const [rejecting, setRejecting] = createSignal(false)
  const [rejectError, setRejectError] = createSignal<string | null>(null)

  let loadSeq = 0
  createEffect(() => {
    const goalId = props.goalId
    const podId = props.podId
    const my = ++loadSeq
    setLoading(true)
    setError(null)
    setResult(null)
    setRevisions([])
    setFeedback("")
    setRejectError(null)
    // revisions 失败（旧 gateway / 无权限）不影响结果本身：fail-open 空历史。
    void Promise.allSettled([
      window.api.mafw.pod.result(podId, goalId),
      window.api.mafw.pod.revisions(podId, goalId),
    ])
      .then(([resultRes, revisionRes]) => {
        if (my !== loadSeq) return
        const revisionItems = revisionRes.status === "fulfilled" && Array.isArray(revisionRes.value?.items)
          ? revisionRes.value.items
          : []
        if (resultRes.status === "fulfilled") {
          setResult(resultRes.value)
          // 已查看只在**结果数据真的加载成功**后标记（打开面板本身不算）：
          // 结果接口失败时 rail 的「有新结果」必须保留，用户可以稍后重试。
          markResultViewedAfterLoad({
            podId,
            goalId,
            result: resultRes.value as typeof resultRes.value & { revision?: number | null },
            fallbackRevision: revisionItems.length > 0
              ? Math.max(...revisionItems.map((item) => item.revision))
              : null,
          })
        } else {
          setError(String((resultRes.reason as any)?.message ?? resultRes.reason))
        }
        if (revisionItems.length > 0) setRevisions(revisionItems)
      })
      .finally(() => {
        if (my === loadSeq) setLoading(false)
      })
  })

  const failed = () => {
    const verdict = result()?.verdict
    return verdict === "FAIL" || verdict === "MAX_RETRIES" || verdict === "ERROR"
  }

  const activeRevision = () => {
    const list = revisions()
    return list.length > 0 ? Math.max(...list.map((item) => item.revision)) : null
  }
  const revisionRows = () => revisionHistory(revisions(), activeRevision())
  const currentStatus = () => revisionRows().find((row) => row.current)?.status ?? null
  const rejectLabel = () => rejectButtonLabel({ status: currentStatus() })
  const assessmentLabel = () => {
    const value = result()
    if (!value) return null
    return podResultAssessmentLabel({
      verdict: value.verdict,
      assessment: value.assessment ?? null,
      reviewed: value.reviewed,
    })
  }

  const submitReject = async () => {
    const text = feedback().trim()
    if (!text || rejecting()) return
    setRejecting(true)
    setRejectError(null)
    try {
      if (await props.onReject(text)) setFeedback("")
    } catch (err: any) {
      setRejectError(rejectErrorMessage(podHttpStatus(err)))
    } finally {
      setRejecting(false)
    }
  }

  return (
    <div class="mafw-pod-result">
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
              {resultStatus({
                verdict: value().verdict,
                revision: activeRevision(),
                assessment: value().assessment ?? null,
                reviewed: value().reviewed,
              })}
              <Show when={assessmentLabel()}>
                {(label) => <span class="mafw-pod-result-assessment">{label()}</span>}
              </Show>
            </div>

            <Show when={revisionRows().length > 0}>
              <div class="mafw-pod-result-label">版本历史</div>
              <div class="mafw-pod-result-revisions">
                <For each={revisionRows()}>
                  {(row) => (
                    <div class="mafw-pod-result-revision" classList={{ "is-current": row.current }}>
                      <span class="mafw-pod-result-revision-id">revision {row.revision}</span>
                      <span class="mafw-pod-result-revision-status">{row.statusLabel}</span>
                      <Show when={row.verdictLabel}>
                        <span class="mafw-pod-result-revision-verdict">{row.verdictLabel}</span>
                      </Show>
                      <Show when={row.feedback}>
                        <span class="mafw-pod-result-revision-feedback">{row.feedback}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={value().goalAcceptance.length > 0}>
              <div class="mafw-pod-result-label">Goal 条件与验收</div>
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
            <Show when={props.onResubmit && failed()}>
              <ButtonV2 variant="outline" size="small" onClick={() => props.onResubmit?.(value())}>
                基于失败反馈重新提交
              </ButtonV2>
            </Show>

            <Show when={rejectLabel()}>
              {(label) => (
                <div class="mafw-pod-result-reject">
                  <div class="mafw-pod-result-label">打回给 Tech Lead（会开下一个 revision，旧版结果保留）</div>
                  <TextareaV2
                    rows={3}
                    value={feedback()}
                    placeholder="写清楚哪里不达标、下一版要改什么"
                    onInput={(event) => setFeedback(event.currentTarget.value)}
                  />
                  <Show when={rejectError()}>
                    <div class="mafw-pod-result-error">{rejectError()}</div>
                  </Show>
                  <ButtonV2
                    variant="outline"
                    size="small"
                    disabled={!feedback().trim() || rejecting()}
                    onClick={() => void submitReject()}
                  >
                    {rejecting() ? "打回中…" : label()}
                  </ButtonV2>
                </div>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
