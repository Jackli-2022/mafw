// 左 dock：会话/搜索两个面（spec 2026-10-22-workbench-layout D2/D3/D5）。
// 由旧 Rail 的会话列表与搜索提取而来；品牌块/五页面导航/底部 Usage 入口已移出
// （品牌与主题→IconRail，五页面→Dashboard，用量→右 dock「用量」tab）。
import { createSignal, createEffect, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import { menuController } from "../context-menu/controller"
import { buildSessionMenu } from "../context-menu/builders/session"
import { buildProjectMenu } from "../context-menu/builders/project"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { isMenuKey } from "../context-menu/keyboard"
import { L } from "../context-menu/labels"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { ResizeHandle } from "@mafw/ui/resize-handle"
import { ManagerCard } from "./ManagerCard"
import { NotesDock } from "./NotesDock"
import { ConfirmOverlay } from "./ConfirmOverlay"
import { formatRailTitle, railProjectName } from "./rail-display"
import { sessionStore } from "../session-store"
import { useConnPhase } from "../connection-state"
import { ConnBanner } from "./ConnBanner"
import { buildSessionTree, pageGroups, RAIL_PAGE_SIZE, type SessionNode, type ProjectNode } from "./session-tree"
import type { LeftDockFace, LeftDockMode } from "../left-dock"

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToastV2({ description: "Copied", duration: 2000 })
  } catch (e) {
    console.warn("[mafw] clipboard failed", e)
  }
}

const EllipsisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="13" cy="8" r="1.4" />
  </svg>
)

const SEARCH_CAP = 200

type Props = {
  mode: LeftDockMode
  face: LeftDockFace
  width: number
  /** push 态拖宽上限（预算内钳制；默认 400） */
  resizeMax?: number
  onClose: () => void
  onResize: (w: number) => void
  activeSessionId: string | null
  managerSessionId?: string | null
  projectsRev?: () => number
  onNewSession: () => void
  onSelectSession: (id: string, title?: string, manager?: boolean) => void
  onSessionDeleted?: (id: string) => void
  forkEnabled?: boolean
  onForkSession?: (id: string) => void
  onExportSession?: (id: string) => void
}

export function LeftDock(props: Props) {
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [gwStatus, setGwStatus] = createSignal<any>(null)
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(-1)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [deleteConfirmId, setDeleteConfirmId] = createSignal<string | null>(null)
  let searchRef: HTMLDivElement | undefined
  let dockRef: HTMLDivElement | undefined
  let previouslyFocused: HTMLElement | null = null

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

  // 浮层焦点管理：打开时移入（搜索面进输入框；会话面进容器），关闭时还原触发元素。
  onMount(() => {
    if (props.mode !== "overlay") return
    previouslyFocused = document.activeElement as HTMLElement | null
    queueMicrotask(() => {
      const root = dockRef
      if (!root) return
      const target = root.querySelector<HTMLElement>("input") ?? root
      target.focus()
    })
  })
  onCleanup(() => {
    if (props.mode !== "overlay") return
    previouslyFocused?.focus?.()
  })

  createEffect(() => {
    if (!gwReady()) return
    props.projectsRev?.()
    window.api.mafw.projects.list().then(setProjects).catch(e => console.warn("[mafw] projects.list error:", e))
    window.api.mafw.projects.current().then((res: any) => { if (res) setCurrentProject(res) }).catch(e => console.warn("[mafw] projects.current error:", e))
  })

  const searching = createMemo(() => props.face === "search" || query().trim().length > 0)

  // 切回会话面时清空搜索词：否则残留 query 会让会话列表保持过滤，
  // 而搜索框已随 face 卸载，用户无法清除（deferred minor）。
  createEffect(() => {
    if (props.face !== "search") { setQuery(""); setHi(-1) }
  })

  const currentSessions = createMemo(() => (projectID() ? sessionStore.sessionsFor(projectID()) : []))

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

  const filteredGroups = createMemo<ProjectNode["groups"]>(() => {
    const groups = projectNode()?.groups ?? []
    const q = query().trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(g => ({ ...g, items: g.items.filter(n => n.title.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0)
  })

  const flatResults = createMemo(() => filteredGroups().flatMap(g => g.items))

  const hiNodeId = createMemo(() => {
    const i = hi()
    if (i < 0) return null
    return flatResults().slice(0, SEARCH_CAP)[i]?.id ?? null
  })

  const [limit, setLimit] = createSignal(RAIL_PAGE_SIZE)
  createEffect(() => { projectID(); setLimit(RAIL_PAGE_SIZE) })
  const paged = createMemo(() => pageGroups(filteredGroups(), limit()))
  const showMore = () => setLimit(l => l + RAIL_PAGE_SIZE)
  const totalCount = createMemo(() => (projectNode()?.groups ?? []).reduce((n, g) => n + g.items.length, 0))
  const searchTruncated = createMemo(() => searching() && flatResults().length > SEARCH_CAP)
  const offline = createMemo(() => (projectID() ? sessionStore.isOffline(projectID()) : false) || connPhase() === "down")
  const managerRow = createMemo<SessionNode | null>(() => projectNode()?.manager ?? null)

  const onSearchKeyDown = (e: KeyboardEvent) => {
    const list = flatResults().slice(0, SEARCH_CAP)
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      const s = list[hi()]
      if (s) { props.onSelectSession(s.id, s.title, s.manager); setQuery(""); setHi(-1) }
    } else if (e.key === "Escape") { setQuery(""); setHi(-1) }
  }

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
      await window.api.mafw.sessions.delete(id)
      props.onSessionDeleted?.(id)
      sessionStore.invalidate(pid)
      showToastV2({ description: "已删除", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `删除失败: ${e?.message || e}`, duration: 3000 })
    }
  }

  const selectProject = (p: any) => {
    setCurrentProject(p)
    try { window.api.mafw.projects.setCurrent(p.worktree) } catch (e) { console.warn("[mafw]", e) }
    sessionStore.invalidate(p.worktree || p.id || null)
  }

  const openProjectFolder = async () => {
    try {
      const res = await window.api.mafw.projects.openDirectory()
      if (!res?.ok || !res.path) return
      await window.api.mafw.projects.setCurrent(res.path)
      setCurrentProject({ worktree: res.path, id: res.path })
      sessionStore.invalidate(res.path)
      showToastV2({ description: "项目已打开", duration: 2000 })
    } catch (e: any) {
      showToastV2({ description: `打开失败: ${e?.message || e}`, duration: 4000 })
    }
  }

  const openNode = (node: SessionNode) => {
    props.onSelectSession(node.id, node.title, false)
    setHi(-1)
  }

  const sessionMenu = (node: SessionNode, point: { x: number; y: number }, from: "contextmenu" | "ellipsis" | "keyboard", returnFocus?: HTMLElement | null) => {
    menuController.request(
      buildSessionMenu,
      {
        id: node.id,
        title: node.title,
        kind: "row" as const,
        canFork: props.forkEnabled !== false,
      },
      (id) => {
        if (id === "session.open") openNode(node)
        else if (id === "session.rename") startRename(node)
        else if (id === "session.fork") props.onForkSession?.(node.id)
        else if (id === "session.export") props.onExportSession?.(node.id)
        else if (id === "session.copyId") void copyText(node.id)
        else if (id === "session.delete") setDeleteConfirmId(node.id)
      },
      { point, from, returnFocus },
    )
  }

  const requestSessionMenu = (node: SessionNode, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    sessionMenu(node, { x: event.clientX, y: event.clientY }, "contextmenu", event.currentTarget as HTMLElement)
  }

  const requestSessionMenuFromButton = (node: SessionNode, event: MouseEvent) => {
    event.stopPropagation()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const row = (event.currentTarget as HTMLElement).closest(".mafw-rail-session") as HTMLElement | null
    sessionMenu(node, { x: rect.left, y: rect.bottom }, "ellipsis", row)
  }

  const onRowKeyDown = (node: SessionNode, event: KeyboardEvent) => {
    if (isMenuKey(event)) {
      event.preventDefault()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      sessionMenu(node, { x: rect.left + 12, y: rect.bottom }, "keyboard", event.currentTarget as HTMLElement)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openNode(node)
    }
  }

  const requestProjectMenu = (path: string, event: MouseEvent, before?: () => void) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    menuController.request(
      buildProjectMenu,
      { id: path, path },
      (id) => {
        if (id === "project.newSession") { before?.(); props.onNewSession() }
        else if (id === "project.reveal") void window.api.revealPath(path)
        else if (id === "project.copyPath") void copyText(path)
      },
      { point: { x: event.clientX, y: event.clientY }, returnFocus: event.currentTarget as HTMLElement },
    )
  }

  const renderNode = (node: SessionNode) => (
    <Show
      when={renamingId() !== node.id}
      fallback={
        <div class="mafw-rail-session renaming">
          <TextInputV2
            value={renameDraft()}
            onInput={e => { setRenameDraft(e.currentTarget.value) }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(node.id, projectID()) }
              else if (e.key === "Escape") setRenamingId(null)
            }}
            autofocus
          />
        </div>
      }
    >
      <div
        class="mafw-rail-session"
        classList={{ active: props.activeSessionId === node.id }}
        data-hi={hiNodeId() === node.id ? "1" : undefined}
        tabIndex={0}
        onClick={() => openNode(node)}
        onContextMenu={(event) => requestSessionMenu(node, event)}
        onKeyDown={(event) => onRowKeyDown(node, event)}
      >
        <TooltipV2 value={node.worktree ? `worktree：${node.worktree}` : new Date(node.updated || Date.now()).toLocaleString()} openDelay={300}>
          <span class="mafw-rail-session-title">
            <Show when={node.worktree}>
              <span class="mafw-rail-wt-badge">⎇ {node.worktree}</span>
            </Show>
            {formatRailTitle(node.title)}
          </span>
        </TooltipV2>
        <span
          class="mafw-rail-row-dots"
          onClick={(event) => requestSessionMenuFromButton(node, event)}
        ><EllipsisIcon /></span>
      </div>
    </Show>
  )

  const projectSwitcher = () => (
    <DropdownMenu placement="bottom-start">
      <DropdownMenu.Trigger as="div" class="mafw-rail-switcher" onContextMenu={(event: MouseEvent) => {
        const path = projectID()
        if (path) requestProjectMenu(path, event)
      }}>
        <span class="mafw-rail-switcher-name">{railProjectName(currentProject()?.worktree, true)}</span>
        <Icon name="chevron-down" size="small" class="mafw-rail-switcher-caret" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="mafw-rail-switcher-menu">
          <For each={projects()}>
            {(p) => (
              <DropdownMenu.Item
                onSelect={() => selectProject(p)}
                onContextMenu={(event: MouseEvent) => requestProjectMenu(p.worktree || p.id, event, () => selectProject(p))}
              >
                <DropdownMenu.ItemLabel>{railProjectName(p.worktree || p.id, (p.worktree || p.id) === projectID())}</DropdownMenu.ItemLabel>
                {currentProject()?.worktree === p.worktree && <Icon name="check-small" size="small" class="mafw-rail-check" />}
              </DropdownMenu.Item>
            )}
          </For>
          <DropdownMenu.Item onSelect={() => void openProjectFolder()}>
            <DropdownMenu.ItemLabel>＋ 打开项目文件夹…</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => copyText(projectID() || "")}>
            <DropdownMenu.ItemLabel>{L.project.copyPath}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )

  return (
    <div ref={dockRef} tabIndex={-1} class="mafw-left-dock" classList={{ overlay: props.mode === "overlay", push: props.mode === "push" }} style={{ width: `${props.width}px` }}>
      <div class="mafw-left-dock-head">
        {projectSwitcher()}
        <TooltipV2 value="关闭左栏" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" icon="x" aria-label="关闭左栏" onClick={props.onClose} />
        </TooltipV2>
      </div>

      <Show when={props.face === "notes"}>
        <div class="mafw-left-dock-notes"><NotesDock /></div>
      </Show>

      <Show when={props.face !== "notes"}>

      <Show when={props.face === "search"}>
        <div class="mafw-left-dock-search" ref={searchRef}>
          <TextInputV2
            value={query()}
            onInput={e => { setQuery(e.currentTarget.value); setHi(-1) }}
            onKeyDown={onSearchKeyDown}
            onClearClick={() => { setQuery(""); setHi(-1) }}
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            showClearButton={query().length > 0}
            placeholder="Search chats…"
            autofocus
          />
        </div>
      </Show>

      <Show when={props.face === "sessions"}>
        <ManagerCard
          managerSessionId={managerRow()?.id ?? props.managerSessionId ?? null}
          managerUpdatedAt={managerRow()?.updated}
          online={gwReady()}
          onSelectSession={props.onSelectSession}
        />
      </Show>

      <Show when={connPhase() === "down"}><ConnBanner /></Show>
      <div class="mafw-left-dock-scroll">
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
          <Show when={props.face === "search"} fallback={
            <div class="mafw-rail-project">
              <div class="mafw-rail-project-head current">
                <span class="mafw-rail-project-name">{railProjectName(projectNode()!.name || projectNode()!.projectID, true)}</span>
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
                      </div>
                      <For each={g.items}>{(node) => renderNode(node)}</For>
                    </>
                  )}
                </For>
                <Show when={!sessionStore.isLoading() && paged().total === 0}>
                  <div class="mafw-rail-empty">No sessions yet</div>
                </Show>
                <Show when={paged().hasMore}>
                  <div class="mafw-rail-load-more" onClick={() => showMore()}>
                    加载更多（还有 {paged().total - limit()} 条）
                  </div>
                </Show>
              </div>
            </div>
          }>
            <div class="mafw-rail-project-body">
              <For each={flatResults().slice(0, SEARCH_CAP)}>{(node) => renderNode(node)}</For>
            </div>
          </Show>
        </Show>
        <Show when={searchTruncated()}>
          <div class="mafw-rail-load-more">仅显示前 {SEARCH_CAP} 条结果</div>
        </Show>
      </div>

      </Show>

      <Show when={props.mode === "push"}>
        <ResizeHandle
          direction="horizontal"
          edge="end"
          size={props.width}
          min={180}
          max={props.resizeMax ?? 400}
          collapseThreshold={120}
          onResize={props.onResize}
          onCollapse={props.onClose}
        />      </Show>

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
