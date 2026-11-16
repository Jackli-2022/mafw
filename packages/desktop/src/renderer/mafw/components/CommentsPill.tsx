// 批注 pill（2026-11-16 rev5 · ADE 模式）：输入框旁的 comments pill。
// 显示条数；点开逐条勾选「随下一条消息发送」（held 取消勾选但保留），也支持删除/清空。
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { CheckboxV2 } from "@mafw/ui/v2/checkbox-v2"
import { Icon } from "@mafw/ui/icon"
import { clearPending, pendingFor, removePending, setAnnotationHeld } from "../annotation-store"
import { describeAnchor } from "../annotation-anchor"
import type { Annotation } from "../../../shared/annotation-types"

const quoteOf = (a: Annotation) => {
  if (a.anchor?.kind === "quote") return a.anchor.quote
  if (a.anchor?.kind === "jsonPath") return a.anchor.path
  if (a.anchor?.kind === "cell") return `${a.anchor.ref} · ${a.anchor.value}`
  if (a.anchor?.kind === "region") return `区域 ${Math.round(a.anchor.x * 100)}%,${Math.round(a.anchor.y * 100)}%`
  return a.code || `第 ${a.startLine} 行`
}

const whereOf = (a: Annotation) => {
  if (a.anchor) return `${a.rel} · ${describeAnchor(a.anchor)}`
  return `${a.rel} · L${a.startLine}${a.endLine !== a.startLine ? `–${a.endLine}` : ""}`
}

export function CommentsPill(props: { sessionID: string | null }) {
  const [open, setOpen] = createSignal(false)
  const items = () => (props.sessionID ? pendingFor(props.sessionID) : [])
  const sendable = () => items().filter((a) => !a.held).length
  const held = () => items().length - sendable()

  createEffect(() => {
    if (items().length === 0) setOpen(false)
  })

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (target?.closest(".mafw-comments-pill-wrap")) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown, true))
  })

  return (
    <Show when={items().length > 0}>
      <span class="mafw-comments-pill-wrap">
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-comments-pill"
          classList={{ "has": items().length > 0 }}
          aria-label={`批注 ${items().length} 条`}
          aria-expanded={open()}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="comment" size="small" />
          <span class="mafw-comments-label">批注</span>
          <span class="mafw-comments-count">{items().length}</span>
        </ButtonV2>

        <Show when={open()}>
          <div class="mafw-comments-pop" role="dialog" aria-label="待发送批注">
            <div class="mafw-comments-pop-head">
              <div class="mafw-comments-pop-title">
                <b>批注</b>
                <span>{sendable()} 条随下一条发送{held() > 0 ? ` · ${held()} 条保留` : ""}</span>
              </div>
              <ButtonV2
                variant="ghost"
                size="small"
                onClick={() => props.sessionID && clearPending(props.sessionID)}
              >
                清空
              </ButtonV2>
            </div>
            <For each={items()}>
              {(a) => (
                <div class="mafw-comments-row" classList={{ "is-held": !!a.held }}>
                  <CheckboxV2
                    class="mafw-comments-check"
                    hideLabel
                    label="随下一条消息发送"
                    checked={!a.held}
                    onChange={(checked) => setAnnotationHeld(a.sessionID, a.id, !checked)}
                  />
                  <div class="mafw-comments-row-body">
                    <span class="mafw-comments-row-quote">{quoteOf(a)}</span>
                    <span class="mafw-comments-row-note">{a.comment}</span>
                    <span class="mafw-comments-row-where">{whereOf(a)}</span>
                  </div>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    class="mafw-comments-row-x"
                    aria-label="移除批注"
                    onClick={() => removePending(a.sessionID, a.id)}
                  >
                    <Icon name="close" size="small" />
                  </ButtonV2>
                </div>
              )}
            </For>
          </div>
        </Show>
      </span>
    </Show>
  )
}
