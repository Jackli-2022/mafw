import { For, Show, createEffect, createSignal, type JSX } from "solid-js"
import type { DecisionRecord } from "@mafw/sdk"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import {
  DECISION_PAGE_SIZE,
  decisionLimitToInclude,
  visibleDecisionItems,
  type DecisionBoardView,
  type DecisionItem,
  type DecisionStatus,
} from "../focus/decision-model"
import { DecisionRecordCard } from "./DecisionRecordCard"
import "../decision-board.css"

function sourceLabel(item: DecisionItem): string {
  if (item.source === "review") return "评审"
  if (item.source === "record") return "记录"
  return "Goal"
}

/** Chat 顶部的决定板：活决定在 transcript 之上，不埋进时间线。 */
export function DecisionBoard(props: {
  board: DecisionBoardView
  collapsed: boolean
  onToggle: (collapsed: boolean) => void
  onAction: (item: DecisionItem) => void
  records?: readonly DecisionRecord[]
  recordBusy?: string | null
  /** 外部请求展开某条记录（新对象触发一次，重复点击也生效）。 */
  focusRecord?: { id: string } | null
  onDecisionConfirm?: (id: string, input: { rationale: string; consequences: string; reviewAt?: string }) => void
  onDecisionShelve?: (id: string, input: { reviewAt: string; note?: string }) => void
  onDecisionReopen?: (id: string) => void
}): JSX.Element {
  const [expandedRecordId, setExpandedRecordId] = createSignal<string | null>(null)
  const [limits, setLimits] = createSignal<Record<DecisionStatus, number>>({
    needs_you: DECISION_PAGE_SIZE,
    pending: DECISION_PAGE_SIZE,
    decided: DECISION_PAGE_SIZE,
    shelved: DECISION_PAGE_SIZE,
  })
  const shown = (group: DecisionBoardView["groups"][number]) =>
    visibleDecisionItems(group.items, limits()[group.status])
  const showMore = (status: DecisionStatus) => {
    setLimits((prev) => ({ ...prev, [status]: prev[status] + DECISION_PAGE_SIZE }))
  }
  createEffect(() => {
    const focus = props.focusRecord
    if (!focus) return
    setExpandedRecordId(focus.id)
    const group = props.board.groups.find((entry) => entry.items.some((item) => item.id === focus.id))
    if (!group) return
    const next = decisionLimitToInclude(group.items, focus.id)
    setLimits((prev) => ({
      ...prev,
      [group.status]: Math.max(prev[group.status], next),
    }))
  })
  const hasItems = () => props.board.groups.some((group) => group.items.length > 0)
  const recordIdOf = (item: DecisionItem): string | null =>
    item.action.kind === "record" ? item.action.recordId : null
  const recordFor = (id: string) => props.records?.find((record) => record.id === id)

  return (
    <Show when={hasItems()}>
      <section class="mafw-decision-board" aria-label="决定板">
        <div class="mafw-decision-head">
          <span class="mafw-decision-title">决定</span>
          <div class="mafw-decision-counts">
            <For each={props.board.groups}>
              {(group) => (
                <span class="mafw-decision-count" data-status={group.status}>
                  {group.label} {group.items.length}
                </span>
              )}
            </For>
          </div>
          <TooltipV2 value={props.collapsed ? "展开决定板" : "收起决定板"} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-decision-toggle"
              aria-label={props.collapsed ? "展开决定板" : "收起决定板"}
              aria-expanded={!props.collapsed}
              onClick={() => props.onToggle(!props.collapsed)}
            >
              <Icon name="chevron-right" size="small" />
            </ButtonV2>
          </TooltipV2>
        </div>

        <Show when={!props.collapsed}>
          <div class="mafw-decision-groups">
            <For each={props.board.groups}>
              {(group) => (
                <Show when={group.items.length > 0}>
                  <div class="mafw-decision-group" data-status={group.status}>
                    <div class="mafw-decision-group-label">{group.label}</div>
                    <For each={shown(group)}>
                      {(item) => {
                        const recordId = recordIdOf(item)
                        if (recordId) {
                          const record = () => recordFor(recordId)
                          return (
                            <Show when={record()}>
                              {(entry) => (
                                <div class="mafw-decision-record-row">
                                  <ButtonV2
                                    variant="ghost"
                                    size="small"
                                    class="mafw-decision-item"
                                    aria-expanded={expandedRecordId() === recordId}
                                    onClick={() => setExpandedRecordId(expandedRecordId() === recordId ? null : recordId)}
                                  >
                                    <span class="mafw-decision-item-title">{item.title}</span>
                                    <Show when={item.detail}>
                                      <span class="mafw-decision-item-detail">{item.detail}</span>
                                    </Show>
                                    <span class="mafw-decision-item-source">{sourceLabel(item)}</span>
                                  </ButtonV2>
                                  <Show when={expandedRecordId() === recordId}>
                                    <DecisionRecordCard
                                      record={entry()}
                                      busy={props.recordBusy === recordId}
                                      onConfirm={(input) => props.onDecisionConfirm?.(recordId, input)}
                                      onShelve={(input) => props.onDecisionShelve?.(recordId, input)}
                                      onReopen={() => props.onDecisionReopen?.(recordId)}
                                    />
                                  </Show>
                                </div>
                              )}
                            </Show>
                          )
                        }
                        return (
                          <ButtonV2
                            variant="ghost"
                            size="small"
                            class="mafw-decision-item"
                            onClick={() => props.onAction(item)}
                          >
                            <span class="mafw-decision-item-title">{item.title}</span>
                            <Show when={item.detail}>
                              <span class="mafw-decision-item-detail">{item.detail}</span>
                            </Show>
                            <span class="mafw-decision-item-source">{sourceLabel(item)}</span>
                          </ButtonV2>
                        )
                      }}
                    </For>
                    <Show when={group.items.length > shown(group).length}>
                      <ButtonV2
                        variant="ghost"
                        size="small"
                        class="mafw-decision-more"
                        onClick={() => showMore(group.status)}
                      >
                        显示更多（剩余 {group.items.length - shown(group).length}）
                      </ButtonV2>
                    </Show>
                  </div>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  )
}
