// 预览/源码统一批注输入浮层（spec 2026-10-27 预览批注 rev）：
// Enter = 立即发送给 agent；Ctrl/Cmd+Enter = 加入草稿（批量审阅）；Shift+Enter 换行；Esc 取消。
import { Show, createSignal, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"

export function AnnotationPopover(props: {
  left: number
  top: number
  placeholder?: string
  /** send = Enter/发送按钮；draft = Ctrl+Enter/攒草稿按钮 */
  onSubmit: (comment: string, mode: "send" | "draft") => void
  onCancel: () => void
  /** 附加说明（如选区行号/锚点标签），显示在底部 */
  meta?: string
}) {
  const [value, setValue] = createSignal("")
  let host: HTMLDivElement | undefined

  const canSubmit = () => value().trim().length > 0
  const submit = (mode: "send" | "draft") => {
    const v = value().trim()
    if (!v) return
    props.onSubmit(v, mode)
    setValue("")
  }

  onMount(() => {
    requestAnimationFrame(() => host?.querySelector("textarea")?.focus())
  })

  return (
    <div
      class="mafw-annot-pop"
      style={{ left: `${Math.max(8, props.left)}px`, top: `${Math.max(8, props.top)}px` }}
      ref={(el) => { host = el }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div class="mafw-annot-pop-head">批注</div>
      <TextareaV2
        class="mafw-annot-pop-input"
        rows={3}
        placeholder={props.placeholder ?? "说明要改什么…"}
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
            submit("draft")
            return
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit("send")
          }
        }}
      />
      <div class="mafw-annot-pop-foot">
        <span class="mafw-annot-pop-meta">{props.meta}</span>
        <span class="mafw-annot-pop-hint">Enter 发送 · Ctrl+Enter 攒草稿</span>
      </div>
      <div class="mafw-annot-pop-actions">
        <Show when={props.meta}>
          <span class="mafw-annot-pop-spacer" />
        </Show>
        <ButtonV2 variant="ghost" size="small" onClick={props.onCancel}>取消</ButtonV2>
        <ButtonV2 variant="neutral" size="small" disabled={!canSubmit()} onClick={() => submit("draft")}>攒草稿</ButtonV2>
        <ButtonV2 variant="contrast" size="small" disabled={!canSubmit()} onClick={() => submit("send")}>发送</ButtonV2>
      </div>
    </div>
  )
}
