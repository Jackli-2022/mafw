import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import type { DecisionBoardView, DecisionItem } from "../focus/decision-model"
import "./decision-board.css"

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
}): JSX.Element {
  const hasItems = () => props.board.groups.some((group) => group.items.length > 0)

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
                    <For each={group.items}>
                      {(item) => (
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
                      )}
                    </For>
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
