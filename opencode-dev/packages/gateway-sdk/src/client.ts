import {
  MafwClient as IMafwClient, MafwClientOptions,
  Session, Project, TextPart, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions, MemoryFact, EnergyDistribution, Axiom,
  Approval, TriageItem, AutomationRule, SessionMessagePart, Todo,
  MethodNotSupportedError,
} from './types'
import { SSEConnection } from './sse'

export class MafwClient implements IMafwClient {
  private baseUrl: string
  private _sse: SSEConnection

  constructor(opts?: string | MafwClientOptions) {
    this.baseUrl = typeof opts === 'string'
      ? opts
      : opts?.baseUrl || 'http://localhost:3000'
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
    create: async (
      params?: { directory?: string; metadata?: Record<string, unknown> },
    ): Promise<Session> => {
      return this.request<Session>('/api/session', {
        method: 'POST',
        body: JSON.stringify(params || {}),
      })
    },

    get: async (params: { path: { id: string } }): Promise<Session> => {
      return this.request<Session>(`/api/sessions/${params.path.id}`)
    },

    list: async (
      params?: { query?: { projectID?: string } },
    ): Promise<Session[]> => {
      const pid = params?.query?.projectID
      const query = pid ? `?projectID=${encodeURIComponent(pid)}` : ''
      const data = await this.request<{ sessions: Session[] }>(`/api/sessions${query}`)
      if (!data || !Array.isArray(data.sessions)) return []
      return data.sessions
    },

    delete: async (params: { path: { id: string } }): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${params.path.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },

    messages: async (
      params: { path: { id: string }; query?: { limit?: number; before?: string } },
    ): Promise<{ data: SessionMessagePart[]; nextCursor: string | null }> => {
      const q = new URLSearchParams()
      if (params.query?.limit) q.set('limit', String(params.query.limit))
      if (params.query?.before) q.set('before', params.query.before)
      return this.request<{ data: SessionMessagePart[]; nextCursor: string | null }>(`/api/sessions/${params.path.id}/messages?${q}`)
    },

    todo: async (params: { path: { id: string } }): Promise<{ data: Todo[] }> => {
      return this.request<{ data: Todo[] }>(`/api/sessions/${params.path.id}/todo`)
    },

    abort: async (params: { path: { id: string } }): Promise<void> => {
      await this.request(`/api/session/${params.path.id}/abort`, { method: 'POST' })
    },

    prompt: async (
      params: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } },
    ): Promise<{ parts: TextPart[] }> => {
      return this.request<{ parts: TextPart[] }>(`/api/session/${params.path.id}/prompt`, {
        method: 'POST',
        body: JSON.stringify(params.body),
      })
    },

    promptAsync: async (
      params: { path: { id: string }; body: { message: string } },
    ): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${params.path.id}/promptAsync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: params.body.message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },

    events: async (
      params: { path: { id: string } },
    ): Promise<{ on(event: string, cb: (data: any) => void): void }> => {
      const sse = new SSEConnection()
      sse.connectToSession(this.baseUrl, params.path.id)
      return {
        on: (event: string, cb: (data: any) => void) => {
          if (event === 'data') {
            sse.on('*', cb)
          } else {
            sse.on(event, cb)
          }
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

    current: async (): Promise<Project> => {
      const data = await this.request<{ project: Project } | { projectDir: string }>('/api/projects/current')
      if ((data as any).project) return (data as any).project
      return { id: (data as any).projectDir || '.', worktree: (data as any).projectDir || '.' }
    },

    setCurrent: async (path: string): Promise<void> => {
      await this.request('/api/projects/register', {
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

    subscribeToSession: async (
      sessionID: string,
    ): Promise<{ on(event: string, cb: (data: any) => void): void }> => {
      this._sse.connectToSession(this.baseUrl, sessionID)
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
      // NOTE: read-then-write pattern — concurrent set() calls will race.
      // The backend should support PATCH for individual keys to avoid lost updates.
      const current = await this.request<any>('/api/config')
      current[key] = value
      await fetch(`${this.baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      })
    },
  }

  // ── Goals ──

  goals = {
    list: async (): Promise<Goal[]> => {
      const data = await this.request<{ goals: Goal[] }>('/api/goals')
      return data.goals || []
    },

    get: async (id: string): Promise<Goal | null> => {
      try { return await this.request<Goal>(`/api/goals/${id}`) }
      catch (e: any) {
        if (e.message?.includes('HTTP 404')) return null
        throw e
      }
    },

    validate: async (input: GoalCreateInput): Promise<{ goalId: string }> => {
      return this.request<{ goalId: string }>(`/api/work/${input.goalId}/validate`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    control: async (action: GoalControlAction): Promise<void> => {
      await this.request('/api/goals/control', {
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
      await this.request(`/api/memory/${id}`, { method: 'DELETE' })
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

  // ── Questions (AskCard — proxies the native opencode Question API) ──

  questions = {
    list: async (): Promise<QuestionRequest[]> => {
      const data = await this.request<{ items: QuestionRequest[] }>('/api/questions')
      return data.items || []
    },

    reply: async (id: string, answers: string[][]): Promise<void> => {
      await this.request(`/api/questions/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      })
    },

    reject: async (id: string): Promise<void> => {
      await this.request(`/api/questions/${id}/reject`, { method: 'POST' })
    },
  }

  // ── Permissions (PermissionCard — proxies the native opencode Permission API) ──

  permissions = {
    list: async (): Promise<PermissionRequest[]> => {
      const data = await this.request<{ items: PermissionRequest[] }>('/api/permissions')
      return data.items || []
    },

    reply: async (
      id: string,
      reply: 'once' | 'always' | 'reject',
      message?: string,
    ): Promise<void> => {
      await this.request(`/api/permissions/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply, message }),
      })
    },
  }

  // ── Chat ──

  chat = {
    send: async (message: string, sessionID?: string): Promise<{ sessionID: string }> => {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionID }),
      })
      if (!res.ok) throw new Error(`Chat send failed: ${res.status}`)
      return res.json()
    },

    sendEnriched: async (message: string, sessionID?: string): Promise<{ sessionID: string }> => {
      const res = await fetch(`${this.baseUrl}/api/chat/enriched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionID }),
      })
      if (!res.ok) throw new Error(`Chat sendEnriched failed: ${res.status}`)
      return res.json()
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
