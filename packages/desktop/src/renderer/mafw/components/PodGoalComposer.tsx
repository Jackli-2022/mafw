import { Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { parseAcceptanceLines } from "../pod-model"
import { buildDelegationPreview, type DelegationPreview as DelegationPreviewView } from "../delegation-preview"
import { DelegationPreview } from "./DelegationPreview"

export function PodGoalComposer(props: {
  busy: boolean
  activeGoalId: string | null
  autofocus?: boolean
  projectName?: string
  initial?: { title: string; objective?: string; acceptance?: string[] }
  onCreate(input: {
    title: string
    objective: string
    acceptance: string[]
    boundaries: string[]
    planReview: "auto" | "manual"
  }): Promise<boolean>
}) {
  const [title, setTitle] = createSignal(props.initial?.title ?? "")
  const [objective, setObjective] = createSignal(props.initial?.objective ?? "")
  const [acceptance, setAcceptance] = createSignal((props.initial?.acceptance ?? []).join("\n"))
  const [boundaries, setBoundaries] = createSignal("")
  const [manual, setManual] = createSignal(false)
  const [submitError, setSubmitError] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)
  const [preview, setPreview] = createSignal<DelegationPreviewView | null>(null)

  createEffect(() => {
    const initial = props.initial
    if (!initial) {
      setTitle("")
      setObjective("")
      setAcceptance("")
      setBoundaries("")
      setManual(false)
      setPreview(null)
      return
    }
    setTitle(initial.title)
    setObjective(initial.objective ?? "")
    setAcceptance((initial.acceptance ?? []).join("\n"))
    setManual(false)
    setPreview(null)
  })

  const canSubmit = () =>
    title().trim().length > 0
    && (objective().trim().length > 0 || !props.initial)
    && !submitting()
    && !props.busy

  const startPreview = () => {
    if (!canSubmit()) return
    setSubmitError(null)
    setPreview(buildDelegationPreview({
      projectName: props.projectName ?? "当前项目",
      title: title().trim(),
      objective: objective().trim(),
      acceptance: parseAcceptanceLines(acceptance()),
      boundaries: parseAcceptanceLines(boundaries()),
      planReview: manual() ? "manual" : "auto",
    }))
  }

  const submit = async () => {
    if (!canSubmit()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const ok = await props.onCreate({
        title: title().trim(),
        objective: objective().trim(),
        acceptance: parseAcceptanceLines(acceptance()),
        boundaries: parseAcceptanceLines(boundaries()),
        planReview: manual() ? "manual" : "auto",
      })
      if (!ok) return
      setPreview(null)
      setTitle("")
      setObjective("")
      setAcceptance("")
      setBoundaries("")
      setManual(false)
    } catch (err: any) {
      setSubmitError(String(err?.message ?? err).slice(0, 160))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="mafw-pod-composer">
      <Show
        when={preview()}
        fallback={
          <>
            <div class="mafw-pod-composer-head">
              <span>交给团队一个目标</span>
              <span class="mafw-pod-composer-hint">
                {props.activeGoalId ? "新目标会排到队尾" : "当前没有执行中的目标"}
              </span>
            </div>
            <TextInputV2
              value={title()}
              autofocus={props.autofocus}
              placeholder="目标标题（必填）"
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
            <TextareaV2
              value={objective()}
              placeholder="目标、背景与期望结果（必填）"
              onInput={(event) => setObjective(event.currentTarget.value)}
            />
            <details class="mafw-pod-composer-more">
              <summary>验收与约束（可选）</summary>
              <TextareaV2
                value={acceptance()}
                placeholder={"验收标准，一行一条\n例如：npm test 全绿"}
                onInput={(event) => setAcceptance(event.currentTarget.value)}
              />
              <TextareaV2
                value={boundaries()}
                placeholder={"边界，一行一条\n例如：不改并行执行架构"}
                onInput={(event) => setBoundaries(event.currentTarget.value)}
              />
              <div class="mafw-pod-composer-switch">
                <SwitchV2 checked={manual()} onChange={setManual}>计划完成后先让我确认</SwitchV2>
              </div>
            </details>
            <Show when={submitError()}>
              <div class="mafw-pod-composer-error">{submitError()}</div>
            </Show>
            <div class="mafw-pod-composer-actions">
              <ButtonV2
                variant="contrast"
                size="small"
                disabled={!canSubmit()}
                onClick={startPreview}
              >
                预览委托单
              </ButtonV2>
            </div>
          </>
        }
      >
        {(value) => (
          <DelegationPreview
            preview={value()}
            busy={submitting() || props.busy}
            onConfirm={() => void submit()}
            onBack={() => setPreview(null)}
          />
        )}
      </Show>
      <Show when={preview() && submitError()}>
        <div class="mafw-pod-composer-error">{submitError()}</div>
      </Show>
    </div>
  )
}
