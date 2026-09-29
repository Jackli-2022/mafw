// @ts-nocheck
import { createSignal, createEffect, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import { ContextMenu } from "@mafw/ui/context-menu"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { UsagePill } from "./UsagePill"
import { ManagerCard } from "./ManagerCard"
import { ConfirmOverlay } from "./ConfirmOverlay"
import { sessionStore } from "../session-store"
import { useConnPhase } from "../connection-state"
import { ConnBanner } from "./ConnBanner"
import { buildSessionTree, pageGroups, RAIL_PAGE_SIZE, type SessionNode, type ProjectNode } from "./session-tree"
import { NAV_TABS, type NavTab } from "./nav-tab"

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToastV2({ description: "Copied", duration: 2000 })
  } catch (e) {
    console.warn("[mafw] clipboard failed", e)
  }
}

// Ellipsis as a real SVG icon (the icon set has none); three current-color dots.
const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="13" cy="8" r="1.4" />
  </svg>
)

const SEARCH_CAP = 200

type Props = {
  activeSessionId: string | null
  managerSessionId?: string | null
  projectsRev?: () => number
  activeTab?: NavTab
  tabCounts?: Partial<Record<NavTab, number>>
  onTabChange?: (tab: NavTab) => void
  onSelectSession: (id: string, title?: string, manager?: boolean) => void
  onSessionDeleted?: (id: string) => void
  onSettings?: () => void
  onOpenUsage?: () => void
  brand?: any
}

export function Rail(props: Props) {
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [gwStatus, setGwStatus] = createSignal<any>(null)
  const [query, setQuery] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [hi, setHi] = createSignal(-1)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [deleteConfirmId, setDeleteConfirmId] = createSignal<string | null>(null)
  let searchRef: HTMLDivElement | undefined

  const gwReady = createMemo(() => gwStatus()?.state === "ready")
  const connPhase = useConnPhase()
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
    // Bumped when the gateway broadcasts project_registered (CLI register /
    // registry watcher) — the list is otherwise pulled once on ready.
    props.projectsRev?.()
    window.api.mafw.projects.list().then(setProjects).catch(e => console.warn("[mafw] projects.list error:", e))
    window.api.mafw.projects.current().then((res: any) => { if (res) setCurrentProject(res) }).catch(e => console.warn("[mafw] projects.current error:", e))
  })

  const searching = createMemo(() => query().trim().length > 0)

  // 单项目树（v6 决定）：只加载当前项目会话；跨项目切换用顶部 switcher。
  const currentSessions = createMemo(() => (projectID() ? sessionStore.sessionsFor(projectID()) : []))

  // 当前项目条目：优先取注册项目（拿 name/worktree），否则用 currentProject() 合成。
  const currentEntry = createMemo<{ id: string; name?: string; worktree?: string } | null>(() => {
    const pid = projectID()
    if (!pid) return null
    const found = projects().find(p => (p.worktree || p.id) === pid)
    if (found) return found
    const cp = currentProject()
    return { id: cp?.id || pid, name: cp?.name || cp?.worktree || pid, worktree: pid }
  })

  const tree = createMemo<ProjectNode[]>(() => {
    const entry = currentEntry()
    const pid = projectID()
    if (!entry || !pid) return []
    return buildSessionTree([entry], { [pid]: currentSessions() }, pid)
  })

  const projectNode = createMemo<ProjectNode | null>(() => tree()[0] ?? null)

  // 搜索：仅当前项目（标题匹配）。
  const filteredGroups = createMemo<ProjectNode["groups"]>(() => {
    const groups = projectNode()?.groups ?? []
    const q = query().trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(g => ({ ...g, items: g.items.filter(n => n.title.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0)
  })

  const flatResults = createMemo(() => filteredGroups().flatMap(g => g.items))

  // 高亮节点 id（O(1) 比较）。
  const hiNodeId = createMemo(() => {
    const i = hi()
    if (i < 0) return null
    return flatResults().slice(0, SEARCH_CAP)[i]?.id ?? null
  })

  // 分页（100 + 加载更多）；切换项目重置。
  const [limit, setLimit] = createSignal(RAIL_PAGE_SIZE)
  createEffect(() => { projectID(); setLimit(RAIL_PAGE_SIZE) })
  const paged = createMemo(() => pageGroups(filteredGroups(), limit()))
  const showMore = () => setLimit(l => l + RAIL_PAGE_SIZE)
  const totalCount = createMemo(() => (projectNode()?.groups ?? []).reduce((n, g) => n + g.items.length, 0))

  const searchTruncated = createMemo(() => searching() && flatResults().length > SEARCH_CAP)

  const offline = createMemo(() => (projectID() ? sessionStore.isOffline(projectID()) : false) || connPhase() === "down")

  // 当前项目的 manager 节点（用于 ManagerCard 更新时间；manager 不入树）。
  const managerRow = createMemo<SessionNode | null>(() => projectNode()?.manager ?? null)

  const onSearchKeyDown = (e: KeyboardEvent) => {
    const list = flatResults().slice(0, SEARCH_CAP)
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      const s = list[hi()]
      if (s) { props.onSelectSession(s.id, s.title, s.manager); setQuery(""); setHi(-1) }
    } else if (e.key === "Escape") { setQuery(""); setHi(-1); setSearchOpen(false) }
  }

  // Ctrl/Cmd+K focuses search.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchRef?.querySelector("input")?.focus(), 0)
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Inline rename (Electron has no window.prompt): row swaps to a TextInputV2.
  const startRename = (node: SessionNode) => { setRenamingId(node.id); setRenameDraft(node.title) }
  const commitRename = async (id: string, pid: string | null) => {
    const title = renameDraft().trim()
    setRenamingId(null)
    if (!title) return
    try {
      await window.api.mafw.sessions.rename(id, title)
      sessionStore.invalidate(pid)
    } catch (e: any) {
      showToastV2({ description: `重命名失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const deleteSession = async (id: string, pid: string | null) => {
    try {
      // Preload exposes sessions.delete (there is no `remove` alias).
      await window.api.mafw.sessions.delete(id)
      // Close any open tab of the deleted session (MafwShell wires this to
      // closeSession; a safe no-op when the session is not open).
      props.onSessionDeleted?.(id)
      sessionStore.invalidate(pid)
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
  }

  const openProjectFolder = async () => {
    try {
      const res = await window.api.mafw.projects.openDirectory()
      if (!res?.ok || !res.path) return // canceled or picker failure (logged in main)
      await window.api.mafw.projects.setCurrent(res.path) // throws on 400 (home dir etc.)
      setCurrentProject({ worktree: res.path, id: res.path }) // optimistic highlight
      sessionStore.invalidate(res.path)
      showToastV2({ description: "项目已打开", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `打开失败: ${e?.message || e}`, duration: 4000 })
    }
  }

  // 点击会话行：直接打开（单项目树，无跨项目切换；manager 不在树内）。
  const openNode = (node: SessionNode) => {
    props.onSelectSession(node.id, node.title, false)
    setHi(-1)
  }

  const renderNode = (node: SessionNode) => (
    <Show
      when={renamingId() !== node.id}
      fallback={
        <div class="mafw-rail-session renaming">
          <TextInputV2
            value={renameDraft()}
            onInput={e => setRenameDraft(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(node.id, projectID()) }
              else if (e.key === "Escape") setRenamingId(null)
            }}
            autoFocus
          />
        </div>
      }
    >
      <ContextMenu>
        <ContextMenu.Trigger
          as="div"
          class="mafw-rail-session"
          classList={{ active: props.activeSessionId === node.id }}
          data-hi={hiNodeId() === node.id ? "1" : undefined}
          onClick={() => openNode(node)}
        >
          <TooltipV2 value={node.worktree ? `worktree：${node.worktree}` : new Date(node.updated || Date.now()).toLocaleString()} openDelay={300}>
            <span class="mafw-rail-session-title">
              <Show when={node.worktree}>
                <span class="mafw-rail-wt-badge" title="">⎇ {node.worktree}</span>
              </Show>
              {node.title}
            </span>
          </TooltipV2>
          <span
            class="mafw-rail-row-dots"
            onClick={e => { e.stopPropagation(); e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })) }}
          ><EllipsisIcon /></span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => openNode(node)}>
              <ContextMenu.ItemLabel>Open</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => startRename(node)}>
              <ContextMenu.ItemLabel>Rename</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => setDeleteConfirmId(node.id)}>
              <ContextMenu.ItemLabel>Delete</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => copyText(node.id)}>
              <ContextMenu.ItemLabel>Copy session ID</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  )

  return (
    <div class="mafw-rail">
      <Show when={props.brand}>
        <div class="mafw-rail-brand">{props.brand}</div>
      </Show>
      {/* Header: project switcher (left) + search + collapse arrow (right) */}
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
              <DropdownMenu.Item onSelect={() => void openProjectFolder()}>
                <DropdownMenu.ItemLabel>＋ 打开项目文件夹…</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => copyText(projectID() || "")}>
                <DropdownMenu.ItemLabel>Copy path</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <TooltipV2 value="Search  Ctrl+K" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            icon="magnifying-glass"
            aria-label="搜索会话"
            onClick={() => setSearchOpen(v => !v)}
            class="mafw-rail-search-toggle"
          />
        </TooltipV2>
      </div>

      <Show when={searchOpen()}>
        <div class="mafw-rail-search" ref={searchRef}>
          <TextInputV2
            value={query()}
            onInput={e => { setQuery(e.currentTarget.value); setHi(-1) }}
            onKeyDown={onSearchKeyDown}
            onBlur={e => { if (!query().trim()) setSearchOpen(false) }}
            onClearClick={() => { setQuery(""); setHi(-1) }}
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            showClearButton={query().length > 0}
            placeholder="Search chats…"
            autoFocus
          />
        </div>
      </Show>

      {/* 主导航（v6 §0b：吸收原 TabStrip 六页职责 + trajectory + 新建会话） */}
      <nav class="mafw-rail-nav">
        <button type="button" class="mafw-rail-new" onClick={() => void newSession()}>
          <Icon name="plus-small" size="small" />
          <span>New session</span>
        </button>
        <For each={NAV_TABS}>
          {(t) => (
            <button
              type="button"
              class="mafw-rail-nav-item"
              classList={{ active: props.activeTab === t.id }}
              onClick={() => props.onTabChange?.(t.id)}
            >
              <Icon name={t.icon} size="small" />
              <span class="mafw-rail-nav-label">{t.label}</span>
              <Show when={(props.tabCounts?.[t.id] || 0) > 0}>
                <span class="mafw-tab-count">{props.tabCounts?.[t.id]}</span>
              </Show>
            </button>
          )}
        </For>
      </nav>

      <ManagerCard
        managerSessionId={managerRow()?.id ?? props.managerSessionId ?? null}
        managerUpdatedAt={managerRow()?.updated}
        online={gwReady()}
        onSelectSession={props.onSelectSession}
      />

      {/* Scroll area: single-project tree（项目根 → 日期组 → 会话） */}
      <Show when={connPhase() === "down"}><ConnBanner /></Show>
      <div class="mafw-rail-scroll">
        <Show when={offline()}>
          <div class="mafw-rail-empty">Gateway offline</div>
        </Show>
        <Show when={!offline() && !projectNode()}>
          <div class="mafw-rail-empty">No project</div>
        </Show>
        <Show when={searching() && flatResults().length === 0}>
          <div class="mafw-rail-empty">No chats found</div>
        </Show>
        <Show when={projectNode()}>
          <div class="mafw-rail-project">
            <div class="mafw-rail-project-head current">
              <span class="mafw-rail-project-name">{(projectNode()!.name || projectNode()!.projectID).split(/[/\\]/).pop()}</span>
              <Show when={totalCount() > 0}>
                <span class="mafw-rail-project-count">{totalCount()}</span>
              </Show>
            </div>
            <div class="mafw-rail-project-body">
              <For each={paged().groups}>
                {(g) => (
                  <>
                    <div class="mafw-rail-date-group">
                      <span>{g.label}</span>
                      <span class="mafw-rail-date-count">{g.items.length}</span>
                    </div>
                    <For each={g.items}>{(node) => renderNode(node)}</For>
                  </>
                )}
              </For>
              <Show when={!sessionStore.isLoading() && paged().total === 0}>
                <div class="mafw-rail-empty">{searching() ? "No chats found" : "No sessions yet"}</div>
              </Show>
              <Show when={paged().hasMore}>
                <div class="mafw-rail-load-more" onClick={() => showMore()}>
                  加载更多（还有 {paged().total - limit()} 条）
                </div>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={searchTruncated()}>
          <div class="mafw-rail-load-more">仅显示前 {SEARCH_CAP} 条结果</div>
        </Show>
      </div>

      {/* Pinned bottom area — never scrolls with the list */}
      <div class="mafw-rail-fixed">
        <div class="mafw-rail-footer">
          <UsagePill onClick={() => props.onOpenUsage?.()} />
          <div class="mafw-rail-settings-bar" onClick={() => props.onSettings?.()}>
            <Icon name="settings-gear" size="small" />
            <span>Settings</span>
          </div>
        </div>
      </div>

      <ConfirmOverlay
        open={deleteConfirmId() !== null}
        title="删除该会话？"
        message="此操作不可恢复。"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          const id = deleteConfirmId()
          setDeleteConfirmId(null)
          if (id) void deleteSession(id, projectID())
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
