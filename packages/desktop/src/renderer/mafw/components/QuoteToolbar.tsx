// 选中聊天文本后的「引用」浮层。Portal 挂 body，避免被聊天滚动容器裁切；
// mousedown preventDefault 保住选区，否则点击前浏览器就先清空 selection。
import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

export interface QuoteAnchor {
  left: number
  top: number
  width: number
  height: number
}

export function QuoteToolbar(props: { anchor: QuoteAnchor | null; onQuote: () => void }) {
  const style = () => {
    const a = props.anchor!
    const left = Math.max(8, Math.min(a.left + a.width / 2 - 32, window.innerWidth - 72))
    const top = a.top > 48 ? a.top - 36 : a.top + a.height + 8
    return { left: `${left}px`, top: `${top}px` }
  }

  return (
    <Show when={props.anchor}>
      <Portal mount={document.body}>
        <div class="mafw-quote-toolbar" style={style()}>
          <ButtonV2
            variant="contrast"
            size="small"
            aria-label="引用选中文本"
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={() => props.onQuote()}
          >
            引用
          </ButtonV2>
        </div>
      </Portal>
    </Show>
  )
}
