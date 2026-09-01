// @ts-nocheck
import { createSignal, createEffect, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { UsagePill } from "./UsagePill"
import { sessionStore } from "../session-store"

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToastV2({ description: "Copied", duration: 2000 })
  } catch (e) {
    console.warn("[mafw] clipboard failed", e)
  }
}

const DAY = 86400000
const dayStart = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Fixed date groups (industry consensus): 今天 / 昨天 / 过去 7 天 / 按月（跨年带年份）
const groupLabel = (ts: number): string => {
  const diffDays = Math.round((dayStart(Date.now()) - dayStart(ts)) / DAY)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays < 7) return "过去 7 天"
  const d = new Date(ts)
  const y = d.getFullYear()
  const nowY = new Date().getFullYear()
  return y === nowY ? `${d.getMonth() + 1}月` : `${y}年${d.getMonth() + 1}月`
}

// Ellipsis as a real SVG icon (the icon set has none); three current-color dots.
const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="13" cy="8" r="1.4" />
  </svg>
)

const PAGE = 100
const SEARCH_CAP = 200

type Props = {
  activeSessionId: string | null
  managerSessionId?: string | null
  onSelectSession: (id: string, title?: string, manager?: boolean) => void
  onSessionDeleted?: (id: string) => void
  onSettings?: () => void
  onToggleCollapsed?: () => void
  onOpenUsage?: () => void
}

export function Rail(props: Props) {
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [gwStatus, setGwStatus] = createSignal<any>(null)
  const [query, setQuery] = createSignal("")
  const [limit, setLimit] = createSignal(PAGE)
  const [hi, setHi] = createSignal(-1)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  let searchRef: HTMLDivElement | undefined
  let scrollRef: HTMLDivElement | undefined

  const gwReady = createMemo(() => gwStatus()?.state === "ready")
  const projectID = createMemo(() => {
    const p = currentProject()
    return p ? (p.worktree || p.id || null) : null
  })

  onMount(() => {
    window.api.mafw.gateway.info().then(setGwStatus)
    onCleanup(window.api.mafw.gateway.onStateChange((s) => setGwStatus(s)))
  })

  createEffect(() => {
    if (!gwReady()) return
    window.api.mafw.projects.list().then(setProjects).catch(e => console.warn("[mafw] projects.list error:", e))
    window.api.mafw.projects.current().then((res: any) => { if (res) setCurrentProject(res) }).catch(e => console.warn("[mafw] projects.current error:", e))
  })

  // Store read: refetches on first access, reactive to invalidate().
  const allSessions = createMemo(() => sessionStore.sessionsFor(projectID()))
  const offline = createMemo(() => sessionStore.isOffline(projectID()))

  const managerRow = createMemo(() => {
    const id = props.managerSessionId
    if (!id) return null
    return allSessions().find(s => s.id === id && s.metadata?.mafw?.role === 'manager') || null
  })

  // History = everything except manager sessions.
  const history = createMemo(() => allSessions().filter(s => s.metadata?.mafw?.role !== 'manager'))

  const searching = createMemo(() => query().trim().length > 0)
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return history()
    return history().filter(s => (s.title || '').toLowerCase().includes(q))
  })

  // Date groups over the rendered slice.
  const groups = createMemo(() => {
    const slice = filtered().slice(0, searching() ? SEARCH_CAP : limit())
    const out: { label: string; items: any[] }[] = []
    for (const s of slice) {
      const label = groupLabel(s.time?.updated || s.time?.created || Date.now())
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(s)
      else out.push({ label, items: [s] })
    }
    return out
  })

  const flatResults = createMemo(() => groups().flatMap(g => g.items))

  // Search keyboard navigation: ↑↓ move highlight, Enter opens, Esc clears.
  const onSearchKeyDown = (e: KeyboardEvent) => {
    const list = flatResults()
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      const s = list[hi()]
      if (s) { props.onSelectSession(s.id, s.title, false); setQuery(""); setHi(-1) }
    } else if (e.key === "Escape") { setQuery(""); setHi(-1) }
  }

  // Ctrl/Cmd+K focuses search.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        searchRef?.querySelector("input")?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Infinite scroll: near-bottom → grow the rendered window.
  createEffect(() => {
    const el = scrollRef
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        setLimit(l => (l < filtered().length ? l + PAGE : l))
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => el.removeEventListener("scroll", onScroll))
  })

  // Inline rename (Electron has no window.prompt): row swaps to a TextInputV2.
  const startRename = (s: any) => { setRenamingId(s.id); setRenameDraft(sessionName(s)) }
  const commitRename = async (id: string) => {
    const title = renameDraft().trim()
    setRenamingId(null)
    if (!title) return
    try {
      await window.api.mafw.sessions.rename(id, title)
      sessionStore.invalidate(projectID())
    } catch (e: any) {
      showToastV2({ description: `重命名失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const deleteSession = async (id: string) => {
    try {
      if (!window.confirm("删除该会话？此操作不可恢复。")) return
      await window.api.mafw.sessions.remove(id)
      if (props.activeSessionId === id) props.onSessionDeleted?.(id)
      sessionStore.invalidate(projectID())
      showToastV2({ description: "已删除", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `删除失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const newSession = async () => {
    try {
      const dir = projectID() || "."
      const result = await window.api.mafw.sessions.create({ directory: dir }) as any
      props.onSelectSession(result.id || result.sessionID)
      sessionStore.invalidate(projectID())
    } catch (e) { console.warn("[mafw]", e) }
  }

  const selectProject = (p: any) => {
    setCurrentProject(p)
    try { window.api.mafw.projects.setCurrent(p.worktree) } catch (e) { console.warn("[mafw]", e) }
    // Cached projects can be stale — refetch on switch (per spec).
    sessionStore.invalidate(p.worktree || p.id || null)
    setLimit(PAGE)
  }

  const sessionName = (s: any): string => s.title || (s.id || "").slice(0, 12)

  const renderSessionRow = (s: any) => (
    <Show
      when={renamingId() !== s.id}
      fallback={
        <div class="mafw-rail-session renaming">
          <TextInputV2
            value={renameDraft()}
            onInput={e => setRenameDraft(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(s.id) }
              else if (e.key === "Escape") setRenamingId(null)
            }}
            autoFocus
          />
        </div>
      }
    >
      <DropdownMenu placement="right">
        <DropdownMenu.Trigger
          as="div"
          class="mafw-rail-session"
          classList={{ active: props.activeSessionId === s.id }}
          data-hi={flatResults().indexOf(s) === hi() ? "1" : undefined}
          onClick={() => { props.onSelectSession(s.id, sessionName(s), false); setHi(-1) }}
        >
          <TooltipV2 value={new Date(s.time?.updated || s.time?.created || Date.now()).toLocaleString()} openDelay={300}>
            <span class="mafw-rail-session-title">{sessionName(s)}</span>
          </TooltipV2>
          <span class="mafw-rail-row-dots" onClick={e => e.stopPropagation()}><EllipsisIcon /></span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => props.onSelectSession(s.id, sessionName(s), false)}>
              <DropdownMenu.ItemLabel>Open</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => startRename(s)}>
              <DropdownMenu.ItemLabel>Rename</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => deleteSession(s.id)}>
              <DropdownMenu.ItemLabel>Delete</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => copyText(s.id)}>
              <DropdownMenu.ItemLabel>Copy session ID</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )

  return (
    <div class="mafw-rail">
      {/* Header: project switcher (left) + collapse arrow (right) */}
      <div class="mafw-rail-head">
        <DropdownMenu placement="bottom-start">
          <DropdownMenu.Trigger as="div" class="mafw-rail-switcher">
            <Icon name="chevron-down" size="small" class="mafw-rail-switcher-caret" />
            <span class="mafw-rail-switcher-name">{currentProject()?.worktree?.split(/[/\\]/).pop() || "No project"}</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mafw-rail-switcher-menu">
              <For each={projects()}>
                {(p) => (
                  <DropdownMenu.Item onSelect={() => selectProject(p)}>
                    <DropdownMenu.ItemLabel>{p.worktree?.split(/[/\\]/).pop() || p.id}</DropdownMenu.ItemLabel>
                    {currentProject()?.worktree === p.worktree && <Icon name="check-small" size="small" class="mafw-rail-check" />}
                  </DropdownMenu.Item>
                )}
              </For>
              <DropdownMenu.Item onSelect={() => copyText(projectID() || "")}>
                <DropdownMenu.ItemLabel>Copy path</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <button class="mafw-rail-collapse" onClick={() => props.onToggleCollapsed?.()} aria-label="折叠侧边栏">
          <Icon name="chevron-left" size="small" />
        </button>
      </div>

      <div class="mafw-rail-new">
        <button class="mafw-rail-new-btn" onClick={newSession}>
          <Icon name="plus-small" size="small" />
          <span>New session</span>
        </button>
      </div>

      <div class="mafw-rail-search" ref={searchRef}>
        <TextInputV2
          value={query()}
          onInput={e => { setQuery(e.currentTarget.value); setHi(-1) }}
          onKeyDown={onSearchKeyDown}
          placeholder="Search chats…"
        />
      </div>

      {/* Scroll area: fixed date groups, infinite scroll, search results */}
      <div class="mafw-rail-scroll" ref={scrollRef}>
        <Show when={offline()}>
          <div class="mafw-rail-empty">Gateway offline</div>
        </Show>
        <Show when={!offline() && !searching() && allSessions().length === 0 && !sessionStore.isLoading()}>
          <div class="mafw-rail-empty">No sessions yet</div>
        </Show>
        <Show when={searching() && filtered().length === 0}>
          <div class="mafw-rail-empty">No chats found</div>
        </Show>
        <For each={groups()}>
          {(g) => (
            <>
              <div class="mafw-rail-date-group">
                <span>{g.label}</span>
                <span class="mafw-rail-date-count">{g.items.length}</span>
              </div>
              <For each={g.items}>{(s) => renderSessionRow(s)}</For>
            </>
          )}
        </For>
        <Show when={!searching() && filtered().length > limit()}>
          <div class="mafw-rail-load-more" onClick={() => setLimit(l => l + PAGE)}>加载更多</div>
        </Show>
        <Show when={searching() && filtered().length > SEARCH_CAP}>
          <div class="mafw-rail-load-more">仅显示前 {SEARCH_CAP} 条结果</div>
        </Show>
      </div>

      {/* Pinned bottom area — never scrolls with the list */}
      <div class="mafw-rail-fixed">
        <Show when={managerRow()}>
          <div
            class="mafw-rail-manager-row"
            classList={{ active: props.activeSessionId === managerRow()!.id }}
            onClick={() => props.onSelectSession(managerRow()!.id, "Manager", true)}
          >
            <span class="mafw-rail-session-title">Manager</span>
            <span class="mafw-rail-manager-dot" />
          </div>
        </Show>
        <div class="mafw-rail-footer">
          <UsagePill onClick={() => props.onOpenUsage?.()} />
          <div class="mafw-rail-settings-bar" onClick={() => props.onSettings?.()}>
            <Icon name="settings-gear" size="small" />
            <span>Settings</span>
          </div>
        </div>
      </div>
    </div>
  )
}
