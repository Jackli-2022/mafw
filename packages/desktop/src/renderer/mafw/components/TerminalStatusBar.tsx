// Terminal status bar: name · address · status/duration · UTF-8 · size.
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"
import { statusLabel, statusTone } from "../terminal/terminal-model"

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function TerminalStatusBar(props: {
  session: TerminalSessionInfo
  cols?: number
  rows?: number
}) {
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    const session = props.session
    if (session.status !== "connected" || !session.connectedAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const duration = () => {
    const at = props.session.connectedAt
    if (props.session.status !== "connected" || !at) return null
    return formatDuration(now() - at)
  }
  const address = () =>
    props.session.subtitle ?? props.session.directory ?? (props.session.kind === "local" ? "本地终端" : "")

  return (
    <div class="mafw-terminal-statusbar" data-tone={statusTone(props.session)}>
      <div class="mafw-terminal-status-left">
        <span class={`mafw-terminal-status-dot is-${statusTone(props.session)}`} aria-hidden="true" />
        <span class="mafw-terminal-status-name">{props.session.title}</span>
        <Show when={address()}>
          <span class="mafw-terminal-status-addr">{address()}</span>
        </Show>
        <span class="mafw-terminal-status-sep" aria-hidden="true">·</span>
        <span class="mafw-terminal-status-state">{statusLabel(props.session)}</span>
        <Show when={duration()}>
          {(text) => <span class="mafw-terminal-status-duration">{text()}</span>}
        </Show>
      </div>
      <div class="mafw-terminal-status-right">
        <span>UTF-8</span>
        <Show when={props.cols && props.rows}>
          <span class="mafw-terminal-status-size">{props.cols}×{props.rows}</span>
        </Show>
      </div>
    </div>
  )
}
