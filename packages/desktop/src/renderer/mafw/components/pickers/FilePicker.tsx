// @ts-nocheck
import { For, Show } from "solid-js"
import { PopoverShell } from "./PopoverShell"

export type FilePickerItem = { kind: "agent" | "file"; label: string; value: string }

// @-mention picker: pure presentational list (fuzzy files + matching
// agents). Keyboard navigation (↑/↓/Enter) stays in the composer textarea
// keydown handler; this component only renders items + highlight + click.
export function FilePicker(props: {
  open: boolean
  trigger: HTMLElement | null
  items: FilePickerItem[]
  hi: number
  onSelect: (item: FilePickerItem) => void
  onClose: () => void
}) {
  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="bl" width={420} onClose={props.onClose}>
      <div class="mafw-file-picker">
        <Show when={props.items.length === 0}>
          <div class="mafw-picker-empty">无匹配文件</div>
        </Show>
        <For each={props.items}>
          {(item, i) => (
            <div
              class="mafw-file-row"
              classList={{ sel: i() === props.hi }}
              onClick={() => props.onSelect(item)}
            >
              <span class="mafw-file-icon">{item.kind === "agent" ? "🤖" : "📄"}</span>
              <span class="mafw-file-label">{item.kind === "agent" ? `@${item.label}（agent）` : item.label}</span>
            </div>
          )}
        </For>
      </div>
    </PopoverShell>
  )
}
