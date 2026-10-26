// @ts-nocheck
// TerminalDock：右 dock「终端」tab（spec 2026-10-26-terminal-dock-design）。
// 目录级 persistent 终端（serve 托管 PTY）；xterm 前端；agent 不可见（不共享）。
// 组件常挂载（MafwShell display:none 切换），xterm 实例不随隐藏销毁。
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { viewFor, type TerminalViewKind } from "../terminal/terminal-view"

export function TerminalDock(props: { directory: string | null }) {
  let host!: HTMLDivElement
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let currentDir: string | null = null
  let attaching = false
  let killedDir: string | null = null
  let disarmTimer: ReturnType<typeof setTimeout> | null = null
  const [kind, setKind] = createSignal<TerminalViewKind>("idle")
  const [killArmed, setKillArmed] = createSignal(false)

  const themeFrom = (el: HTMLElement) => {
    const css = getComputedStyle(el)
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb
    return {
      background: v("--bg-inset", "#0d1117"),
      foreground: v("--text-1", "#e6edf3"),
      cursor: v("--accent", "#7aa2f7"),
      cursorAccent: v("--bg-inset", "#0d1117"),
      selectionBackground: v("--bg-selected", "#264f78"),
      fontFamily: v("--font-data", "ui-monospace, monospace"),
    }
  }

  // xterm open 必须等到容器有实际尺寸（dock 隐藏时 display:none 宽高为 0）。
  const ensureTerm = () => {
    if (term || !host || host.clientWidth === 0) return
    const t = themeFrom(host)
    term = new Terminal({
      fontSize: 12.5,
      scrollback: 5000,
      cursorBlink: true,
      fontFamily: t.fontFamily,
      theme: {
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursor,
        cursorAccent: t.cursorAccent,
        selectionBackground: t.selectionBackground,
      },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try { fit.fit() } catch { /* 尺寸未稳定，RO 会再触发 */ }
    term.onData((d) => { if (currentDir) void window.api.mafw.terminal.input(currentDir, d) })
  }

  const attach = async (dir: string) => {
    if (attaching) return
    attaching = true
    currentDir = dir
    setKind("probing")
    try {
      ensureTerm()
      const probe = await window.api.mafw.terminal.probe()
      if (!probe.available) {
        setKind("unavailable")
        return
      }
      term?.reset()
      await window.api.mafw.terminal.attach(dir)
      setKind("live")
      requestAnimationFrame(() => {
        try { fit?.fit() } catch { /* hidden */ }
        if (currentDir && term) void window.api.mafw.terminal.resize(currentDir, term.cols, term.rows)
        term?.focus()
      })
    } catch {
      setKind("closed")
    } finally {
      attaching = false
    }
  }

  // 目录跟随（普通会话=项目目录，worktree 会话=worktree 目录；与文件树根同规则）。
  createEffect(() => {
    const dir = props.directory
    if (!dir) {
      currentDir = null
      setKind("idle")
      return
    }
    if (dir === currentDir) return
    void attach(dir)
  })

  // 可见性/尺寸变化 → 首次 open + fit + resize（切回 tab 时补一次 fit）。
  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!host || host.clientWidth === 0) return
      ensureTerm()
      try { fit?.fit() } catch { /* hidden */ }
      if (currentDir && term) void window.api.mafw.terminal.resize(currentDir, term.cols, term.rows)
    })
    ro.observe(host)
    onCleanup(() => ro.disconnect())
  })

  // 终端事件订阅（一次，多路复用）；只处理当前目录。
  onMount(() => {
    const off = window.api.mafw.terminal.onEvent((ev) => {
      if (!currentDir || ev.directory !== currentDir) return
      if (ev.type === "data") {
        term?.write(ev.data ?? "")
      } else if (ev.type === "gone") {
        setKind("gone")
      } else {
        if (ev.directory === killedDir) return // 主动结束触发的关闭不弹「已断开」
        setKind("closed")
      }
    })
    onCleanup(off)
  })

  onCleanup(() => {
    if (disarmTimer) clearTimeout(disarmTimer)
    term?.dispose()
    term = null
  })

  const primary = () => {
    const v = viewFor(kind())
    if (!v.action) return
    const dir = props.directory
    if (!dir) return
    if (v.action === "external") {
      void window.api.mafw.terminal.openExternal(dir)
      return
    }
    // open / reconnect / reopen 都走 attach（list 有活终端则重用，无则新建）
    void attach(dir)
  }

  const requestKill = () => {
    if (!killArmed()) {
      setKillArmed(true)
      disarmTimer = setTimeout(() => setKillArmed(false), 3000)
      return
    }
    if (disarmTimer) clearTimeout(disarmTimer)
    setKillArmed(false)
    const dir = currentDir
    if (!dir) return
    killedDir = dir
    void window.api.mafw.terminal.kill(dir).finally(() => {
      setTimeout(() => { if (killedDir === dir) killedDir = null }, 1000)
      term?.reset()
      currentDir = null
      setKind("idle")
    })
  }

  return (
    <div class="mafw-terminal-dock">
      <Show when={kind() === "live"}>
        <div class="mafw-terminal-actions">
          <ButtonV2 variant="ghost" size="small" onClick={requestKill} aria-label="结束终端">
            {killArmed() ? "确认结束？" : "结束终端"}
          </ButtonV2>
        </div>
      </Show>
      <div class="mafw-terminal-host" ref={host} />
      <Show when={viewFor(kind()).banner}>
        <div class="mafw-terminal-banner">
          <div class="mafw-terminal-banner-card">
            <Show when={viewFor(kind()).busy}>
              <LoaderV2 width={18} height={18} />
            </Show>
            <p class="mafw-terminal-banner-text">{viewFor(kind()).banner}</p>
            <Show when={viewFor(kind()).action}>
              <ButtonV2 variant="outline" size="small" onClick={primary}>
                {viewFor(kind()).action === "external"
                  ? "打开外部终端"
                  : viewFor(kind()).action === "reconnect"
                    ? "重新连接"
                    : viewFor(kind()).action === "reopen"
                      ? "重新打开"
                      : "打开终端"}
              </ButtonV2>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
