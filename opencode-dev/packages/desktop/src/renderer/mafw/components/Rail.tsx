// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToastV2({ description: "Copied", duration: 2000 })
  } catch (e) {
    console.warn("[mafw] clipboard failed", e)
  }
}

const dayStart = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const dateGroupLabel = (ts: number): string => {
  const diff = dayStart(Date.now()) - dayStart(ts)
  if (diff <= 0) return "今天"
  if (diff === 86400000) return "昨天"
  return `${new Date(ts).getMonth() + 1}月`
}

type Props = {
  activeSessionId: string | null
  sessionRefreshKey: number
  onSelectSession: (id: string, title?: string, manager?: boolean) => void
  onSettings?: () => void
}

export function Rail(props: Props) {
  const [expanded, setExpanded] = createSignal(true)
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [sessions, setSessions] = createSignal<any[]>([])
  const [gwStatus, setGwStatus] = createSignal<any>(null)

  const gwReady = createMemo(() => gwStatus()?.state === "ready")

  onMount(async () => {
    const status = await window.api.mafw.gateway.info()
    setGwStatus(status)
    onCleanup(window.api.mafw.gateway.onStateChange((s) => setGwStatus(s)))
  })

  createEffect(() => {
    if (!gwReady()) return
    console.log("[mafw] Rail gwReady, fetching projects")
    window.api.mafw.projects.list().then(list => {
      setProjects(list as any[])
    }).catch(e => console.warn("[mafw] projects.list error:", e))
    window.api.mafw.projects.current().then((res: any) => {
      if (res) setCurrentProject(res)
    }).catch(e => console.warn("[mafw] projects.current error:", e))
  })

  createEffect(() => {
    props.sessionRefreshKey
    if (!gwReady()) return
    const project = currentProject()
    const projectID = project ? (project.id || project.worktree) : undefined
    console.log("[mafw] Rail fetching sessions projectID:", projectID)
    window.api.mafw.sessions.list(projectID).then((list: any) => {
      console.log("[mafw] sessions.list result count:", Array.isArray(list) ? list.length : typeof list)
      setSessions(Array.isArray(list) ? list : [])
    }).catch(e => { console.warn("[mafw] sessions.list error:", e); setSessions([]) })
  })

  const projectName = createMemo(() => {
    const p = currentProject()
    return p ? (p.worktree?.split(/[/\\]/).pop() || p.id) : "No project"
  })

  const managerSessions = createMemo(() =>
    sessions().filter(s => s.metadata?.mafw?.role === 'manager')
  )
  const regularSessions = createMemo(() =>
    sessions().filter(s => s.metadata?.mafw?.role !== 'manager')
  )

  const sortedRegularSessions = createMemo(() =>
    regularSessions().filter(Boolean).sort((a, b) => (b.time?.created || 0) - (a.time?.created || 0))
  )

  const regularDateGroups = createMemo(() => {
    const list = sortedRegularSessions().slice(0, 50)
    if (list.length <= 20) return null
    const groups: { label: string; items: any[] }[] = []
    for (const s of list) {
      const label = dateGroupLabel(s.time?.created || Date.now())
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(s)
      else groups.push({ label, items: [s] })
    }
    return groups
  })

  const sessionName = (s: any): string =>
    s.metadata?.mafw?.role === 'manager' ? 'Manager' : (s.title || (s.id || '').slice(0, 12))

  const agentGlyph = (s: any): string => {
    const name = sessionName(s).trim()
    return name ? [...name][0].toUpperCase() : "⋮"
  }

  const selectProject = (p: any) => {
    setCurrentProject(p)
    try { window.api.mafw.projects.setCurrent(p.worktree) } catch (e) { console.warn("[mafw]", e) }
  }

  const renderSessionRow = (s: any, manager: boolean) => (
    <ContextMenu>
      <ContextMenu.Trigger
        as="div"
        class={`mafw-rail-item-label mafw-rail-session${manager ? " mafw-rail-manager-session" : ""}`}
        classList={{ active: props.activeSessionId === s.id }}
        onClick={() => props.onSelectSession(s.id, sessionName(s), manager)}
      >
        <TooltipV2 value={new Date(s.time?.created || Date.now()).toLocaleString()} openDelay={300}>
          <span style={{ display: "flex", "align-items": "center", gap: 6, width: "100%" }}>
            <span class="mafw-agent-icon">{agentGlyph(s)}</span>
            <span class="mafw-rail-session-title">{sessionName(s)}</span>
            {manager && <span class="mafw-rail-manager-label">Manager</span>}
            {!manager && (
              <span class="mafw-rail-session-time">
                {s.time?.created ? new Date(s.time.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
              </span>
            )}
          </span>
        </TooltipV2>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => props.onSelectSession(s.id, sessionName(s), manager)}>
            <ContextMenu.ItemLabel>Open</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => copyText(s.id)}>
            <ContextMenu.ItemLabel>Copy session ID</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )

  return (
    <div class="mafw-rail">
      <div class="mafw-rail-section" onClick={() => setExpanded(!expanded)}>
        <Icon name="chevron-down" size="small" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.12s" }} />
        <Icon name="folder" size="small" />
        <span>History</span>
        <span class="mafw-rail-section-count">{sessions().filter(Boolean).length}</span>
      </div>
      {expanded && (
        <div class="mafw-rail-tree">
          <div class="mafw-rail-tree-item">
            <div class="mafw-rail-item-label" style={{ "font-weight": 500 }}>
              <Icon name="folder" size="small" />
              {projectName()}
            </div>
            <div class="mafw-rail-subtree">
              {(!Array.isArray(sessions()) || sessions().filter(Boolean).length === 0) ? (
                <div class="mafw-rail-item-label mafw-rail-empty" style={{ opacity: 0.4 }}>
                  No sessions yet
                </div>
              ) : (
                <>
                  {managerSessions().filter(Boolean).map(s => renderSessionRow(s, true))}
                  {regularDateGroups() ? (
                    regularDateGroups()!.map(g => (
                      <>
                        <div class="mafw-rail-date-group">{g.label}</div>
                        {g.items.map(s => renderSessionRow(s, false))}
                      </>
                    ))
                  ) : (
                    sortedRegularSessions().slice(0, 50).map(s => renderSessionRow(s, false))
                  )}
                </>
              )}
              <div
                class="mafw-rail-item-label mafw-rail-add"
                onClick={async () => {
                  try {
                    const project = currentProject()
                    const dir = project?.worktree || project?.id || "."
                    const result = await window.api.mafw.sessions.create({ directory: dir }) as any
                    props.onSelectSession(result.id || result.sessionID)
                  } catch (e) { console.warn("[mafw]", e) }
                }}
              >
                + new session
              </div>
            </div>
          </div>
          {projects().length > 1 && (
            <div class="mafw-rail-project-list">
              <div class="mafw-rail-item-label" style={{ "font-size": 11, opacity: 0.5, "margin-top": 8 }}>
                All projects
              </div>
              {projects().map(p => (
                <ContextMenu>
                  <ContextMenu.Trigger
                    as="div"
                    class="mafw-rail-item-label mafw-rail-project-item"
                    classList={{ active: currentProject()?.worktree === p.worktree }}
                    onClick={() => selectProject(p)}
                  >
                    <Icon name="folder" size="small" />
                    {p.worktree?.split(/[/\\]/).pop() || p.id}
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content>
                      <ContextMenu.Item onSelect={() => selectProject(p)}>
                        <ContextMenu.ItemLabel>Set as current</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                      <ContextMenu.Item onSelect={() => copyText(p.worktree || p.id)}>
                        <ContextMenu.ItemLabel>Copy path</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
      )}
      <div class="mafw-rail-spacer" />
      <div class="mafw-rail-section" onClick={() => props.onSettings?.()}>
        <Icon name="settings-gear" size="small" />
        <span>Settings</span>
      </div>
      <div class="mafw-rail-status" classList={{
        "mafw-rail-status-offline": !gwReady(),
        "mafw-rail-status-starting": gwStatus()?.state === "starting",
      }}>
        <ContextMenu>
          <ContextMenu.Trigger as="div" class="mafw-rail-status-inner">
            <span class="mafw-rail-status-dot" classList={{ starting: gwStatus()?.state === "starting" }} />
            <span class="mafw-rail-status-text">
              {gwStatus()?.state === "ready" ? `connected :${gwStatus()?.port ?? 3000}` :
               gwStatus()?.state === "starting" ? "starting..." :
               "disconnected"}
            </span>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => window.api.mafw.gateway.restart()}>
                <ContextMenu.ItemLabel>Restart Gateway</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => copyText(gwStatus()?.url || "")} disabled={!gwStatus()?.url}>
                <ContextMenu.ItemLabel>Copy Gateway URL</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
        {gwStatus()?.state === "failed" && (
          <ButtonV2 variant="ghost" size="small" class="mafw-rail-restart" onClick={() => window.api.mafw.gateway.restart()}>
            restart
          </ButtonV2>
        )}
      </div>
    </div>
  )
}
