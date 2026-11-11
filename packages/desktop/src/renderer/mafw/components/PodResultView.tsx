import { For, Show, createEffect, createSignal } from "solid-js"
import type { PodGoalAcceptResult, PodGoalResult, PodGoalRevision, PodReviewItem } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { CheckboxV2 } from "@mafw/ui/v2/checkbox-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import {
  podHttpStatus,
  podResultAssessmentLabel,
  rejectButtonLabel,
  rejectErrorMessage,
  resultStatus,
  revisionHistory,
} from "../pod-model"
import {
  podResultAcceptanceView,
  podResultCanOpenWorktree,
  podResultCanViewDiff,
  podResultConditionRows,
  podResultWorktreeRows,
} from "../pod-result-view-model"
import { DiffReviewPanel, type FileDiffEntry } from "./DiffReviewPanel"
import { PodReviewItems } from "./PodReviewItems"
import { forcedAcceptanceNote, forcedAcceptReady, reviewAcceptAction, reviewCounts } from "../pod-review-model"
import { markResultViewedAfterLoad } from "../pod-result-store"

export type GoalWorktreeTarget = {
  goalId: string
  revision: number
  worktreeDir: string
  title?: string | null
}

const TASK_RESULT_LABEL = { pass: "通过", fail: "失败", skipped: "跳过" } as const
const artifactName = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value

const CONDITION_TONE: Record<string, string> = {
  通过: "is-pass",
  失败: "is-fail",
  跳过: "is-skipped",
  未判定: "is-unknown",
}

/**
 * 结果正文（Task 13 单一实现，Task 6 增补 revision worktree 与人工验收）：
 * - 当前 revision 的结果 + Goal 验收条件 + Goal Eval 逐条件判定 + 逐任务证据；
 * - 代码结果卡（分支/合并目标/状态/合并提交）；
 * - 版本历史（新→旧，旧版本 verdict/feedback 永不丢）；
 * - 已收尾的版本可打回给 Tech Lead（反馈必填），quick 与协作结果同样可达；
 * - 只有可信的成功结果且 worktree 仍待验收时，才给一次性「验收并合并」。
 *
 * Goal 详情与兼容的 PodResultPanel 都渲染这个组件，不再维护第二套结果状态。
 */
export function PodResultView(props: {
  podId: string
  goalId: string
  onResubmit?: (result: PodGoalResult) => void
  onReject: (feedback: string) => Promise<boolean>
  /** 单次点击验收：父组件负责调用 gateway 并刷新鲸群。 */
  onAccept?: (opts?: { force?: boolean; riskAcknowledged?: boolean }) => Promise<PodGoalAcceptResult | null>
  /** 显式进入当前 revision 的 worktree 内容；不会自动切换 scope。 */
  onOpenWorktree?: (target: Omit<GoalWorktreeTarget, "title">) => void
  /** 外部 Pod 事实变化时刷新评审项（如 Tech Lead 回应/新批注落库）。 */
  reviewRefreshKey?: () => unknown
}) {
  const [result, setResult] = createSignal<PodGoalResult | null>(null)
  const [revisions, setRevisions] = createSignal<PodGoalRevision[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  const [rejecting, setRejecting] = createSignal(false)
  const [rejectError, setRejectError] = createSignal<string | null>(null)
  const [accepting, setAccepting] = createSignal(false)
  const [acceptError, setAcceptError] = createSignal<string | null>(null)
  const [diffOpen, setDiffOpen] = createSignal(false)
  const [diffFiles, setDiffFiles] = createSignal<FileDiffEntry[]>([])
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffError, setDiffError] = createSignal<string | null>(null)
  const [reviewItems, setReviewItems] = createSignal<PodReviewItem[]>([])
  const [reviewBusy, setReviewBusy] = createSignal(false)
  const [forceOpen, setForceOpen] = createSignal(false)
  const [riskAck, setRiskAck] = createSignal(false)
  let reviewRef: HTMLDivElement | undefined

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
    setAcceptError(null)
    setDiffOpen(false)
    setDiffFiles([])
    setDiffError(null)
    setReviewItems([])
    setForceOpen(false)
    setRiskAck(false)
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
  const rejectLabel = () => rejectButtonLabel({
    status: currentStatus(),
    accepted: result()?.acceptance === "accepted" || result()?.worktree?.status === "merged",
  })
  const assessmentLabel = () => {
    const value = result()
    if (!value) return null
    return podResultAssessmentLabel({
      verdict: value.verdict,
      assessment: value.assessment ?? null,
      reviewed: value.reviewed,
    })
  }
  const acceptance = () => {
    const value = result()
    return value ? podResultAcceptanceView(value) : null
  }
  const worktreeRows = () => {
    const value = result()
    return value ? podResultWorktreeRows(value) : []
  }
  const conditionRows = () => {
    const value = result()
    return value ? podResultConditionRows(value) : []
  }
  /** The branch preview is useful until the revision is merged (branch then keeps history only). */
  const canViewDiff = () => {
    const value = result()
    return value ? podResultCanViewDiff(value) : false
  }
  const canOpenWorktree = () => {
    const value = result()
    return value ? podResultCanOpenWorktree(value, activeRevision()) : false
  }
  const worktreeRevision = () => result()?.revision ?? activeRevision() ?? null
  const reviewCount = () => reviewCounts(reviewItems())
  const isAccepted = () => {
    const value = result()
    return value?.acceptance === "accepted"
      || value?.worktree?.status === "merged"
      || Boolean(value?.acceptanceRecord)
  }
  const acceptAction = () => reviewAcceptAction({
    unresolved: reviewCount().unresolved,
  })
  let reviewSeq = 0
  const refreshReviewItems = async () => {
    const podId = props.podId
    const goalId = props.goalId
    const revision = worktreeRevision()
    const my = ++reviewSeq
    try {
      const listed = await window.api.mafw.pod.reviewItems(
        podId,
        goalId,
        revision == null ? undefined : { revision },
      )
      if (my !== reviewSeq) return
      setReviewItems(Array.isArray(listed?.items) ? listed.items : [])
    } catch { /* fail-open: keep the last projected list */ }
  }
  // Review items are revision facts: reload on goal/revision changes and on
  // external pod updates (Tech Lead respond / annotation persistence).
  createEffect(() => {
    const podId = props.podId
    const goalId = props.goalId
    void props.reviewRefreshKey?.()
    void podId
    void goalId
    void worktreeRevision()
    void refreshReviewItems()
  })
  const resolveReviewItem = async (item: PodReviewItem) => {
    if (reviewBusy()) return
    setReviewBusy(true)
    try {
      await window.api.mafw.pod.resolveReviewItem(props.podId, props.goalId, item.id)
      await refreshReviewItems()
    } catch (err: any) {
      void refreshReviewItems()
      showToastV2({ description: `确认解决失败：${String(err?.message ?? err).slice(0, 120)}`, duration: 3200 })
    } finally {
      setReviewBusy(false)
    }
  }
  const reopenReviewItem = async (item: PodReviewItem) => {
    if (reviewBusy()) return
    setReviewBusy(true)
    try {
      await window.api.mafw.pod.reopenReviewItem(props.podId, props.goalId, item.id)
      await refreshReviewItems()
    } catch (err: any) {
      void refreshReviewItems()
      showToastV2({ description: `重新打开失败：${String(err?.message ?? err).slice(0, 120)}`, duration: 3200 })
    } finally {
      setReviewBusy(false)
    }
  }
  const revealReviewItems = () => {
    reviewRef?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }
  const worktreeNote = () => {
    const worktree = result()?.worktree
    if (!worktree) return null
    if (worktree.status === "merged") {
      return `已合并到 ${worktree.baseBranch || "主分支"}；分支保留用于追溯。`
    }
    if (worktree.status === "abandoned") return "该 revision 已打回；分支保留用于追溯。"
    if (worktree.status === "missing") return "worktree 目录缺失；分支记录仍保留。"
    if (failed()) return "改动保留在分支。失败结果不显示验收合并入口；可查看差异、重提或打回。"
    return "主项目尚未修改。用户验收后才合并；失败时不会出现此验收动作。"
  }
  const failureReason = () => {
    const value = result()
    if (!value) return ""
    const feedback = String(value.reviewFeedback ?? "").trim()
    if (feedback) return feedback.slice(0, 400)
    return value.failure ? `结果证据不可信：${String(value.failure)}` : "结果未通过独立评审；改动保留在分支。"
  }
  const toggleDiff = async () => {
    if (diffOpen()) {
      setDiffOpen(false)
      return
    }
    if (diffLoading()) return
    setDiffOpen(true)
    setDiffLoading(true)
    setDiffError(null)
    try {
      const diff = await window.api.mafw.pod.worktreeDiff(props.podId, props.goalId, activeRevision() ?? undefined)
      setDiffFiles(Array.isArray(diff?.files) ? diff.files : [])
    } catch (err: any) {
      const status = podHttpStatus(err)
      setDiffError(status === 404
        ? "这一版没有可预览的分支"
        : status === 409
          ? `分支差异不可读：${String(err?.message ?? err).slice(0, 140)}`
          : status === 503
            ? "当前 gateway 不支持分支差异预览，请升级"
            : `读取分支差异失败：${String(err?.message ?? err).slice(0, 140)}`)
    } finally {
      setDiffLoading(false)
    }
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

  const acceptForced = async () => props.onAccept?.({ force: true, riskAcknowledged: true }) ?? null

  const submitAccept = async (opts?: { force?: boolean; riskAcknowledged?: boolean }) => {
    const value = result()
    if (!value || accepting() || !props.onAccept) return
    setAccepting(true)
    setAcceptError(null)
    try {
      const accepted = opts?.force ? await acceptForced() : await props.onAccept(opts)
      // 父组件已 toast/刷新；这里只就地更新合并事实，避免整页重新拉取闪烁。
      if (accepted) {
        setResult((prev) => (prev
          ? {
            ...prev,
            acceptance: "accepted",
            acceptanceRecord: {
              forced: accepted.forced === true,
              acceptedAt: accepted.mergedAt,
              unresolvedReviewItemIds: accepted.unresolvedReviewItemIds ?? [],
            },
            worktree: prev.worktree
              ? {
                ...prev.worktree,
                status: "merged" as const,
                mergeCommit: accepted.mergeCommit,
                mergedAt: accepted.mergedAt,
              }
              : prev.worktree,
          }
          : prev))
        setForceOpen(false)
        setRiskAck(false)
        void refreshReviewItems()
      }
    } catch (err: any) {
      const status = podHttpStatus(err)
      if (status === 409 && !opts?.force) {
        void refreshReviewItems()
        setForceOpen(true)
        showToastV2({
          description: "出现新的未解决意见，请处理或确认风险后强制验收",
          duration: 3600,
        })
      }
      setAcceptError(String(err?.message ?? err))
    } finally {
      setAccepting(false)
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

            <Show when={failed()}>
              <div class="mafw-pod-result-failure">
                <strong>失败 · 不可验收</strong>
                <span>{failureReason()}</span>
              </div>
            </Show>

            <Show when={worktreeRows().length > 0}>
              <div class="mafw-pod-result-label">代码结果</div>
              <div class="mafw-pod-result-worktree">
                <For each={worktreeRows()}>
                  {(row) => (
                    <div
                      class="mafw-pod-result-worktree-row"
                      classList={{ "is-warning": row.tone === "warning", "is-danger": row.tone === "danger" }}
                    >
                      <span class="mafw-pod-result-worktree-key">{row.label}</span>
                      <code class="mafw-pod-result-worktree-value">{row.value}</code>
                    </div>
                  )}
                </For>
                <Show when={worktreeNote()}>
                  {(note) => <div class="mafw-pod-result-worktree-note">{note()}</div>}
                </Show>
              </div>
            </Show>

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

            <Show when={conditionRows().length > 0}>
              <div class="mafw-pod-result-label">Goal Eval 条件</div>
              <div class="mafw-pod-result-conditions">
                <For each={conditionRows()}>
                  {(row) => (
                    <div class="mafw-pod-result-condition">
                      <span class="mafw-pod-result-condition-statement">
                        {row.statement}
                        <Show when={row.required}>
                          <span class="mafw-pod-result-condition-required">必需</span>
                        </Show>
                      </span>
                      <span class={`mafw-pod-result-condition-result ${CONDITION_TONE[row.result] ?? "is-unknown"}`}>
                        {row.result}
                      </span>
                      <Show when={row.evidence}>
                        <span class="mafw-pod-result-condition-evidence">{row.evidence}</span>
                      </Show>
                      <span class="mafw-pod-result-condition-id">{row.id}</span>
                    </div>
                  )}
                </For>
              </div>
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
            <Show when={canOpenWorktree()}>
              <div class="mafw-pod-result-diff-actions">
                <ButtonV2
                  variant="outline"
                  size="small"
                  onClick={() => {
                    const worktree = value().worktree
                    const revision = worktreeRevision()
                    if (!worktree?.dir || revision == null) return
                    props.onOpenWorktree?.({
                      goalId: props.goalId,
                      revision,
                      worktreeDir: worktree.dir,
                    })
                  }}
                >
                  查看本版文件
                </ButtonV2>
              </div>
            </Show>
            <Show when={canViewDiff()}>
              <div class="mafw-pod-result-diff-actions">
                <ButtonV2 variant="ghost" size="small" onClick={() => void toggleDiff()}>
                  {diffOpen() ? "收起分支差异" : "查看分支差异"}
                </ButtonV2>
              </div>
              <Show when={diffOpen()}>
                <div class="mafw-pod-result-diff">
                  <Show when={diffLoading()}>
                    <LoaderV2 width={14} height={14} />
                  </Show>
                  <Show when={diffError()}>
                    <div class="mafw-pod-result-error">{diffError()}</div>
                  </Show>
                  <Show when={!diffLoading() && !diffError() && diffFiles().length === 0}>
                    <div class="mafw-pod-empty-line">该分支没有代码差异</div>
                  </Show>
                  <Show when={diffFiles().length > 0}>
                    <DiffReviewPanel
                      sessionID=""
                      diffs={diffFiles()}
                      previewOnly
                      embedded
                      allowSessionFallback={false}
                      onBack={() => setDiffOpen(false)}
                    />
                  </Show>
                </div>
              </Show>
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

            <div ref={(el) => { reviewRef = el }}>
              <PodReviewItems
                items={reviewItems()}
                busy={reviewBusy()}
                accepted={isAccepted()}
                onResolve={(item) => void resolveReviewItem(item)}
                onReopen={(item) => void reopenReviewItem(item)}
              />
            </div>

            <Show when={acceptance()}>
              {(view) => (
                <div
                  class="mafw-pod-result-accept"
                  classList={{
                    "is-pending": view().actionable,
                    "is-failure": view().tone === "failure",
                    "is-accepted": view().tone === "success" && !view().actionable,
                  }}
                >
                  <Show
                    when={view().actionable && props.onAccept}
                    fallback={<div class="mafw-pod-result-accept-state">{view().label}</div>}
                  >
                    <div class="mafw-pod-result-label">验收</div>
                    <Show when={acceptAction().kind === "handle"}>
                      <div class="mafw-pod-result-accept-note">
                        还有 {reviewCount().unresolved} 条未解决意见。默认先处理；看清剩余意见并确认风险后才可强制验收。
                      </div>
                      <div class="mafw-pod-result-accept-actions">
                        <ButtonV2 variant="contrast" size="small" onClick={revealReviewItems}>
                          先处理意见
                        </ButtonV2>
                        <ButtonV2 variant="outline" size="small" onClick={() => setForceOpen((open) => !open)}>
                          确认风险并强制验收
                        </ButtonV2>
                      </div>
                      <Show when={forceOpen()}>
                        <div class="mafw-pod-result-force">
                          <div class="mafw-pod-result-label">仍未解决的意见</div>
                          <ul class="mafw-pod-result-force-list">
                            <For each={reviewItems().filter((item) => item.status !== "resolved")}>
                              {(item) => <li><code>{item.rel}</code> {item.comment}</li>}
                            </For>
                          </ul>
                          <CheckboxV2
                            checked={riskAck()}
                            onChange={(checked) => setRiskAck(checked === true)}
                            label="我已了解这些意见未解决，并接受合并风险"
                          />
                          <ButtonV2
                            variant="contrast"
                            size="small"
                            disabled={!forcedAcceptReady({ acknowledged: riskAck(), unresolved: reviewCount().unresolved }) || accepting()}
                            onClick={() => void submitAccept({ force: true, riskAcknowledged: true })}
                          >
                            {accepting() ? "合并中…" : "确认风险并强制验收"}
                          </ButtonV2>
                        </div>
                      </Show>
                    </Show>
                    <Show when={acceptAction().kind === "accept"}>
                      <div class="mafw-pod-result-accept-note">
                        会立即把 <code>{value().worktree?.branch ?? "该分支"}</code> 合并到{" "}
                        <code>{value().worktree?.baseBranch || "主分支"}</code>，不再二次确认。
                      </div>
                      <ButtonV2
                        variant="contrast"
                        size="small"
                        disabled={accepting()}
                        onClick={() => void submitAccept()}
                      >
                        {accepting() ? "合并中…" : "验收并合并到主分支"}
                      </ButtonV2>
                    </Show>
                    <Show when={acceptError()}>
                      <div class="mafw-pod-result-error">{acceptError()}</div>
                    </Show>
                  </Show>
                  <Show when={forcedAcceptanceNote(value().acceptanceRecord)}>
                    {(note) => <div class="mafw-pod-result-forced-note">{note()}</div>}
                  </Show>
                </div>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
