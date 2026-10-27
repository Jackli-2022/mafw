// 批注抽屉（2026-10-27 rev2）：停靠在工作台底部，不遮挡被批注内容；Enter 发送 / Ctrl+Enter 攒草稿。
import { Show, createSignal, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"

export function AnnotationSheet(props: {
  /** 锚点描述（文件 › 引文/路径/单元格/区域） */
  meta: string
  placeholder?: string
  onSubmit: (comment: string, mode: "send" | "draft") => void
  onCancel: () => void
}) {
  const [value, setValue] = createSignal("")
  let host: HTMLDivElement | undefined

  const canSubmit = () => value().trim().length > 0
  const submit = (mode: "send" | "draft") => {
    const v = value().trim()
    if (!v) return
    props.onSubmit(v, mode)
  }

  onMount(() => requestAnimationFrame(() => host?.querySelector("textarea")?.focus()))

  return (
    <div
      class="mafw-annot-sheet"
      ref={(el) => { host = el }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          props.onCancel()
        }
      }}
    >
      <div class="mafw-annot-sheet-head">
        <span class="mafw-annot-sheet-title">批注</span>
        <span class="mafw-annot-sheet-meta" title={props.meta}>{props.meta}</span>
        <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>取消</ButtonV2>
      </div>
      <TextareaV2
        class="mafw-annot-sheet-input"
        rows={1}
        placeholder={props.placeholder ?? "说明要改什么…"}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.isComposing || e.keyCode === 229) return
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit("draft")
            return
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit("send")
          }
        }}
      />
      <div class="mafw-annot-sheet-foot">
        <span class="mafw-annot-sheet-hint">Enter 发送 · Ctrl+Enter 攒草稿 · Shift+Enter 换行</span>
        <div class="mafw-annot-sheet-actions">
          <ButtonV2 variant="neutral" size="small" disabled={!canSubmit()} onClick={() => submit("draft")}>攒草稿</ButtonV2>
          <ButtonV2 variant="contrast" size="small" disabled={!canSubmit()} onClick={() => submit("send")}>发送</ButtonV2>
        </div>
      </div>
    </div>
  )
}
