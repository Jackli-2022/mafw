import { Goal, MemoryUnit, AutomationRule, GatewayConfig, Project, Session } from './types'

export class MafwClient {
  baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return res.json()
  }

  // ── Projects ──

  async listProjects(): Promise<Project[]> {
    const data = await this.request<{ projects: Project[] }>('/api/projects')
    return data.projects || []
  }

  async getCurrentProject(): Promise<Project | null> {
    const data = await this.request<{ project: Project } | null>('/api/projects/current')
    return data?.project || null
  }

  async registerProject(projectDir: string): Promise<void> {
    await this.request('/register', {
      method: 'POST',
      body: JSON.stringify({ projectDir, mafwDir: projectDir + '/.mafw' }),
    })
  }

  // ── Sessions ──

  async listSessions(projectID?: string): Promise<Session[]> {
    const query = projectID ? `?projectID=${encodeURIComponent(projectID)}` : ''
    const data = await this.request<{ sessions: Session[] }>(`/api/sessions${query}`)
    return data.sessions || []
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      return await this.request<Session>(`/api/sessions/${id}`)
    } catch {
      return null
    }
  }

  // ── Goals ──

  async getGoals(): Promise<Goal[]> {
    const data = await this.request<{ goals: Goal[] }>('/api/goals')
    return data.goals || []
  }

  async getGoalDetail(goalId: string): Promise<Goal | null> {
    try {
      return await this.request<Goal>(`/api/goals/${goalId}`)
    } catch {
      return null
    }
  }

  // ── Memory ──

  async searchMemory(query: string): Promise<MemoryUnit[]> {
    const data = await this.request<{ results: MemoryUnit[] }>(`/api/memory/search?q=${encodeURIComponent(query)}`)
    return data.results || []
  }

  // ── Chat ──

  async sendChatMessage(message: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
  }

  // ── Config ──

  async getConfig(): Promise<GatewayConfig> {
    return this.request<GatewayConfig>('/api/config')
  }

  async saveConfig(config: GatewayConfig): Promise<void> {
    await fetch(`${this.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  // ── Automations ──

  async getAutomations(): Promise<AutomationRule[]> {
    const data = await this.request<{ rules: AutomationRule[] }>('/api/automations')
    return data.rules || []
  }
}
