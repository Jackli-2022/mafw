import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import type { FrameBadge, FrameCrumb } from "../focus/frame-view"

function pickerHint(): string {
  try {
    return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘P" : "Ctrl+P"
  } catch {
    return "Ctrl+P"
  }
}

/** 工作台的「框」：世界 / scope / 对象 / 版本 / 状态，只占一行。 */
export function FrameBar(props: {
  crumbs: readonly FrameCrumb[]
  badges: readonly FrameBadge[]
  canBack: boolean
  onBack: () => void
  onCrumb: (index: number) => void
  onOpenPicker: () => void
}): JSX.Element {
  return (
    <div class="mafw-frame-bar">
      <Show when={props.canBack}>
        <TooltipV2 value="返回" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-frame-back"
            aria-label="返回"
            onClick={props.onBack}
          >
            <Icon name="arrow-left" size="small" />
          </ButtonV2>
        </TooltipV2>
      </Show>

      <div class="mafw-frame-crumbs">
        <For each={props.crumbs}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span class="mafw-frame-sep">/</span>
              </Show>
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-frame-crumb"
                aria-current={index() === props.crumbs.length - 1 ? "page" : undefined}
                onClick={() => {
                  if (crumb.stackIndex !== undefined) props.onCrumb(crumb.stackIndex)
                }}
              >
                {crumb.label}
              </ButtonV2>
            </>
          )}
        </For>
      </div>

      <div class="mafw-frame-badges">
        <For each={props.badges}>
          {(badge) => (
            <span class="mafw-frame-badge" data-tone={badge.tone}>
              {badge.label}
            </span>
          )}
        </For>
      </div>

      <TooltipV2 value="打开取景器" openDelay={300}>
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-frame-picker-hint"
          aria-label="打开取景器"
          onClick={props.onOpenPicker}
        >
          <Icon name="magnifying-glass" size="small" />
          <span class="mafw-frame-kbd">{pickerHint()}</span>
        </ButtonV2>
      </TooltipV2>
    </div>
  )
}
