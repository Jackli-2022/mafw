import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { placeAnnotationBox, type BoxRect } from "../annotation-placement"

const QUICK_INSTRUCTIONS = [
  "重构这段代码，保持行为不变",
  "修复潜在 bug",
  "补充注释和类型",
  "优化可读性和命名",
]

export function InlineEditSheet(props: {
  anchor: BoxRect
  quote?: string
  meta: string
  onSubmit: (instruction: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = createSignal("")
  const [pos, setPos] = createSignal({ left: props.anchor.left, top: props.anchor.top + props.anchor.height + 8 })
  let host: HTMLDivElement | undefined

  const submit = () => {
    const instruction = value().trim()
    if (!instruction) return
    props.onSubmit(instruction)
  }

  const place = () => {
    const el = host
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    const p = placeAnnotationBox(
      props.anchor,
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: parent.clientWidth, h: parent.clientHeight },
    )
    setPos({ left: p.left, top: p.top })
  }

  onMount(() => {
    requestAnimationFrame(() => {
      place()
      host?.querySelector("textarea")?.focus()
    })
    window.addEventListener("resize", place)
    onCleanup(() => window.removeEventListener("resize", place))
  })

  return (
    <div
      class="mafw-annot-sheet mafw-inline-edit-sheet"
      ref={(el) => { host = el }}
      style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.preventDefault()
        e.stopPropagation()
        props.onCancel()
      }}
    >
      <div class="mafw-inline-edit-head">
        <span class="mafw-inline-edit-title">AI 编辑</span>
        <span class="mafw-inline-edit-meta">{props.meta}</span>
      </div>
      <Show when={props.quote?.trim()}>
        {(quote) => <div class="mafw-annot-sheet-quote">{quote()}</div>}
      </Show>
      <div class="mafw-inline-edit-quick">
        <For each={QUICK_INSTRUCTIONS}>
          {(instruction) => (
            <ButtonV2 variant="ghost" size="small" onClick={() => setValue(instruction)}>
              {instruction}
            </ButtonV2>
          )}
        </For>
      </div>
      <TextareaV2
        class="mafw-annot-sheet-input"
        rows={3}
        placeholder="告诉 agent 怎么改这段代码…"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.isComposing || e.keyCode === 229) return
          if (e.key === "Escape") {
            e.preventDefault()
            props.onCancel()
            return
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div class="mafw-annot-sheet-foot">
        <span class="mafw-annot-sheet-hint">Ctrl/⌘↵ 发送 · Esc 取消</span>
        <div class="mafw-annot-sheet-actions">
          <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>取消</ButtonV2>
          <ButtonV2 variant="contrast" size="small" disabled={!value().trim()} onClick={submit}>
            发送给 Agent
          </ButtonV2>
        </div>
      </div>
    </div>
  )
}
