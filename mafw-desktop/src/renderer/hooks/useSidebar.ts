import { createSignal, createEffect, onCleanup } from 'solid-js'
import { useGateway } from '../gateway/provider'
import type { Project, Session } from '../gateway/types'

export function useSidebar() {
  const gw = useGateway()
  const [projects, setProjects] = createSignal<Project[]>([])
  const [currentProject, setCurrentProject] = createSignal<Project | null>(null)
  const [sessions, setSessions] = createSignal<Session[]>([])

  let fetching = false

  const fetchProjects = async () => {
    if (!gw.ready()) return
    try {
      const list = await gw.client().listProjects()
      setProjects(list)
      const cur = await gw.client().getCurrentProject()
      setCurrentProject(cur)
    } catch {}
  }

  const fetchSessions = async (projectID?: string) => {
    if (!gw.ready()) return
    try {
      const list = await gw.client().listSessions(projectID)
      setSessions(list)
    } catch {}
  }

  createEffect(() => {
    if (!gw.ready() || fetching) return
    fetching = true
    fetchProjects()
  })

  createEffect(() => {
    const pid = currentProject()?.id
    if (pid) fetchSessions(pid)
    else fetchSessions()
  })

  const selectProject = async (project: Project) => {
    setCurrentProject(project)
    try {
      await gw.client().registerProject(project.worktree)
    } catch {}
    fetchSessions(project.id)
  }

  return { projects, currentProject, sessions, selectProject }
}
