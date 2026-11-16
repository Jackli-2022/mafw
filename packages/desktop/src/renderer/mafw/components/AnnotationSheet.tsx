// 批注 composer（2026-11-16 rev5 · ADE 模式）：300px 小纸条，引文 + 位置 + 输入；
// 保存后进入 pending，随下一条消息发送。Enter 换行，Ctrl/Cmd+Enter 保存，Esc 取消。
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { placeAnnotationBox, type BoxRect } from "../annotation-placement"

export function AnnotationSheet(props: {
  /** 锚点矩形（相对 editor-body）：用于锚点旁定位 */
  anchor: BoxRect
  /** 被批注的原文/区域摘要（ADE 的 quote 预览） */
  quote?: string
  /** 人类可读位置：`desktop.md · L42–48` */
  meta: string
  placeholder?: string
  onSubmit: (comment: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = createSignal("")
  const [pos, setPos] = createSignal({ left: props.anchor.left, top: props.anchor.top + props.anchor.height + 8 })
  let host: HTMLDivElement | undefined

  const canSubmit = () => value().trim().length > 0
  const submit = () => {
    const v = value().trim()
    if (!v) return
    props.onSubmit(v)
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
      class="mafw-annot-sheet"
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
      <Show when={props.quote?.trim()}>
        {(quote) => (
          <div class="mafw-annot-sheet-quote" aria-label="被批注的原文">
            {quote()}
          </div>
        )}
      </Show>
      <div class="mafw-annot-sheet-meta">{props.meta}</div>
      <TextareaV2
        class="mafw-annot-sheet-input"
        rows={2}
        placeholder={props.placeholder ?? "这条批注会随下一条消息发给 Agent"}
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
        <span class="mafw-annot-sheet-hint">Ctrl/⌘↵ 保存 · Esc 取消</span>
        <div class="mafw-annot-sheet-actions">
          <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>取消</ButtonV2>
          <ButtonV2 variant="contrast" size="small" disabled={!canSubmit()} onClick={submit}>批注</ButtonV2>
        </div>
      </div>
    </div>
  )
}
