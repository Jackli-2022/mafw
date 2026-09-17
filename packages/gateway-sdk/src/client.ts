import { randomUUID } from 'crypto'
import {
  MafwClient as IMafwClient, MafwClientOptions,
  Session, Project, TextPart, Goal, GoalCreateInput, GoalControlAction, GoalSessionInfo,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions, MemoryFact, EnergyDistribution, Axiom, L5Heuristic,
  StickyNote, StickyNoteBudget, ModelUsageWindows,
  CommandInfo, SkillInfo, MafwCommandResult, ManagerSessionInfo, ManagerRotateResult,
  Approval, TriageItem, AutomationRule, SessionMessagePart, Todo,
  QuestionRequest, PermissionRequest, MediaPluginState,
  MethodNotSupportedError,
} from './types'
import { SSEConnection } from './sse'
import type { ApiPath } from './api-path'

export class MafwClient implements IMafwClient {
  private baseUrl: string
  private _sse: SSEConnection
  private fetchImpl: typeof fetch

  constructor(opts?: string | MafwClientOptions) {
    this.baseUrl = typeof opts === 'string'
      ? opts
      : opts?.baseUrl || 'http://localhost:3000'
    this.fetchImpl = (typeof opts === 'object' && opts?.fetchImpl) ? opts.fetchImpl : fetch.bind(globalThis)
    this._sse = new SSEConnection()
  }

  private async request<T>(path: ApiPath, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
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

  /**
   * 裸 fetch 的编译期约束入口：与 request 同一 ApiPath 契约，但返回原始 Response，
   * 供 SSE 流/二进制体/自定义错误处理的调用方使用（P3 收编，fetch 直调仅剩此出口）。
   */
  private fetchPath(path: ApiPath, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, init)
  }

  // 鈹€鈹€ Session 鈹€鈹€

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

    fork: async (params: { path: { id: string }; body?: { messageID?: string } }): Promise<{ session: Session }> => {
      return this.request<{ session: Session }>(`/api/sessions/${params.path.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body ?? {}),
      })
    },

    revert: async (params: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body),
      })
    },

    unrevert: async (params: { path: { id: string } }): Promise<void> => {
      await this.request(`/api/sessions/${params.path.id}/unrevert`, { method: 'POST' })
    },

    summarize: async (
      params: { path: { id: string }; body?: { providerID?: string; modelID?: string } },
    ): Promise<void> => {
      await this.request(`/api/session/${params.path.id}/summarize`, {
        method: 'POST',
        body: JSON.stringify(params.body ?? {}),
      })
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
      const res = await this.fetchPath(`/api/session/${params.path.id}/promptAsync`, {
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
    ): Promise<{
      summary: any
      memory: any
      providers: any[]
      modelStats?: { windows: ModelUsageWindows }
      updatedAt: number
    }> => {
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
      const res = await this.fetchPath(`/api/session/${params.path.id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    },
  }

  // 鈹€鈹€ Commands & skills (opencode serve, proxied by the gateway) 鈹€鈹€

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

  // 鈹€鈹€ MAFW native commands (desktop slash panel) 鈹€鈹€

  mafwCommands = {
    run: async (params: { command: string; args?: string; sessionID?: string }): Promise<MafwCommandResult> => {
      return this.request<MafwCommandResult>('/api/mafw-commands/run', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  }

  // 鈹€鈹€ Manager session (authoritative per-project manager, from gateway DB) 鈹€鈹€

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

  // 鈹€鈹€ Project 鈹€鈹€

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
      // Gateway's real register route is POST /register (index.ts) 鈥?it persists the
      // registry and broadcasts project_registered. /api/projects/register does not
      // exist and would fall through to the opencode reverse proxy (502/SPA HTML).
      await this.request('/register', {
        method: 'POST',
        body: JSON.stringify({ projectDir: path, mafwDir: path + '/.mafw' }),
      })
    },
  }

  // 鈹€鈹€ Event 鈹€鈹€

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

    /** SSE 杩炴帴鐘舵€侊紙onopen/onerror 缁存姢锛涗緵鐩戠潱鍣ㄥ仴搴疯疆璇級銆?*/
    connected: (): boolean => this._sse.connected,

    /** SSE 绔偣 URL锛堝绾﹀綊 SDK锛歳enderer 鐩磋繛 EventSource 鏃剁敤姝ゆ瀯閫狅紝涓嶈嚜宸辨嫾瀛楃涓诧級銆?*/
    url: (sessionID?: string): string =>
      sessionID
        ? `${this.baseUrl}/api/events?sessionID=${encodeURIComponent(sessionID)}`
        : `${this.baseUrl}/api/events`,

    /** 鍙戝竷鑷畾涔変簨浠跺埌鍏ㄩ儴 UI 閫氶亾锛圫SE/WS/鎺ㄩ€侊級銆倀ype 寤鸿鍛藉悕绌洪棿
     *  'plugin:<name>:<event>'锛涙秷璐规柟瀵规湭鐭?type 蹇界暐锛圫SE 閫氱煡璇箟锛屾棤娉ㄥ唽鍒讹級銆?*/
    publish: async (event: { type: string; [key: string]: any }): Promise<{ ok: true }> =>
      this.request<{ ok: true }>("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
  }

  // 鈹€鈹€ Runtime 鈹€鈹€

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
      const res = await this.fetchPath(`/api/runtime/switch`, {
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
      const res = await this.fetchPath(`/api/runtime/restart-agent`, {
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

  // 鈹€鈹€ Plugins Hub 鈹€鈹€

  plugins = {
    list: async (): Promise<{
      plugins: { type: 'runtime' | 'media' | 'usage' | 'ui'; name: string; file: string; status: 'enabled' | 'disabled' | 'error' | 'config-disabled'; error?: string; size: number; mtime: string; builtin?: boolean; overridden?: boolean; pluginType?: string }[];
    }> => this.request('/api/plugins'),

    install: async (input: { filename: string; type?: 'runtime' | 'media' | 'usage' | 'ui'; bytes: Uint8Array; overwrite?: boolean }): Promise<any> => {
      const params = new URLSearchParams({ filename: input.filename });
      if (input.type) params.set('type', input.type);
      if (input.overwrite) params.set('overwrite', '1');
      const res = await this.fetchPath(`/api/plugins/install?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.bytes as unknown as BodyInit,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Plugin install failed: ${res.status}`)
      }
      return res.json()
    },

    enable: async (type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any> => {
      const res = await this.fetchPath(`/api/plugins/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, filename }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Plugin enable failed: ${res.status}`)
      }
      return res.json()
    },

    disable: async (type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any> => {
      const res = await this.fetchPath(`/api/plugins/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, filename }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Plugin disable failed: ${res.status}`)
      }
      return res.json()
    },

    delete: async (type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<{ ok: true }> => {
      const res = await this.fetchPath(`/api/plugins/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, filename }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Plugin delete failed: ${res.status}`)
      }
      return res.json()
    },
  }

  // 鈹€鈹€ Config 鈹€鈹€

  config = {
    get: async (key?: string): Promise<any> => {
      const data = await this.request<any>('/api/config')
      return key ? data[key] : data
    },
    set: async (key: string, value: any): Promise<void> => {
      // NOTE: read-then-write pattern 鈥?concurrent set() calls will race.
      // The backend should support PATCH for individual keys to avoid lost updates.
      const current = await this.request<any>('/api/config')
      current[key] = value
      await this.fetchPath(`/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      })
    },
  }

  // 鈹€鈹€ OpenCode config (native opencode /config) 鈹€鈹€

  opencodeConfig = {
    get: async (): Promise<any> => {
      const data = await this.request<{ config: any }>('/api/opencode-config')
      return data.config
    },

    update: async (config: Record<string, unknown>): Promise<any> => {
      const res = await this.fetchPath(`/api/opencode-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`OpenCodeConfig update failed: ${res.status}`)
      return res.json()
    },
  }

  // 鈹€鈹€ Goals 鈹€鈹€

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

    sessions: async (goalId: string): Promise<GoalSessionInfo[]> => {
      const data = await this.request<{ sessions: GoalSessionInfo[] }>(`/api/goals/${encodeURIComponent(goalId)}/sessions`)
      return data?.sessions ?? []
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

    respondQuestion: async (goalId: string, questionId: string, input: { type: 'answer' | 'cancel'; answer?: string }): Promise<{ status: string }> => {
      return this.request<{ status: string }>(
        `/api/goals/${encodeURIComponent(goalId)}/questions/${encodeURIComponent(questionId)}/respond`,
        { method: 'POST', body: JSON.stringify(input) },
      )
    },
  }

  // 鈹€鈹€ Memory 鈹€鈹€

  memory = {
    search: async (opts: MemorySearchOptions): Promise<MemoryUnit[]> => {
      const params = new URLSearchParams({ query: opts.query })
      if (opts.topK) params.set('topK', String(opts.topK))
      if (opts.goalId) params.set('goalId', opts.goalId)
      if (opts.retriever) params.set('retriever', opts.retriever)
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

    listSticky: async (): Promise<{ entries: StickyNote[]; budget: StickyNoteBudget }> => {
      const data = await this.request<{ entries: StickyNote[]; budget: StickyNoteBudget }>('/api/memory/sticky')
      return { entries: data.entries || [], budget: data.budget || { max: 10, maxChars: 800, used: 0 } }
    },

    setSticky: async (id: string, sticky: boolean, stickyDays?: number): Promise<void> => {
      await this.request('/api/memory/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, sticky, stickyDays }),
      })
    },
  }

  // 鈹€鈹€ Approvals 鈹€鈹€

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

  // 鈹€鈹€ Triage 鈹€鈹€

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

    propose: async (id: string, suggestion: 'confirm' | 'reject', reason: string, priority: 'high' | 'medium' | 'low' = 'medium'): Promise<{ success: boolean; message?: string }> => {
      return this.request(`/api/triage/${id}/propose`, {
        method: 'POST',
        body: JSON.stringify({ suggestion, reason, priority }),
      })
    },
  }

  // 鈹€鈹€ Questions (AskCard 鈥?proxies the native opencode Question API) 鈹€鈹€

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

  // 鈹€鈹€ Permissions (PermissionCard 鈥?proxies the native opencode Permission API) 鈹€鈹€

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

  // 鈹€鈹€ Chat 鈹€鈹€

  chat = {
    send: async (message: string, sessionID?: string): Promise<{ sessionID: string }> => {
      const res = await this.fetchPath(`/api/chat`, {
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
      const res = await this.fetchPath(`/api/chat/enriched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) throw new Error(`Chat sendEnriched failed: ${res.status}`)
      return res.json()
    },
  }

  // 鈹€鈹€ Media (A2A Media Agent) 鈹€鈹€

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
      const res = await this.fetchPath(`/api/media/switch`, {
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
      // via /api/media/upload) 鈥?the message carries only a URL part, so the
      // JSON body stays tiny. Falls back to the raw base64 part for legacy
      // callers that only have a data URL.
      const parts: any[] = opts.artifactId
        ? [{ url: `/a2a/artifacts/${opts.artifactId}`, mediaType: opts.mediaType || 'application/octet-stream', filename: 'upload.bin' }]
        : [{ raw: opts.dataUrl?.split(',')[1] || '', mediaType: opts.mediaType || 'image/png', filename: 'paste.bin' }]
      if (opts.question) parts.push({ text: opts.question })
      const res = await this.fetchPath(`/a2a`, {
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

    upload: async (input: { bytes: Uint8Array; mediaType: string }): Promise<{ artifactId: string }> => {
      const res = await this.fetchPath(`/api/media/upload?type=${encodeURIComponent(input.mediaType)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.bytes as unknown as BodyInit,
      })
      if (!res.ok) throw new Error(`濯掍綋涓婁紶澶辫触: HTTP ${res.status}`)
      const data: any = await res.json()
      if (!data?.artifactId) throw new Error('濯掍綋涓婁紶澶辫触: 鏃?artifactId')
      return { artifactId: data.artifactId }
    },

    uploadAndCreate: async (input: { bytes: Uint8Array; mediaType: string; question?: string }): Promise<{ id: string; contextId: string; state: string; artifactId?: string; mediaType?: string; size?: number }> => {
      const qs = new URLSearchParams({ type: input.mediaType })
      if (input.question) qs.set('question', input.question)
      const res = await this.fetchPath(`/api/media/upload-and-create?${qs.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.bytes as unknown as BodyInit,
      })
      if (!res.ok) throw new Error(`濯掍綋涓婁紶澶辫触: HTTP ${res.status}`)
      const data: any = await res.json()
      if (!data?.id) throw new Error('濯掍綋涓婁紶澶辫触: 鏃?task id')
      return { id: data.id, contextId: data.contextId, state: data.state, artifactId: data.artifactId, mediaType: data.mediaType, size: data.size }
    },

    artifactUrl: (id: string): string => `${this.baseUrl}/a2a/artifacts/${id}`,
  }

  // 鈹€鈹€ TTS (MiMo-V2.5-TTS speech synthesis) 鈹€鈹€

  tts = {
    speak: async (opts: { text: string; voice?: string; style?: string }): Promise<{
      artifactId: string
      voice: string
      mime: string
      url: string
    }> => {
      const res = await this.fetchPath(`/api/tts`, {
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
      const res = await this.fetchPath(`/api/tts/voices`)
      if (!res.ok) throw new Error(`TTS voices failed: HTTP ${res.status}`)
      return res.json()
    },

    /** barge-in 打断：取消该 session 全部在途 TTS 合成。 */
    interrupt: async (sessionId: string): Promise<{ ok: boolean; cancelled: number }> => {
      const res = await this.fetchPath(`/api/tts/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) throw new Error(`TTS interrupt failed: HTTP ${res.status}`)
      return res.json()
    },

    /** 娴佸紡 TTS锛氳繑鍥?async iterable of base64 PCM16 chunks锛?4kHz mono锛夈€?*/
    speakStream: (opts: { text: string; voice?: string; style?: string }): AsyncGenerator<{ data: string; voice: string }> => {
      const client = this
      return (async function* () {
        const res = await client.fetchPath(`/api/tts/stream`, {
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

    /** 娴佸紡 TTS 绔偣 URL锛堝绾﹀綊 SDK锛欼PC 鏃犳硶鍏嬮殕 SSE 娴侊紝renderer 鐩磋繛 fetch 鏃剁敤姝ゆ瀯閫狅級銆?*/
    streamUrl: (): string => `${this.baseUrl}/api/tts/stream`,
  }

  // 鈹€鈹€ Providers & Agents (composer model pill / @agent mention) 鈹€鈹€

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

  // 鈹€鈹€ Model config (recall worker + media models) 鈹€鈹€

  models = {
    get: async (): Promise<import('./types').ModelConfigState> => {
      return this.request<import('./types').ModelConfigState>('/api/model-config')
    },

    update: async (opts: import('./types').ModelConfigUpdate): Promise<{ success: boolean; recall: import('./types').ModelConfigState['recall']; media: import('./types').ModelConfigState['media'] }> => {
      const res = await this.fetchPath(`/api/model-config`, {
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

  // 鈹€鈹€ Memory embedding config (hot-swap engine, no restart) 鈹€鈹€

  embedding = {
    get: async (): Promise<import('./types').EmbeddingConfigGetResponse> => {
      return this.request<import('./types').EmbeddingConfigGetResponse>('/api/memory/embedding-config')
    },

    update: async (opts: import('./types').EmbeddingConfigUpdate): Promise<{ success: boolean; current: import('./types').EmbeddingConfigState; runtime: import('./types').EmbeddingRuntimeState; note?: string }> => {
      const res = await this.fetchPath(`/api/memory/embedding-config`, {
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

  // 鈹€鈹€ Automations 鈹€鈹€

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

    /** 璧疯崏瑙勫垯锛坋nabled=false 钀界洏锛岄渶鎵嬪姩鍚敤锛夈€傝繑鍥炴牎楠岀粨鏋溿€?*/
    draft: async (input: {
      id: string
      trigger: { schedule: string; timezone?: string }
      skill?: string
      action?: { type: 'triage' | 'goal'; template?: string; auto_confirm?: boolean }
      goal_defaults?: { maxLoops?: number }
    }): Promise<{ id: string; valid: boolean; errors?: string[] }> => {
      return this.request('/api/automations/draft', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },
  }
}
