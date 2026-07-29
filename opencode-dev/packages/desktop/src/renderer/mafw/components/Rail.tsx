// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

type Props = {
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onSettings?: () => void
}

export function Rail(props: Props) {
  const [expanded, setExpanded] = createSignal(true)
  const [projects, setProjects] = createSignal<any[]>([])
  const [currentProject, setCurrentProject] = createSignal<any>(null)
  const [sessions, setSessions] = createSignal<any[]>([])
  const [gwReady, setGwReady] = createSignal(false)

  onMount(async () => {
    const status = await window.api.mafw.gateway.info()
    if (status.state === "ready") {
      setGwReady(true)
      return
    }
    const unsub = window.api.mafw.gateway.onStateChange((s) => {
      if (s.state === "ready") {
        setGwReady(true)
        unsub()
      }
    })
  })

  createEffect(() => {
    if (!gwReady()) return
    window.api.mafw.projects.list().then(list => setProjects(list as any[])).catch(e => console.warn("[mafw]", e))
    window.api.mafw.projects.current().then((res: any) => {
      if (res) setCurrentProject(res)
    }).catch(e => console.warn("[mafw]", e))
  })

  createEffect(() => {
    if (!gwReady()) return
    const project = currentProject()
    const projectID = project ? (project.id || project.worktree) : undefined
    window.api.mafw.sessions.list(projectID).then((list: any) => {
      setSessions(Array.isArray(list) ? list : [])
    }).catch(e => { console.warn("[mafw] sessions.list error", e); setSessions([]) })
  })

  const projectName = createMemo(() => {
    const p = currentProject()
    return p ? (p.worktree?.split(/[/\\]/).pop() || p.id) : "No project"
  })

  return (
    <div class="mafw-rail">
      <div class="mafw-rail-section" onClick={() => setExpanded(!expanded)}>
        <Icon name="chevron-down" size="small" style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.12s" }} />
        <Icon name="folder" size="small" />
        <span>History</span>
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
                sessions().filter(Boolean).slice(0, 50).map(s => (
                  <div
                    class="mafw-rail-item-label mafw-rail-session"
                    classList={{ active: props.activeSessionId === s.id }}
                    onClick={() => props.onSelectSession(s.id)}
                  >
                    <TooltipV2 value={new Date(s.time?.created || Date.now()).toLocaleString()} openDelay={300}>
                      <span style={{ display: "flex", "align-items": "center", gap: 6, width: "100%" }}>
                        <span style={{ opacity: 0.5 }}>⋮</span>
                        <span class="mafw-rail-session-title">{s.title || s.id.slice(0, 12)}</span>
                        <span class="mafw-rail-session-time" style={{ "font-size": 10, opacity: 0.35, "margin-left": "auto" }}>
                          {s.time?.created ? new Date(s.time.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                        </span>
                      </span>
                    </TooltipV2>
                  </div>
                ))
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
                <div
                  class="mafw-rail-item-label mafw-rail-project-item"
                  classList={{ active: currentProject()?.worktree === p.worktree }}
                  onClick={async () => {
                    setCurrentProject(p)
                    try { await window.api.mafw.projects.setCurrent(p.worktree) } catch {}
                  }}
                >
                  <Icon name="folder" size="small" />
                  {p.worktree?.split(/[/\\]/).pop() || p.id}
                </div>
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
    </div>
  )
}
