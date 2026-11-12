import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"

/** 工作台的「械」：贴着当前对象的动作、证据、评审队列。 */
export function InstrumentRail(props: {
  title: string
  sections: readonly { id: string; label: string; content: JSX.Element }[]
  open: boolean
  onToggle: (open: boolean) => void
}): JSX.Element {
  return (
    <aside class="mafw-instrument-rail" aria-label={props.title}>
      <div class="mafw-instrument-head">
        <span class="mafw-instrument-title">{props.title}</span>
        <TooltipV2 value={props.open ? "收起器械栏" : "展开器械栏"} openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-instrument-toggle"
            aria-label={props.open ? "收起器械栏" : "展开器械栏"}
            aria-pressed={props.open}
            onClick={() => props.onToggle(!props.open)}
          >
            <Icon name={props.open ? "chevron-right" : "chevron-left"} size="small" />
          </ButtonV2>
        </TooltipV2>
      </div>

      <Show when={props.open}>
        <div class="mafw-instrument-body">
          <For each={props.sections}>
            {(section) => (
              <section class="mafw-instrument-section" data-section={section.id}>
                <div class="mafw-instrument-label">{section.label}</div>
                {section.content}
              </section>
            )}
          </For>
        </div>
      </Show>
    </aside>
  )
}
