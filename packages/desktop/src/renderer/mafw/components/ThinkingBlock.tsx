// @ts-nocheck
import { createMemo, createSignal, Show } from "solid-js"
import { registerPartComponent } from "@mafw/session-ui/message-part"
import { Markdown } from "@mafw/session-ui/markdown"
import { useData } from "@mafw/session-ui/context"
import { readPartText } from "@mafw/session-ui/message-part-text"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { thinkingDurationSec, thinkingLabel, reasoningStreaming } from "./thinking-label"

/** 幂等注册：覆盖 session-ui 默认 reasoning 渲染为 dsh 式可折叠块 */
export function registerThinkingBlock() {
  registerPartComponent("reasoning", ThinkingBlock)
}

export function ThinkingBlock(props: { part: any; message: any }) {
  const data = useData()
  const part = () => props.part
  const streaming = createMemo(() => reasoningStreaming(props.message, part().time))
  const text = createMemo(() => readPartText(data.store.part_text_accum_delta, part()))
  const label = createMemo(() =>
    thinkingLabel({ streaming: streaming(), durationSec: thinkingDurationSec(part().time) }),
  )
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={text()}>
      <div class="mafw-thinking">
        <ButtonV2
          variant="ghost"
          class="mafw-thinking-head"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open() ? "true" : "false"}
        >
          <span class="mafw-thinking-glyph" aria-hidden="true">✻</span>
          <span class="mafw-thinking-label">{label()}</span>
          <Show when={!streaming()}>
            <span class="mafw-thinking-caret" aria-hidden="true">{open() ? "▾" : "▸"}</span>
          </Show>
        </ButtonV2>
        <Show when={streaming() || open()}>
          <div class="mafw-thinking-body">
            <Markdown text={text()} cacheKey={part().id} streaming={streaming()} />
          </div>
        </Show>
      </div>
    </Show>
  )
}
