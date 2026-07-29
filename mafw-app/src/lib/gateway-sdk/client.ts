import {
  GatewayClient as IGatewayClient, GatewayClientOptions,
  Session, Project, TextPart, Goal, GoalCreateInput,
  MemoryUnit, MemorySearchOptions, EnergyDistribution, Axiom,
  Approval, TriageItem, AutomationRule,
  MethodNotSupportedError,
} from './types'
import { SSEConnection } from './sse'

export class GatewayClient implements IGatewayClient {
  private baseUrl: string
  private _sse: SSEConnection

  constructor(opts?: GatewayClientOptions) {
    this.baseUrl = opts?.baseUrl || 'http://localhost:3000'
    this._sse = new SSEConnection()
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json()
  }

  // ── Session ──

  session = {
    create: async (opts: { directory?: string; metadata?: Record<string, unknown> }): Promise<Session> => {
      return this.request<Session>('/api/session', {
        method: 'POST',
        body: JSON.stringify(opts),
      })
    },

    promptAsync: async (opts: { sessionID: string; message: string }): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${opts.sessionID}/promptAsync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: opts.message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },

    prompt: async (opts: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: TextPart[] }> => {
      return this.request<{ parts: TextPart[] }>(`/api/session/${opts.path.id}/prompt`, {
        method: 'POST',
        body: JSON.stringify(opts.body),
      })
    },

    delete: async (opts: { sessionID: string } | { path: { id: string } }): Promise<void> => {
      const id = 'sessionID' in opts ? opts.sessionID : opts.path.id
      const res = await fetch(`${this.baseUrl}/api/session/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },

    list: async (): Promise<Session[]> => {
      const data = await this.request<{ sessions: Session[] }>('/api/sessions')
      return data.sessions || data as any || []
    },

    get: async (id: string): Promise<Session> => {
      return this.request<Session>(`/api/sessions/${id}`)
    },
  }

  // ── Project ──

  project = {
    list: async (): Promise<Project[]> => {
      const data = await this.request<{ projects: Project[] }>('/api/projects')
      return data.projects || []
    },

    current: async (): Promise<Project> => {
      const data = await this.request<{ projectDir: string }>('/health')
      return { id: data.projectDir || '.', worktree: data.projectDir || '.' }
    },

    setCurrent: async (path: string): Promise<void> => {
      await this.request('/register', {
        method: 'POST',
        body: JSON.stringify({ projectDir: path, mafwDir: path + '/.mafw' }),
      })
    },
  }

  // ── Event ──

  event = {
    subscribe: async (): Promise<{ on(event: string, cb: (data: any) => void): void }> => {
      this._sse.connect(this.baseUrl)
      return {
        on: (event: string, cb: (data: any) => void) => {
          if (event === 'data') {
            this._sse.on('*', cb)
          } else {
            this._sse.on(event, cb)
          }
        },
      }
    },
  }

  // ── Config (not supported) ──

  config = {
    get: async (_key: string): Promise<any> => { throw new MethodNotSupportedError('config.get') },
    set: async (_key: string, _value: any): Promise<void> => { throw new MethodNotSupportedError('config.set') },
  }

  // ── Goals ──

  goals = {
    list: async (): Promise<Goal[]> => {
      const data = await this.request<{ goals: Goal[] }>('/api/goals')
      return data.goals || []
    },

    get: async (id: string): Promise<Goal | null> => {
      try { return await this.request<Goal>(`/api/goals/${id}`) }
      catch { return null }
    },

    create: async (input: GoalCreateInput): Promise<{ goalId: string }> => {
      return this.request<{ goalId: string }>(`/api/work/${input.goalId}/validate`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },
  }

  // ── Memory ──

  memory = {
    search: async (opts: MemorySearchOptions): Promise<MemoryUnit[]> => {
      const params = new URLSearchParams({ query: opts.query })
      if (opts.topK) params.set('topK', String(opts.topK))
      if (opts.goalId) params.set('goalId', opts.goalId)
      const data = await this.request<{ results: MemoryUnit[] }>(`/api/memory/search?${params}`)
      return data.results || []
    },

    getEnergyDistribution: async (): Promise<EnergyDistribution> => {
      return this.request<EnergyDistribution>('/api/memory/energy-distribution')
    },

    getL5Axioms: async (topK?: number): Promise<Axiom[]> => {
      const params = topK ? `?topK=${topK}` : ''
      const data = await this.request<{ axioms: Axiom[] }>(`/api/l5/axioms${params}`)
      return data.axioms || []
    },
  }

  // ── Approvals ──

  approvals = {
    list: async (): Promise<Approval[]> => {
      const data = await this.request<{ approvals: Approval[] }>('/api/approvals')
      return data.approvals || []
    },

    respond: async (id: string, decision: 'approve' | 'reject'): Promise<void> => {
      await this.request(`/api/approvals/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
    },
  }

  // ── Triage ──

  triage = {
    list: async (): Promise<TriageItem[]> => {
      const data = await this.request<{ items: TriageItem[] }>('/api/triage')
      return data.items || []
    },
  }

  // ── Automations ──

  automations = {
    list: async (): Promise<AutomationRule[]> => {
      const data = await this.request<{ rules: AutomationRule[] }>('/api/automations')
      return data.rules || []
    },

    toggle: async (id: string, enabled: boolean): Promise<void> => {
      await this.request(`/api/automations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
    },
  }
}
