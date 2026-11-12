import { For, Show, createEffect, createSignal, type JSX } from "solid-js"
import type { DecisionRecord } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import "../decision-record.css"

const STATUS_LABEL: Record<DecisionRecord["status"], string> = {
  draft: "待确认",
  decided: "已定",
  shelved: "已搁置",
}

/** 决定记录卡：Agent 起草，人确认 / 搁置 / 重开。 */
export function DecisionRecordCard(props: {
  record: DecisionRecord
  busy: boolean
  onConfirm: (input: { rationale: string; consequences: string; reviewAt?: string }) => void
  onShelve: (input: { reviewAt: string; note?: string }) => void
  onReopen: () => void
}): JSX.Element {
  const [rationale, setRationale] = createSignal(props.record.rationale ?? "")
  const [consequences, setConsequences] = createSignal(props.record.consequences ?? "")
  const [reviewAt, setReviewAt] = createSignal(props.record.reviewAt ?? "")
  const [note, setNote] = createSignal("")

  createEffect(() => {
    props.record.id
    setRationale(props.record.rationale ?? "")
    setConsequences(props.record.consequences ?? "")
    setReviewAt(props.record.reviewAt ?? "")
    setNote("")
  })

  const isDraft = () => props.record.status === "draft"
  const canConfirm = () => !props.busy && rationale().trim().length > 0
  const canShelve = () => !props.busy && reviewAt().trim().length > 0

  return (
    <div class="mafw-decision-record" data-status={props.record.status}>
      <div class="mafw-decision-record-head">
        <span class="mafw-decision-record-question">{props.record.question}</span>
        <span class="mafw-decision-record-status">{STATUS_LABEL[props.record.status]}</span>
      </div>

      <Show when={props.record.options.length > 0}>
        <div class="mafw-decision-record-section">
          <div class="mafw-decision-record-label">选项</div>
          <For each={props.record.options}>
            {(option) => (
              <div class="mafw-decision-record-option">
                <span class="mafw-decision-record-option-title">{option.title}</span>
                <Show when={option.summary}>
                  <span class="mafw-decision-record-option-summary">{option.summary}</span>
                </Show>
                <Show when={option.risks && option.risks.length > 0}>
                  <span class="mafw-decision-record-option-risk">{option.risks!.join(" · ")}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.record.evidence.length > 0}>
        <div class="mafw-decision-record-section">
          <div class="mafw-decision-record-label">依据</div>
          <For each={props.record.evidence}>
            {(evidence) => (
              <div class="mafw-decision-record-evidence">
                <span class="mafw-decision-record-evidence-kind">{evidence.kind}</span>
                <span class="mafw-decision-record-evidence-ref">{evidence.label ?? evidence.ref}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={isDraft()}
        fallback={
          <div class="mafw-decision-record-section mafw-decision-record-decided">
            <div class="mafw-decision-record-field">
              <span class="mafw-decision-record-label">理由</span>
              <span>{props.record.rationale || "未记录"}</span>
            </div>
            <div class="mafw-decision-record-field">
              <span class="mafw-decision-record-label">后果</span>
              <span>{props.record.consequences || "未记录"}</span>
            </div>
            <Show when={props.record.reviewAt}>
              <div class="mafw-decision-record-field">
                <span class="mafw-decision-record-label">复看</span>
                <span>{props.record.reviewAt}</span>
              </div>
            </Show>
            <Show when={props.record.decidedAt}>
              <div class="mafw-decision-record-field">
                <span class="mafw-decision-record-label">确认</span>
                <span>{props.record.decidedAt}</span>
              </div>
            </Show>
            <div class="mafw-decision-record-actions">
              <ButtonV2
                variant="outline"
                size="small"
                class="mafw-decision-record-reopen"
                disabled={props.busy}
                onClick={() => props.onReopen()}
              >
                重新打开
              </ButtonV2>
            </div>
          </div>
        }
      >
        <div class="mafw-decision-record-form">
          <TextareaV2
            value={rationale()}
            placeholder="为什么这样决定（确认前必填）"
            onInput={(event) => setRationale(event.currentTarget.value)}
          />
          <TextareaV2
            value={consequences()}
            placeholder="什么变成真的、什么被放弃"
            onInput={(event) => setConsequences(event.currentTarget.value)}
          />
          <TextInputV2
            value={reviewAt()}
            placeholder="复看日期（可选，ISO）"
            onInput={(event) => setReviewAt(event.currentTarget.value)}
          />
          <TextInputV2
            value={note()}
            placeholder="搁置备注（可选）"
            onInput={(event) => setNote(event.currentTarget.value)}
          />
          <div class="mafw-decision-record-actions">
            <ButtonV2
              variant="contrast"
              size="small"
              class="mafw-decision-record-confirm"
              disabled={!canConfirm()}
              onClick={() => props.onConfirm({
                rationale: rationale().trim(),
                consequences: consequences().trim(),
                ...(reviewAt().trim() ? { reviewAt: reviewAt().trim() } : {}),
              })}
            >
              {props.busy ? "提交中…" : "确认决定"}
            </ButtonV2>
            <ButtonV2
              variant="outline"
              size="small"
              class="mafw-decision-record-shelve"
              disabled={!canShelve()}
              onClick={() => props.onShelve({
                reviewAt: reviewAt().trim(),
                ...(note().trim() ? { note: note().trim() } : {}),
              })}
            >
              搁置
            </ButtonV2>
          </div>
        </div>
      </Show>

      <Show when={props.record.history.length > 0}>
        <div class="mafw-decision-record-history">
          <For each={props.record.history}>
            {(entry) => (
              <span class="mafw-decision-record-history-entry">
                {entry.action} · {entry.by} · {entry.at}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
