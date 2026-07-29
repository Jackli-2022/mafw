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

export interface SSEEvent {
  type: 'text' | 'graph_state' | 'done' | 'error'
  activeNodeId?: string
  phase?: string
  content?: string
  message?: string
}

export interface AutomationRule {
  id: string
  enabled: boolean
  trigger?: { schedule: string; timezone: string }
  action?: { type: string }
  skill?: string
}

export interface Project {
  id: string
  worktree: string
  mafwDir?: string
}

export interface Session {
  id: string
  title?: string
  projectID?: string
  createdAt?: string
  updatedAt?: string
}

export interface GatewayConfig {
  [key: string]: any
}
