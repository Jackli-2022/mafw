export interface Goal {
  goalId: string
  phase: string
  loop: number
  currentWave: number
  totalWaves: number
  nextAction?: string
  updatedAt?: string
}

export interface HarmonicUnit {
  id: string
  type: string
  primary_abstraction: string
  cue_anchors: string[]
  memory_value: string
  energy: number
}

function apiFetch(path: string, init?: RequestInit) {
  return window.mafwAPI.fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

export function useGatewayAPI() {
  async function getGoals(): Promise<Goal[]> {
    try {
      const res = await apiFetch('/goals')
      return res.ok ? (await res.json()).goals || [] : []
    } catch {
      return []
    }
  }

  async function getGoalDetail(goalId: string): Promise<Goal | null> {
    try {
      const res = await apiFetch(`/goals/${goalId}`)
      return res.ok ? res.json() : null
    } catch {
      return null
    }
  }

  async function searchMemory(query: string): Promise<HarmonicUnit[]> {
    try {
      const res = await apiFetch(`/memory/search?q=${encodeURIComponent(query)}`)
      return res.ok ? (await res.json()).results || [] : []
    } catch {
      return []
    }
  }

  async function getHealth(): Promise<boolean> {
    try {
      const res = await apiFetch('/health')
      return res.ok
    } catch {
      return false
    }
  }

  async function getConfig(): Promise<Record<string, any>> {
    try {
      const res = await apiFetch('/config')
      return res.ok ? res.json() : {}
    } catch {
      return {}
    }
  }

  async function getAutomations(): Promise<any[]> {
    try {
      const res = await apiFetch('/automations')
      return res.ok ? (await res.json()).rules || [] : []
    } catch {
      return []
    }
  }

  return { getGoals, getGoalDetail, searchMemory, getHealth, getConfig, getAutomations }
}
