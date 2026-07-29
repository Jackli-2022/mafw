import { SSEConnection } from './sse'
import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemoryFact, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, Approval, TriageItem, AutomationRule,
  ChatResult,
} from '../types'

export class MafwClient {
  baseUrl: string
  private _sse: SSEConnection

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:3000'
    this._sse = new SSEConnection()
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json() as Promise<T>
  }

  private async requestRaw(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
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
      await this.requestRaw(`/api/session/${opts.sessionID}/promptAsync`, {
        method: 'POST',
        body: JSON.stringify({ message: opts.message }),
      })
    },

    prompt: async (opts: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: any[] }> => {
      return this.request<{ parts: any[] }>(`/api/session/${opts.path.id}/prompt`, {
        method: 'POST',
        body: JSON.stringify(opts.body),
      })
    },

    delete: async (opts: { sessionID: string } | { path: { id: string } }): Promise<void> => {
      const id = 'sessionID' in opts ? opts.sessionID : opts.path.id
      await this.requestRaw(`/api/session/${id}`, { method: 'DELETE' })
    },

    list: async (projectID?: string): Promise<Session[]> => {
      const query = projectID ? `?projectID=${encodeURIComponent(projectID)}` : ''
      const data = await this.request<{ sessions: Session[] }>(`/api/sessions${query}`)
      return Array.isArray(data.sessions) ? data.sessions : []
    },

    get: async (id: string): Promise<Session | null> => {
      try {
        return await this.request<Session>(`/api/sessions/${id}`)
      } catch {
        return null
      }
    },

    messages: async (sessionID: string, limit?: number, before?: string): Promise<any> => {
      const params = new URLSearchParams()
      if (limit) params.set('limit', String(limit))
      if (before) params.set('before', before)
      return this.request<any>(`/api/sessions/${sessionID}/messages?${params}`)
    },
  }

  // ── Project ──

  project = {
    list: async (): Promise<Project[]> => {
      const data = await this.request<{ projects: Project[] }>('/api/projects')
      return data.projects || []
    },

    current: async (): Promise<Project | null> => {
      const data = await this.request<{ project: Project } | null>('/api/projects/current')
      return data?.project || null
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

  // ── Config ──

  config = {
    get: async (key?: string): Promise<any> => {
      const data = await this.request<any>('/api/config')
      return key ? data[key] : data
    },

    set: async (key: string, value: any): Promise<void> => {
      const current = await this.request<any>('/api/config')
      current[key] = value
      await this.requestRaw('/api/config', {
        method: 'PUT',
        body: JSON.stringify(current),
      })
    },
  }

  // ── Chat ──

  chat = {
    send: async (message: string): Promise<ChatResult> => {
      const res = await this.requestRaw('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      })
      return res.json() as Promise<ChatResult>
    },

    sendEnriched: async (message: string): Promise<ChatResult> => {
      const res = await this.requestRaw('/api/chat/enriched', {
        method: 'POST',
        body: JSON.stringify({ message }),
      })
      return res.json() as Promise<ChatResult>
    },
  }

  // ── Goals ──

  goals = {
    list: async (): Promise<Goal[]> => {
      const data = await this.request<{ goals: Goal[] }>('/api/goals')
      return data.goals || []
    },

    get: async (id: string): Promise<Goal | null> => {
      try {
        return await this.request<Goal>(`/api/goals/${id}`)
      } catch {
        return null
      }
    },

    create: async (input: GoalCreateInput): Promise<{ goalId: string }> => {
      return this.request<{ goalId: string }>(`/api/work/${input.goalId}/validate`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    control: async (action: GoalControlAction): Promise<void> => {
      await this.request('/control', {
        method: 'POST',
        body: JSON.stringify(action),
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

    mergedSearch: async (opts: MergedSearchOptions): Promise<MemoryFact[]> => {
      const params = new URLSearchParams({ query: opts.query })
      if (opts.maxFacts) params.set('maxFacts', String(opts.maxFacts))
      const data = await this.request<{ results: MemoryFact[] }>(`/api/memory/merged-search?${params}`)
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

    delete: async (id: string): Promise<void> => {
      await this.requestRaw(`/api/memory/${id}`, { method: 'DELETE' })
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

    dismiss: async (id: string): Promise<void> => {
      await this.request(`/api/triage/${id}/dismiss`, { method: 'POST' })
    },

    confirm: async (id: string): Promise<void> => {
      await this.request(`/api/triage/${id}/confirm`, { method: 'POST' })
    },

    reject: async (id: string): Promise<void> => {
      await this.request(`/api/triage/${id}/reject`, { method: 'POST' })
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
