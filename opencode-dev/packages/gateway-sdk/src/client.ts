import { randomUUID } from 'crypto'
import {
  MafwClient as IMafwClient, MafwClientOptions,
  Session, Project, TextPart, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions, MemoryFact, EnergyDistribution, Axiom, L5Heuristic,
  CommandInfo, SkillInfo, MafwCommandResult, ManagerSessionInfo, ManagerRotateResult,
  Approval, TriageItem, AutomationRule, SessionMessagePart, Todo,
  QuestionRequest, PermissionRequest, MediaPluginState,
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
    // Old gateways serve dashboard HTML for unknown routes (SPA fallback).
    // Surface a clean, actionable error instead of a JSON parse SyntaxError.
    const ct = (res.headers as any)?.get?.('content-type') ?? ''
    if (ct.includes('text/html')) {
      throw new Error(`Received HTML instead of JSON from ${path} — gateway is older than the SDK (route missing). Update/restart the gateway.`)
    }
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
      // True delete: /api/sessions/:id forwards to serve's native DELETE
      // (the legacy /api/session/:id path is an SPA fallback, not a real route).
      await this.request(`/api/sessions/${params.path.id}`, { method: 'DELETE' })
    },

    rename: async (params: { path: { id: string }; body: { title: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: params.body.title }),
      })
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

    children: async (params: { path: { id: string } }): Promise<any[]> => {
      const data = await this.request<{ items: any[] }>(`/api/sessions/${params.path.id}/children`)
      return data.items || []
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
      params: {
        path: { id: string }
        body: { message?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string } }
      },
    ): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${params.path.id}/promptAsync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: params.body.message,
          parts: params.body.parts,
          agent: params.body.agent,
          model: params.body.model,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },

    trajectory: async (
      params: { path: { id: string }; query?: { limit?: number; before_turn?: number; rebuild?: boolean } },
    ): Promise<{ turns: any[]; events: any[] }> => {
      const q = new URLSearchParams()
      if (params.query?.limit) q.set('limit', String(params.query.limit))
      if (params.query?.before_turn) q.set('before_turn', String(params.query.before_turn))
      if (params.query?.rebuild) q.set('rebuild', '1')
      return this.request<{ turns: any[]; events: any[] }>(`/api/sessions/${params.path.id}/trajectory?${q}`)
    },

    tokenSummary: async (
      params: { path: { id: string } },
    ): Promise<{
      totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
      totalCost: number;
      turnCount: number;
      avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
    }> => {
      return this.request(`/api/sessions/${params.path.id}/token-summary`)
    },

    usageSummary: async (
      params: { query?: { sessionID?: string; projectID?: string } },
    ): Promise<{
      session: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } | null;
      project: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null;
      global: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null;
    }> => {
      const q = new URLSearchParams()
      if (params.query?.sessionID) q.set('sessionID', params.query.sessionID)
      if (params.query?.projectID) q.set('projectID', params.query.projectID)
      return this.request(`/api/usage/summary?${q}`)
    },

    usage: async (
      params?: { sessionID?: string; projectID?: string },
    ): Promise<any> => {
      const q = new URLSearchParams()
      if (params?.sessionID) q.set('sessionID', params.sessionID)
      if (params?.projectID) q.set('projectID', params.projectID)
      const qs = q.toString()
      return this.request(`/api/usage${qs ? '?' + qs : ''}`)
    },

    usagePlugins: async (): Promise<{ plugins: { file: string; name?: string; status: string; error?: string; overridden: boolean }[] }> => {
      return this.request('/api/usage/plugins')
    },

    usagePluginsReload: async (): Promise<{ ok: boolean; plugins: any[] }> => {
      return this.request('/api/usage/plugins/reload', { method: 'POST' })
    },

    usagePluginsCreate: async (body: { template?: string; values?: Record<string, any>; name?: string; source?: string }): Promise<{ ok: boolean; name?: string; error?: string; plugins?: any[] }> => {
      return this.request('/api/usage/plugins/create', { method: 'POST', body: JSON.stringify(body) })
    },

    usagePluginSource: async (name: string): Promise<{ source?: string; origin?: string; builtin?: boolean; error?: string }> => {
      return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/source`)
    },

    usagePluginSourceSave: async (name: string, source: string): Promise<{ ok: boolean; error?: string }> => {
      return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/source`, { method: 'PUT', body: JSON.stringify({ source }) })
    },

    usagePluginDelete: async (name: string): Promise<{ ok: boolean; error?: string }> => {
      return this.request(`/api/usage/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' })
    },

    usagePluginTest: async (name: string): Promise<{ ok: boolean; result?: any; error?: string }> => {
      return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/test`, { method: 'POST' })
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

    command: async (
      params: { path: { id: string }; body: { command: string; arguments?: string; agent?: string; model?: { providerID: string; modelID: string } } },
    ): Promise<void> => {
      const res = await fetch(`${this.baseUrl}/api/session/${params.path.id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },
  }

  // ── Commands & skills (opencode serve, proxied by the gateway) ──

  command = {
    list: async (directory?: string): Promise<CommandInfo[]> => {
      const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
      const data = await this.request<CommandInfo[] | { items?: CommandInfo[]; commands?: CommandInfo[] }>(`/command${query}`)
      if (Array.isArray(data)) return data
      return (data as any).items || (data as any).commands || []
    },
  }

  skill = {
    list: async (directory?: string): Promise<SkillInfo[]> => {
      const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
      const data = await this.request<SkillInfo[] | { items?: SkillInfo[]; skills?: SkillInfo[] }>(`/skill${query}`)
      if (Array.isArray(data)) return data
      return (data as any).items || (data as any).skills || []
    },
  }

  // ── MAFW native commands (desktop slash panel) ──

  mafwCommands = {
    run: async (params: { command: string; args?: string; sessionID?: string }): Promise<MafwCommandResult> => {
      return this.request<MafwCommandResult>('/api/mafw-commands/run', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  }

  // ── Manager session (authoritative per-project manager, from gateway DB) ──

  manager = {
    session: async (projectDir?: string): Promise<ManagerSessionInfo | null> => {
      const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
      try {
        return await this.request<ManagerSessionInfo>(`/api/manager/session${q}`)
      } catch {
        return null
      }
    },
    rotate: async (projectDir: string, reason?: string): Promise<ManagerRotateResult> => {
      return await this.request<ManagerRotateResult>('/api/manager/session/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, reason }),
      })
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

  // ── Runtime ──

  runtime = {
    /** Get active runtime identity, capabilities, and plugin scan state. */
    get: async (): Promise<{
      active: { name: string; capabilities: Record<string, boolean>; envOverride?: boolean };
      plugins: { file: string; name?: string; status: string; error?: string; capabilities?: Record<string, boolean> }[];
    }> => {
      return this.request('/api/runtime')
    },

    /**
     * Switch active runtime plugin.
     * @param plugin - Plugin name (empty string switches to builtin opencode).
     * @returns The new active runtime state.
     */
    switch: async (plugin: string): Promise<{
      success: boolean;
      active: { name: string; capabilities: Record<string, boolean> };
      envOverride: boolean;
    }> => {
      const res = await fetch(`${this.baseUrl}/api/runtime/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Runtime switch failed: ${res.status}`)
      }
      return res.json()
    },

    /** Restart the agent runtime (opencode serve). */
    restartAgent: async (): Promise<{ success: boolean; mode: string }> => {
      const res = await fetch(`${this.baseUrl}/api/runtime/restart-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Agent restart failed: ${res.status}`)
      }
      return res.json()
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

  // ── OpenCode config (native opencode /config) ──

  opencodeConfig = {
    get: async (): Promise<any> => {
      const data = await this.request<{ config: any }>('/api/opencode-config')
      return data.config
    },

    update: async (config: Record<string, unknown>): Promise<any> => {
      const res = await fetch(`${this.baseUrl}/api/opencode-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`OpenCodeConfig update failed: ${res.status}`)
      return res.json()
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

    getL5Axioms: async (topK?: number): Promise<{ axioms: Axiom[]; heuristics: L5Heuristic[] }> => {
      const params = topK ? `?topK=${topK}` : ''
      const data = await this.request<{ axioms: Axiom[]; heuristics: L5Heuristic[] }>(`/api/l5/axioms${params}`)
      return { axioms: data.axioms || [], heuristics: data.heuristics || [] }
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

    sendEnriched: async (
      opts: {
        message: string
        sessionID?: string
        parts?: Record<string, unknown>[]
        agent?: string
        model?: { providerID: string; modelID: string }
      },
    ): Promise<{ sessionID: string }> => {
      const res = await fetch(`${this.baseUrl}/api/chat/enriched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) throw new Error(`Chat sendEnriched failed: ${res.status}`)
      return res.json()
    },
  }

  // ── Media (A2A Media Agent) ──

  media = {
    /** List media engine plugins (status + modalities). */
    plugins: async (): Promise<{
      plugins: MediaPluginState[]
    }> => {
      return this.request('/api/media/plugins')
    },
    /**
     * Switch media engine per modality.
     * @param opts - Engine overrides (top-level engine and/or per-modality).
     * @returns The new media engine configuration.
     */
    switch: async (opts: {
      engine?: string
      image?: { engine?: string }
      video?: { engine?: string }
      audio?: { engine?: string }
    }): Promise<{
      success: boolean
      media: {
        engine?: string
        image?: { engine?: string; model?: string }
        video?: { engine?: string; model?: string }
        audio?: { engine?: string; model?: string }
      }
    }> => {
      const res = await fetch(`${this.baseUrl}/api/media/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Media switch failed: ${res.status}`)
      }
      return res.json()
    },

    createTask: async (opts: {
      dataUrl?: string
      artifactId?: string
      mediaType?: string
      question?: string
    }): Promise<{ id: string; contextId: string; state: string }> => {
      // Prefer the artifact reference path (media bytes uploaded separately
      // via /api/media/upload) — the message carries only a URL part, so the
      // JSON body stays tiny. Falls back to the raw base64 part for legacy
      // callers that only have a data URL.
      const parts: any[] = opts.artifactId
        ? [{ url: `/a2a/artifacts/${opts.artifactId}`, mediaType: opts.mediaType || 'application/octet-stream', filename: 'upload.bin' }]
        : [{ raw: opts.dataUrl?.split(',')[1] || '', mediaType: opts.mediaType || 'image/png', filename: 'paste.bin' }]
      if (opts.question) parts.push({ text: opts.question })
      const res = await fetch(`${this.baseUrl}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: {
            message: {
              messageId: `fe-${randomUUID()}`,
              role: 1, // ROLE_USER
              parts,
            },
          },
        }),
      })
      if (!res.ok) throw new Error(`Vision createTask failed: HTTP ${res.status}`)
      const parsed: any = await res.json()
      if (parsed?.error) throw new Error(`Vision createTask failed: ${parsed.error?.message || JSON.stringify(parsed.error)}`)
      const task = parsed?.result?.task
      if (!task?.id) throw new Error('Vision createTask failed: no task returned')
      return { id: task.id, contextId: task.contextId, state: task.status?.state || '' }
    },
  }

  // ── TTS (MiMo-V2.5-TTS speech synthesis) ──

  tts = {
    speak: async (opts: { text: string; voice?: string; style?: string }): Promise<{
      artifactId: string
      voice: string
      mime: string
      url: string
    }> => {
      const res = await fetch(`${this.baseUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) {
        let detail = ''
        try { const j: any = await res.json(); detail = j?.error || '' } catch { /* ignore */ }
        throw new Error(`TTS failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`)
      }
      return res.json()
    },

    voices: async (): Promise<{
      voices: { id: string; label: string; lang: string }[]
      models: { id: string; description: string }[]
      defaultVoice: string
      defaultModel: string
    }> => {
      const res = await fetch(`${this.baseUrl}/api/tts/voices`)
      if (!res.ok) throw new Error(`TTS voices failed: HTTP ${res.status}`)
      return res.json()
    },

    /** 流式 TTS：返回 async iterable of base64 PCM16 chunks（24kHz mono）。 */
    speakStream: (opts: { text: string; voice?: string; style?: string }): AsyncGenerator<{ data: string; voice: string }> => {
      const base = this.baseUrl
      return (async function* () {
        const res = await fetch(`${base}/api/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok || !res.body) throw new Error(`TTS stream failed: HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            try {
              const j = JSON.parse(t.slice(5).trim())
              if (j.data) yield { data: j.data, voice: j.voice || '' }
              if (j.done) return
            } catch { /* ignore */ }
          }
        }
      } finally {
        reader.releaseLock()
      }
      })()
    },
  }

  // ── Providers & Agents (composer model pill / @agent mention) ──

  providers = {
    list: async (): Promise<{ all: Record<string, any>[]; default?: Record<string, string>; connected?: string[] } | null> => {
      const data = await this.request<{ items: any }>('/api/provider')
      return data.items
    },
  }

  agents = {
    list: async (): Promise<any[]> => {
      const data = await this.request<{ items: any[] }>('/api/agents')
      return data.items || []
    },
  }

  // ── Model config (recall worker + media models) ──

  models = {
    get: async (): Promise<import('./types').ModelConfigState> => {
      return this.request<import('./types').ModelConfigState>('/api/model-config')
    },

    update: async (opts: import('./types').ModelConfigUpdate): Promise<{ success: boolean; recall: import('./types').ModelConfigState['recall']; media: import('./types').ModelConfigState['media'] }> => {
      const res = await fetch(`${this.baseUrl}/api/model-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Model config update failed: ${res.status}`)
      }
      return res.json()
    },
  }

  // ── Memory embedding config (hot-swap engine, no restart) ──

  embedding = {
    get: async (): Promise<import('./types').EmbeddingConfigGetResponse> => {
      return this.request<import('./types').EmbeddingConfigGetResponse>('/api/memory/embedding-config')
    },

    update: async (opts: import('./types').EmbeddingConfigUpdate): Promise<{ success: boolean; current: import('./types').EmbeddingConfigState; runtime: import('./types').EmbeddingRuntimeState; note?: string }> => {
      const res = await fetch(`${this.baseUrl}/api/memory/embedding-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Embedding config update failed: ${res.status}`)
      }
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
