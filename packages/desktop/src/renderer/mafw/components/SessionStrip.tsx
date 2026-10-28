import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import { Icon } from "@mafw/ui/icon"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { menuController } from "../context-menu/controller"
import { buildSessionMenu } from "../context-menu/builders/session"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { isMenuKey } from "../context-menu/keyboard"
import { stripOverflowed } from "./session-strip-overflow"
import { freezeTabs } from "./session-strip-slinky"
import { formatRailTitle } from "./rail-display"

export function SessionStrip(props: {
  sessions: () => { id: string; title: string; manager?: boolean }[]
  activeViewId: () => string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExport: (id: string) => void
  onCopyId: (id: string) => void
  onNew: () => void
  /** 点击左侧品牌位回 Welcome 首页 */
  onHome: () => void
  forkEnabled?: boolean
  onFork?: (id: string) => void
}) {
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [overflowed, setOverflowed] = createSignal(false)
  let scrollEl: HTMLDivElement | undefined

  const recheckOverflow = () => setOverflowed(stripOverflowed(scrollEl))

  // 溢出检测：尺寸变化（ResizeObserver）+ tab 集合变化都重算
  let ro: ResizeObserver | undefined
  onMount(() => {
    if (scrollEl) {
      ro = new ResizeObserver(recheckOverflow)
      ro.observe(scrollEl)
    }
    recheckOverflow()
  })
  onCleanup(() => ro?.disconnect())
  createEffect(() => {
    props.sessions().length // 依赖：tab 增删后下一帧重算（DOM 已更新）
    requestAnimationFrame(recheckOverflow)
  })

  // 业界 tab 条：纵向滚轮 → 横向滚动（无可见滚动条，Chrome/VS Code 同款）
  onMount(() => {
    scrollEl?.addEventListener("wheel", (e) => {
      if (!e.deltaY || !scrollEl) return
      if (scrollEl.scrollWidth <= scrollEl.clientWidth) return
      e.preventDefault()
      scrollEl.scrollLeft += e.deltaY
    }, { passive: false })
  })

  // 激活 tab 切换时滚入视野（overflow 场景下点击 Rail/外部选中也要可见）。
  // DOM 查询 .active 而非 ref map——不依赖 Kobalte Trigger 的 ref 转发。
  createEffect(() => {
    const id = props.activeViewId()
    if (!id) return
    scrollEl?.querySelector(".mafw-session-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  })

  // Tab slinky（Chrome）：关闭后其余 tab 冻结当前像素宽，指针离开 strip 才恢复——
  // 连续点 × 时下一个 tab 的 × 总在光标原位置
  let slinkyRestore: (() => void) | null = null
  const endSlinky = () => { slinkyRestore?.(); slinkyRestore = null }
  const handleClose = (id: string) => {
    if (!slinkyRestore && scrollEl) {
      slinkyRestore = freezeTabs([...scrollEl.querySelectorAll<HTMLElement>(".mafw-session-tab")])
    }
    props.onClose(id)
  }

  const tabMenu = (session: { id: string; title: string }, point: { x: number; y: number }, from: "contextmenu" | "ellipsis" | "keyboard") => {
    menuController.request(
      buildSessionMenu,
      {
        id: session.id,
        title: session.title,
        kind: "tab" as const,
        canFork: props.forkEnabled !== false,
      },
      (id) => {
        if (id === "session.open") props.onSelect(session.id)
        else if (id === "session.rename") { setRenamingId(session.id); setRenameDraft(session.title || "") }
        else if (id === "session.fork") props.onFork?.(session.id)
        else if (id === "session.export") props.onExport(session.id)
        else if (id === "session.copyId") props.onCopyId(session.id)
        else if (id === "session.closeTab") handleClose(session.id)
      },
      { point, from },
    )
  }

  const requestTabMenu = (session: { id: string; title: string }, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    tabMenu(session, { x: event.clientX, y: event.clientY }, "contextmenu")
  }

  const onTabKeyDown = (session: { id: string; title: string }, event: KeyboardEvent) => {
    if (!isMenuKey(event)) return
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    tabMenu(session, { x: rect.left + 12, y: rect.bottom }, "keyboard")
  }

  return (
    <div class="mafw-sessionstrip" onPointerLeave={endSlinky}>
      {/* 左侧品牌位（2026-10-23 裁决 B2：线框暖灰 monogram + 小字标）——
          放在滚动层之外：tab 再多、横向滚动时 logo 不动；点击回 Welcome 首页 */}
      <TooltipV2 value="回到 Welcome 页" openDelay={300}>
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-sessionstrip-brand"
          aria-label="回到 Welcome 页"
          onClick={props.onHome}
        >
          <span class="mafw-sessionstrip-brand-mark" aria-hidden="true">M</span>
          <span class="mafw-sessionstrip-brand-word" aria-hidden="true">MAFW</span>
        </ButtonV2>
      </TooltipV2>
      <div class="mafw-sessionstrip-divider" aria-hidden="true" />
      <div class="mafw-sessionstrip-scroll" ref={scrollEl}>
        {props.sessions().map(s => (
          <div
            class="mafw-session-tab"
            classList={{ active: props.activeViewId() === s.id }}
            tabIndex={0}
            onClick={() => props.onSelect(s.id)}
            onContextMenu={(event) => requestTabMenu(s, event)}
            onKeyDown={(event) => onTabKeyDown(s, event)}
          >
            <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
            <span
              class="mafw-session-title"
              onDblClick={e => { e.stopPropagation(); setRenamingId(s.id); setRenameDraft(s.title || "") }}
            >
              <Show when={renamingId() !== s.id} fallback={
                <TextInputV2
                  value={renameDraft()}
                  onInput={e => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") {
                      const next = renameDraft().trim()
                      if (next && next !== s.title) props.onRename(s.id, next)
                      setRenamingId(null)
                    }
                    if (e.key === "Escape") setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)}
                  style={{ width: "120px", height: "22px", "font-size": "12px" }}
                />
              }>{formatRailTitle(s.title)}</Show>
            </span>
            <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={(e: MouseEvent) => { e.stopPropagation(); handleClose(s.id) }}>✕</ButtonV2>
          </div>
        ))}
      </div>
      {/* ⋯ 溢出菜单（Chrome「list all tabs」/VS Code ›）：仅溢出时出现，固定在滚动层外 */}
      <Show when={overflowed()}>
        <DropdownMenu placement="bottom-end">
          <DropdownMenu.Trigger as="div">
            <ButtonV2 variant="ghost" size="small" class="mafw-session-overflow" aria-label="全部会话">
              <Icon name="chevron-down" size="small" />
            </ButtonV2>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mafw-session-overflow-menu">
              <For each={props.sessions()}>
                {s => (
                  <DropdownMenu.Item onSelect={() => props.onSelect(s.id)}>
                    <DropdownMenu.ItemLabel class="mafw-session-overflow-item">
                      <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
                      <span class="mafw-session-overflow-title">{formatRailTitle(s.title)}</span>
                      <Show when={props.activeViewId() === s.id}>
                        <Icon name="check-small" size="small" />
                      </Show>
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
      <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={() => props.onNew()}>+</ButtonV2>
    </div>
  )
}
