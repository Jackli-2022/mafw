// Task 20：Goal 方向裁定面板（pending 才占人类 attention；decided 只读历史）。
//
// 不变量（spec §5.1）：
// - 不强迫用户从固定选项中选择：可以选中候选，也可以直接写自然语言；
// - 只有真实分歧（status=pending）才显示输入与确认按钮；
// - 已记录的决定逐字展示用户原话，绝不改写。
import { createSignal, For, Show } from "solid-js"
import type { PodDirectionDecision, PodDirectionOption, PodDirectionState } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"

export type DirectionStatusLike = "none" | "pending" | "decided"

/** 面板状态视图（宽松输入：旧 gateway 可能缺 decisions/requests）。 */
export interface DirectionStateLike {
  status?: DirectionStatusLike | string | null
  options?: PodDirectionOption[] | null
  decisions?: PodDirectionDecision[] | null
  revision?: number | null
  updatedAt?: string | null
}

export interface DirectionAction {
  kind: "decide" | "recorded" | "idle"
  label: string
  tone: "attention" | "done" | "neutral"
}

/**
 * 方向裁定动作（单源文案）：
 * - pending → 人类必须决定（「记录方向决定」）；
 * - decided → 已记录，只是历史；
 * - none/缺省 → 方向明确，无需额外确认（spec §5.1 不增加确认点击）。
 */
export function directionAction(state: DirectionStateLike | null | undefined): DirectionAction {
  const status = state?.status
  if (status === "pending") return { kind: "decide", label: "记录方向决定", tone: "attention" }
  if (status === "decided") return { kind: "recorded", label: "已记录方向", tone: "done" }
  return { kind: "idle", label: "方向已明确", tone: "neutral" }
}

/** 决定的主文案：用户原话优先，其次所选候选标题。 */
export function directionDecisionLabel(decision: PodDirectionDecision | null | undefined): string {
  if (!decision) return ""
  const words = typeof decision.userWords === "string" ? decision.userWords.trim() : ""
  if (words) return words
  const optionId = typeof decision.optionId === "string" ? decision.optionId : ""
  const option = (decision.options ?? []).find((item) => item.id === optionId)
  return option?.title?.trim() ?? ""
}

function formatTime(value: string | null | undefined): string {
  if (!value) return ""
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  const d = new Date(ms)
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 摘要：pending 显示候选数，decided 显示用户原话。 */
export function directionSummary(state: DirectionStateLike | null | undefined): string {
  if (!state) return ""
  if (state.status === "pending") {
    const count = Array.isArray(state.options) ? state.options.length : 0
    return `待你裁定 · ${count} 个候选方向`
  }
  if (state.status === "decided") {
    const decisions = Array.isArray(state.decisions) ? state.decisions : []
    const latest = decisions[decisions.length - 1]
    const label = directionDecisionLabel(latest)
    return label ? `已记录方向：${label}` : "已记录方向"
  }
  return "方向已明确"
}

function OptionRow(props: {
  option: PodDirectionOption
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <ButtonV2
      variant="ghost"
      size="small"
      class="mafw-pod-direction-option"
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      <span class="mafw-pod-direction-option-title">{props.option.title}</span>
      <Show when={props.option.summary}>
        <span class="mafw-pod-direction-option-summary">{props.option.summary}</span>
      </Show>
      <Show when={(props.option.risks ?? []).length > 0}>
        <span class="mafw-pod-direction-option-risks">风险：{props.option.risks.join("；")}</span>
      </Show>
    </ButtonV2>
  )
}

export function PodDirectionPanel(props: {
  state: PodDirectionState | null
  revision?: number | null
  busy?: boolean
  /** 返回 false = 写入失败（保留草稿）；true/undefined = 成功。 */
  onDecide?: (input: { userWords: string; optionId?: string }) => boolean | void | Promise<boolean | void>
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [words, setWords] = createSignal("")
  const action = () => directionAction(props.state)
  const revision = () => props.revision ?? props.state?.revision ?? null
  const pendingRequest = () => {
    const requests = props.state?.requests ?? []
    return requests.length > 0 ? requests[requests.length - 1] : null
  }
  const canRecord = () => !props.busy && (!!selectedId() || words().trim().length > 0)
  const decisions = () => props.state?.decisions ?? []

  // 只有写入成功才清空输入：失败时用户的原话不能丢。
  const record = async () => {
    if (!canRecord()) return
    const optionId = selectedId() ?? undefined
    const result = await props.onDecide?.({ userWords: words().trim(), optionId })
    if (result === false) return
    setWords("")
    setSelectedId(null)
  }

  return (
    <div class="mafw-card mafw-pod-direction">
      <div class="mafw-pod-section-head">
        <span>方向裁定</span>
        <Show when={revision() != null}>
          <span class="mafw-card-meta">revision {revision()}</span>
        </Show>
        <span class={`mafw-pod-direction-badge is-${action().tone}`}>{action().label}</span>
      </div>

      <Show when={action().kind === "decide"} fallback={
        <Show
          when={decisions().length > 0}
          fallback={<div class="mafw-pod-empty-line">{directionSummary(props.state)}</div>}
        >
          <div class="mafw-pod-direction-history">
            <For each={decisions()}>
              {(decision) => (
                <div class="mafw-pod-direction-decision">
                  <div class="mafw-pod-direction-words">{directionDecisionLabel(decision)}</div>
                  <div class="mafw-card-meta">
                    {decision.reason ? `${decision.reason} · ` : ""}{formatTime(decision.decidedAt)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      }>
        <Show when={pendingRequest()?.reason}>
          <div class="mafw-pod-direction-reason">{pendingRequest()!.reason}</div>
        </Show>
        <Show when={(props.state?.options ?? []).length > 0}>
          <div class="mafw-pod-direction-options">
            <For each={props.state?.options ?? []}>
              {(option) => (
                <OptionRow
                  option={option}
                  selected={selectedId() === option.id}
                  disabled={!!props.busy}
                  onSelect={() => setSelectedId((prev) => (prev === option.id ? null : option.id))}
                />
              )}
            </For>
          </div>
        </Show>
        <TextareaV2
          class="mafw-pod-direction-input"
          rows={2}
          value={words()}
          disabled={!!props.busy}
          placeholder="也可以直接写下你的方向（原话会逐字保留）"
          onInput={(e) => setWords(e.currentTarget.value)}
        />
        <div class="mafw-pod-direction-actions">
          <ButtonV2 variant="contrast" size="small" disabled={!canRecord()} onClick={() => void record()}>
            记录方向决定
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
