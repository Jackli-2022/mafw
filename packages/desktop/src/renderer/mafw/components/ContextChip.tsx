import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { ButtonV2 } from '@mafw/ui/v2/button-v2'
import { Switch } from '@mafw/ui/v2/switch-v2'
import { TextInputV2 } from '@mafw/ui/v2/text-input-v2'
import { PopoverShell } from './pickers/PopoverShell'
import {
  channelLabel,
  formatContextChip,
  formatContextStamp,
  languageLabel,
  type ContextPrefs,
} from '../chat/context-reminder'

/**
 * Ghost row below the composer: `◐ 今天 14:32 · 上海`.
 *
 * Not a capsule, no divider, no language badge — the language and the exact
 * timezone live in the popover. The row only reflects what the next send will
 * attach as a hidden `<latest-reminder>` part.
 */
export function ContextChip(props: {
  prefs: ContextPrefs
  onChange: (prefs: ContextPrefs) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const [draftCity, setDraftCity] = createSignal(props.prefs.city ?? '')

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => clearInterval(timer))
  })

  const label = createMemo(() => formatContextChip(props.prefs, new Date(now())))
  const stamp = createMemo(() => formatContextStamp(props.prefs, new Date(now())))
  const language = createMemo(() => languageLabel(props.prefs.locale))

  const toggle = () => {
    const next = !open()
    if (next) setDraftCity(props.prefs.city ?? '')
    setOpen(next)
  }
  const commit = (patch: Partial<ContextPrefs>) => props.onChange({ ...props.prefs, ...patch })

  return (
    <>
      <ButtonV2
        ref={setAnchor as any}
        variant="ghost"
        size="small"
        class="mafw-context-chip"
        classList={{ 'is-open': open() }}
        aria-label={`对话上下文：${label()}`}
        aria-expanded={open()}
        onClick={toggle}
      >
        <span class="mafw-context-chip-glyph" aria-hidden="true">◐</span>
        <span class="mafw-context-chip-label">{label()}</span>
        <span class="mafw-context-chip-chev" aria-hidden="true">›</span>
      </ButtonV2>

      <PopoverShell
        open={open()}
        trigger={anchor()}
        anchor="below-start"
        width={300}
        onClose={() => setOpen(false)}
        class="mafw-context-chip-pop"
      >
        <div class="mafw-context-pop-head">这轮对话的上下文</div>

        <div class="mafw-context-pop-row">
          <span class="mafw-context-pop-label">时间</span>
          <span class="mafw-context-pop-value mafw-context-pop-nums">{stamp()}</span>
        </div>

        <div class="mafw-context-pop-row">
          <span class="mafw-context-pop-label">渠道</span>
          <span class="mafw-context-pop-value">{channelLabel(props.prefs.channel)}</span>
        </div>

        <div class="mafw-context-pop-row">
          <span class="mafw-context-pop-label">地点</span>
          <div class="mafw-context-pop-city">
            <TextInputV2
              value={draftCity()}
              placeholder="城市名（可选）"
              aria-label="城市"
              onInput={(event) => setDraftCity(event.currentTarget.value)}
              onChange={() => commit({ city: draftCity().trim() })}
            />
            <Switch
              checked={props.prefs.sendCity}
              onChange={(checked) => commit({ sendCity: checked })}
            >
              发送城市
            </Switch>
          </div>
        </div>

        <div class="mafw-context-pop-row">
          <span class="mafw-context-pop-label">语言</span>
          <span class="mafw-context-pop-value">{language()}</span>
        </div>

        <p class="mafw-context-pop-note">
          只发送城市名；每轮作为隐藏上下文，不写入记忆。
        </p>
      </PopoverShell>
    </>
  )
}
