// TerminalView: one xterm instance per terminal session (spec 2026-10-29 §4).
// Kept mounted across tab switches; attaches only when the surface + tab are visible.
import { Show, createEffect, onCleanup, onMount } from "solid-js"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { TerminalSessionInfo } from "../../../shared/terminal-session"
import { buildTerminalMenu } from "../context-menu/builders/terminal"
import { menuController } from "../context-menu/controller"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { buildTerminalTheme, createResizeScheduler, sessionView } from "../terminal/terminal-view"
import { DockBanner } from "./dock-panel"

let viewSeq = 0

export function TerminalView(props: {
  session: TerminalSessionInfo
  active: boolean
  visible: boolean
  onRequestClose: () => void
  onRequestKill: () => void
  onOpenExternal: () => void
}) {
  let host!: HTMLDivElement
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let attachedId: string | null = null
  let attaching = false
  let pending = false
  const key = `terminal-view-${++viewSeq}`

  const view = () => sessionView(props.session)

  const themeFrom = (el: HTMLElement) => {
    const css = getComputedStyle(el)
    return buildTerminalTheme((name) => css.getPropertyValue(name))
  }

  const ensureTerm = () => {
    if (term || !host || host.clientWidth === 0) return
    const theme = themeFrom(host)
    const { fontFamily, ...rest } = theme
    term = new Terminal({
      fontSize: 12.5,
      scrollback: 5000,
      cursorBlink: true,
      fontFamily,
      theme: rest,
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try { fit.fit() } catch { /* size not stable; RO retries */ }
    term.onData((data) => {
      void window.api.mafw.terminal.sessions.input(props.session.id, data)
    })
  }

  const doAttach = async () => {
    if (!props.visible || !props.active || !props.session.id) return
    if (attaching) {
      pending = true
      return
    }
    attaching = true
    try {
      ensureTerm()
      if (!term) return
      if (attachedId === props.session.id) {
        term.focus()
        return
      }
      if (attachedId) {
        await window.api.mafw.terminal.sessions.detach(attachedId, key)
        attachedId = null
      }
      term.reset()
      const result = await window.api.mafw.terminal.sessions.attach(props.session.id, key)
      if (!result.ok) return
      attachedId = props.session.id
      requestAnimationFrame(() => {
        try { fit?.fit() } catch { /* hidden */ }
        if (term) void window.api.mafw.terminal.sessions.resize(props.session.id, term.cols, term.rows)
        term?.focus()
      })
    } finally {
      attaching = false
      const again = pending
      pending = false
      if (again) void doAttach()
    }
  }

  const doDetach = () => {
    if (!attachedId) return
    void window.api.mafw.terminal.sessions.detach(attachedId, key)
    attachedId = null
  }

  createEffect(() => {
    // Read reactive deps explicitly.
    props.visible
    props.active
    props.session.id
    if (props.visible && props.active) void doAttach()
    else doDetach()
  })

  onMount(() => {
    const off = window.api.mafw.terminal.onEvent((ev) => {
      if (ev.type === "data" && ev.sessionId === props.session.id) term?.write(ev.data)
    })
    const resizer = createResizeScheduler(120, () => {
      if (!host || host.clientWidth === 0) return
      ensureTerm()
      try { fit?.fit() } catch { /* hidden */ }
      if (term) void window.api.mafw.terminal.sessions.resize(props.session.id, term.cols, term.rows)
    })
    const ro = new ResizeObserver(() => {
      if (!host || host.clientWidth === 0) return
      ensureTerm()
      resizer.schedule()
    })
    ro.observe(host)

    const mo = new MutationObserver(() => {
      if (!term) return
      const next = themeFrom(host)
      const { fontFamily, ...rest } = next
      term.options.fontFamily = fontFamily
      term.options.theme = rest
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-color-scheme"] })

    onCleanup(() => {
      off()
      resizer.cancel()
      ro.disconnect()
      mo.disconnect()
      doDetach()
      term?.dispose()
      term = null
    })
  })

  const primary = () => {
    const action = view().action
    if (action === "reconnect" || action === "reopen") {
      void window.api.mafw.terminal.sessions.reconnect(props.session.id)
    } else if (action === "open") {
      if (props.session.kind === "local" && props.session.directory) {
        void window.api.mafw.terminal.sessions.attachLocal(props.session.directory)
      } else {
        void window.api.mafw.terminal.sessions.reconnect(props.session.id)
      }
    } else if (action === "external") {
      props.onOpenExternal()
    }
  }

  const actionLabel = () => {
    switch (view().action) {
      case "reconnect": return "重新连接"
      case "reopen": return "重新打开"
      case "open": return "打开终端"
      case "external": return "打开外部终端"
      default: return ""
    }
  }

  const requestMenu = (event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    const hasSelection = !!term?.hasSelection?.()
    menuController.request(
      buildTerminalMenu,
      {
        hasSelection,
        canClose: true,
        canKill: props.session.kind === "local",
        isLocal: props.session.kind === "local",
      },
      (id) => {
        if (id === "terminal.copy") {
          const selection = term?.getSelection() ?? ""
          if (selection) void navigator.clipboard.writeText(selection)
        } else if (id === "terminal.paste") {
          void navigator.clipboard.readText().then((text) => { if (text) term?.paste(text) })
        } else if (id === "terminal.selectAll") {
          term?.selectAll()
        } else if (id === "terminal.clear") {
          term?.clear()
          void window.api.mafw.terminal.sessions.input(props.session.id, "\x1b[2J\x1b[H")
        } else if (id === "terminal.openExternal") {
          props.onOpenExternal()
        } else if (id === "terminal.close") {
          props.onRequestClose()
        } else if (id === "terminal.kill") {
          props.onRequestKill()
        }
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <div class="mafw-terminal-view">
      <Show when={view().banner}>
        <DockBanner
          kind={view().kind === "unavailable" ? "error" : view().busy ? "info" : "warn"}
          busy={view().busy}
          text={view().banner!}
          action={view().action ? { label: actionLabel(), onClick: primary } : undefined}
        />
      </Show>
      <div class="mafw-terminal-host" ref={host} onContextMenu={requestMenu} />
    </div>
  )
}
