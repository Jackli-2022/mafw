// @ts-nocheck
// TerminalDock：右 dock「终端」tab（spec 2026-10-26-terminal-dock-design）。
// 目录级 persistent 终端（serve 托管 PTY）；xterm 前端；agent 不可见（不共享）。
// 组件常挂载（MafwShell display:none 切换），xterm 实例不随隐藏销毁。
// 终审修复：仅在 tab 可见时 attach（不后台建 shell）；in-flight 切目录排队；
// attach 返回结构化结果（gone/unavailable）；重挂载走 main 的 scrollback replay。
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { viewFor, planAttach, buildTerminalTheme, createResizeScheduler, type TerminalViewKind } from "../terminal/terminal-view"
import { nextConnState, type ConnState } from "../../../shared/terminal"

export function TerminalDock(props: { directory: string | null; active: boolean }) {
  let host!: HTMLDivElement
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let currentDir: string | null = null
  let attaching = false
  let pendingDir: string | null = null
  let killedDir: string | null = null
  let disarmTimer: ReturnType<typeof setTimeout> | null = null
  const [kind, setKind] = createSignal<ConnState>("idle")
  const [killArmed, setKillArmed] = createSignal(false)
  const [lastError, setLastError] = createSignal<string | null>(null)

  const view = () => viewFor(kind() as TerminalViewKind, { hasDirectory: !!props.directory, error: lastError() })

  const themeFrom = (el: HTMLElement) => {
    const css = getComputedStyle(el)
    return buildTerminalTheme((name) => css.getPropertyValue(name))
  }

  // xterm open 必须等到容器有实际尺寸（dock 隐藏时 display:none 宽高为 0）。
  const ensureTerm = () => {
    if (term || !host || host.clientWidth === 0) return
    const t = themeFrom(host)
    const { fontFamily, ...theme } = t
    term = new Terminal({
      fontSize: 12.5,
      scrollback: 5000,
      cursorBlink: true,
      fontFamily,
      theme,
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try { fit.fit() } catch { /* 尺寸未稳定，RO 会再触发 */ }
    term.onData((d) => { if (currentDir) void window.api.mafw.terminal.input(currentDir, d) })
  }

  const attach = async (dir: string, reopen = false) => {
    if (attaching) {
      pendingDir = dir
      return
    }
    attaching = true
    currentDir = dir
    setKind((k) => nextConnState(k, "retry"))
    setKillArmed(false)
    setLastError(null)
    try {
      ensureTerm()
      const probe = await window.api.mafw.terminal.probe()
      if (!probe.available) {
        setKind((k) => nextConnState(k, "probeFail"))
        return
      }
      // reset 必须在 attach 之前：main 会向新订阅者重放 scrollback，
      // 若在 invoke 返回后 reset 会把刚到达的 replay 抹掉（终审 Critical-1）。
      term?.reset()
      const res = await window.api.mafw.terminal.attach(dir, { reopen })
      if (res.ok) {
        setLastError(null)
        setKind((k) => nextConnState(k, "attachOk"))
        requestAnimationFrame(() => {
          try { fit?.fit() } catch { /* hidden */ }
          if (currentDir && term) void window.api.mafw.terminal.resize(currentDir, term.cols, term.rows)
          term?.focus()
        })
      } else {
        setKind((k) => nextConnState(k, res.reason === "gone" ? "ptyGone" : "probeFail"))
      }
    } catch (e: any) {
      // 区分「环境不支持」（probe 明确返回 false）与「服务不可用」（IPC/fetch 异常）
      setLastError(String(e?.message ?? e))
      setKind((k) => nextConnState(k, "wsClosed"))
    } finally {
      attaching = false
      const next = pendingDir
      pendingDir = null
      // 最新目录胜：in-flight 期间的切目录不得丢（终审 Important-4）
      if (next && next !== currentDir) void attach(next)
    }
  }

  // 可见时才 attach：不可见不创建 PTY（不后台起 shell）。
  createEffect(() => {
    const dir = props.directory
    const active = props.active
    if (!dir) {
      currentDir = null
      setKind("idle")
      return
    }
    const plan = planAttach({ active, attaching, requestedDir: dir, currentDir })
    if (plan === "start") void attach(dir)
    else if (plan === "queue") pendingDir = dir
  })

  // 可见性/尺寸变化 → 首次 open + fit + resize（切回 tab 时补一次 fit；
  // 120ms 防抖：拖 dock 宽度不连发 resize PUT）。
  onMount(() => {
    const resizer = createResizeScheduler(120, () => {
      if (!host || host.clientWidth === 0) return
      ensureTerm()
      try { fit?.fit() } catch { /* hidden */ }
      if (currentDir && term) void window.api.mafw.terminal.resize(currentDir, term.cols, term.rows)
    })
    const ro = new ResizeObserver(() => {
      if (!host || host.clientWidth === 0) return
      ensureTerm()
      resizer.schedule()
    })
    ro.observe(host)
    onCleanup(() => { resizer.cancel(); ro.disconnect() })
  })

  // 主题切换（data-theme / data-color-scheme）→ 重建 xterm 主题（不再采样一次就冻住）。
  onMount(() => {
    const mo = new MutationObserver(() => {
      if (!term) return
      const t = themeFrom(host)
      const { fontFamily, ...theme } = t
      term.options.fontFamily = fontFamily
      term.options.theme = theme
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-color-scheme"] })
    onCleanup(() => mo.disconnect())
  })

  // 终端事件订阅（一次，多路复用）；只处理当前目录。
  onMount(() => {
    const off = window.api.mafw.terminal.onEvent((ev) => {
      if (!currentDir || ev.directory !== currentDir) return
      if (ev.type === "data") {
        term?.write(ev.data ?? "")
      } else if (ev.type === "gone") {
        setKind((k) => nextConnState(k, "ptyGone"))
      } else {
        if (ev.directory === killedDir) return // 主动结束触发的关闭不弹「已断开」
        setKind((k) => nextConnState(k, "wsClosed"))
      }
    })
    onCleanup(off)
  })

  onCleanup(() => {
    if (disarmTimer) clearTimeout(disarmTimer)
    const dir = currentDir
    currentDir = null
    if (dir) void window.api.mafw.terminal.detach(dir) // 释放本窗口订阅；PTY 仍存活
    term?.dispose()
    term = null
  })

  const primary = () => {
    const v = view()
    if (!v.action) return
    const dir = props.directory
    if (!dir) return
    if (v.action === "external") {
      window.api.mafw.terminal.openExternal(dir).catch(() => {
        showToastV2({ description: "打开外部终端失败", variant: "error", duration: 3000 } as any)
      })
      return
    }
    // open / reconnect = 复用活终端；reopen = 显式重建（越过 gone）
    void attach(dir, v.action === "reopen")
  }

  const requestKill = () => {
    if (!killArmed()) {
      setKillArmed(true)
      if (disarmTimer) clearTimeout(disarmTimer)
      disarmTimer = setTimeout(() => setKillArmed(false), 3000)
      return
    }
    if (disarmTimer) clearTimeout(disarmTimer)
    setKillArmed(false)
    const dir = currentDir
    if (!dir) return
    killedDir = dir
    window.api.mafw.terminal.kill(dir)
      .catch(() => { /* 服务端可能已不在；UI 仍回落 idle */ })
      .finally(() => {
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
      <Show when={view().banner}>
        <div class="mafw-terminal-banner">
          <div class="mafw-terminal-banner-card">
            <Show when={view().busy}>
              <LoaderV2 width={18} height={18} />
            </Show>
            <p class="mafw-terminal-banner-text">{view().banner}</p>
            <Show when={view().action}>
              <ButtonV2 variant="outline" size="small" onClick={primary}>
                {view().action === "external"
                  ? "打开外部终端"
                  : view().action === "reconnect"
                    ? "重新连接"
                    : view().action === "reopen"
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
