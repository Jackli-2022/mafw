export interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  time: { created: number; updated: number }
}

export interface Project {
  id: string
  worktree: string
}

export class MethodNotSupportedError extends Error {
  constructor(method: string) { super(`Method not supported: ${method}`); this.name = 'MethodNotSupportedError' }
}

export interface Goal {
  goalId: string
  phase: string
  loop: number
  currentWave: number
  totalWaves: number
  nextAction?: string
  updatedAt?: string
}

export interface MemoryUnit {
  id: string
  type: 'semantic' | 'episodic' | 'procedural' | 'global'
  primary_abstraction: string
  cue_anchors: string[]
  memory_value: string
  energy: number
}

export interface AutomationRule {
  id: string
  enabled: boolean
  trigger?: { schedule: string; timezone: string }
  action?: { type: string }
  skill?: string
}

export class GatewayClient {
  baseUrl: string
  private globalSSE: EventSource | null = null
  private globalListeners: Set<(data: any) => void> = new Set()

  constructor(opts?: { baseUrl?: string }) {
    this.baseUrl = opts?.baseUrl || 'http://localhost:3000'
  }

  // ── Session ──
  session = {
    create: async (opts: { directory?: string }): Promise<{ id: string }> => {
      return this.request<{ id: string }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({ directory: opts.directory }),
      })
    },

    promptAsync: async (opts: { sessionID: string; message: string }): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${opts.sessionID}/promptAsync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: opts.message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },

    delete: async (opts: { sessionID: string }): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${opts.sessionID}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },

    list: async (): Promise<Session[]> => {
      const data = await this.request<{ sessions: Session[] }>('/api/sessions')
      return data.sessions || []
    },

    get: async (id: string): Promise<Session> => {
      return this.request<Session>(`/api/sessions/${id}`)
    },
  }

  // ── Event ──
  event = {
    subscribe: async (): Promise<{ on(event: string, cb: (data: any) => void): void }> => {
      if (!this.globalSSE) {
        this.globalSSE = new EventSource(`${this.baseUrl}/api/events`)
        this.globalSSE.onmessage = (e) => {
          try { const data = JSON.parse(e.data); for (const cb of this.globalListeners) cb(data) } catch {}
        }
      }
      return {
        on: (event: string, cb: (data: any) => void) => {
          const handler = (data: any) => { if (!event || data.type === event) cb(data) }
          this.globalListeners.add(handler)
        },
      }
    },
  }

  // ── Project ──
  project = {
    list: async (): Promise<Project[]> => {
      const data = await this.request<{ projects: Project[] }>('/api/projects')
      return data.projects || []
    },

    getCurrent: async (): Promise<Project> => {
      const data = await this.request<{ projectDir: string }>('/health')
      return { id: data.projectDir || 'default', worktree: data.projectDir || '.' }
    },

    setCurrent: async (path: string): Promise<void> => {
      await this.request(`/register`, {
        method: 'POST',
        body: JSON.stringify({ projectDir: path, mafwDir: path + '/.mafw' }),
      })
    },
  }

  // ── Config (not supported) ──
  config = {
    get: async (_key: string): Promise<any> => { throw new MethodNotSupportedError('config.get') },
    set: async (_key: string, _value: any): Promise<void> => { throw new MethodNotSupportedError('config.set') },
  }

  // ── MAFW-specific extensions ──

  async getGoals(): Promise<Goal[]> {
    const data = await this.request<{ goals: Goal[] }>('/api/goals')
    return data.goals || []
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/config')
  }

  async saveConfig(config: Record<string, unknown>): Promise<void> {
    await fetch(`${this.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  async getGoalDetail(goalId: string): Promise<Goal | null> {
    try { return await this.request<Goal>(`/api/goals/${goalId}`) }
    catch { return null }
  }

  async searchMemory(query: string): Promise<MemoryUnit[]> {
    const data = await this.request<{ results: MemoryUnit[] }>(`/api/memory/search?q=${encodeURIComponent(query)}`)
    return data.results || []
  }

  async getAutomations(): Promise<AutomationRule[]> {
    const data = await this.request<{ rules: AutomationRule[] }>('/api/automations')
    return data.rules || []
  }

  async getApprovals(): Promise<any[]> {
    const data = await this.request<{ approvals: any[] }>('/api/approvals')
    return data.approvals || []
  }

  async respondApproval(id: string, decision: 'approve' | 'reject'): Promise<void> {
    await this.request(`/api/approvals/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json()
  }
}
