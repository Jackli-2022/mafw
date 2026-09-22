// @ts-nocheck
import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js"
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
  const [open, setOpen] = createSignal(false)

  // 活动计时：streaming 期间每秒驱动 tick；frozenSec 保留最后一次 tick 值，
  // 用于 abort（part.time.end 缺失）时冻结显示，避免 now-start 的巨值。
  const [tick, setTick] = createSignal(Date.now())
  const [frozenSec, setFrozenSec] = createSignal<number | null>(null)
  createEffect(() => {
    if (!streaming()) return
    const timer = setInterval(() => setTick(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => {
    if (!streaming()) return
    const sec = thinkingDurationSec(part().time, tick())
    if (sec != null) setFrozenSec(sec)
  })

  const label = createMemo(() => {
    if (streaming()) {
      const sec = thinkingDurationSec(part().time, tick())
      return thinkingLabel({ streaming: true, durationSec: null, tickingSec: sec })
    }
    // 非 streaming：end 缺失（abort）用冻结值；正常完成走 part.time.end
    const hasEnd = part().time && typeof part().time.end === "number"
    const durationSec = hasEnd ? thinkingDurationSec(part().time) : frozenSec()
    return thinkingLabel({ streaming: false, durationSec })
  })

  return (
    <Show when={text()}>
      <div class="mafw-thinking">
        <ButtonV2
          variant="ghost"
          class="mafw-thinking-head"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open() ? "true" : "false"}
        >
          <span class="mafw-thinking-glyph" classList={{ stream: streaming() }} aria-hidden="true">✻</span>
          <span class="mafw-thinking-label">{label()}</span>
          <span class="mafw-thinking-caret" aria-hidden="true">{open() ? "▾" : "▸"}</span>
        </ButtonV2>
        <Show when={open()}>
          <div class="mafw-thinking-body">
            <Markdown text={text()} cacheKey={part().id} streaming={streaming()} />
          </div>
        </Show>
      </div>
    </Show>
  )
}
