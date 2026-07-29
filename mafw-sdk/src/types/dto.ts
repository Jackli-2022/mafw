// ── Session ──

export interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  time: { created: number; updated: number }
  parentID?: string
}

export interface TextPart {
  id: string
  sessionID: string
  messageID: string
  type: 'text'
  text: string
}

export interface SessionMessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  parentID?: string
  time: { created: number; updated?: number }
}

export interface SessionMessagePart {
  id: string
  messageID: string
  sessionID: string
  type: string
  text?: string
}

// ── Project ──

export interface Project {
  id: string
  worktree: string
  mafwDir?: string
}

// ── Goal ──

export interface Goal {
  goalId: string
  phase: string
  loop: number
  currentWave: number
  totalWaves: number
  nextAction?: string
  error?: string
  updatedAt?: string
}

export interface GoalCreateInput {
  goalId: string
  title: string
  charter: string
  metrics?: string[]
  boundaries?: string[]
  maxLoops?: number
}

export interface GoalControlAction {
  action: 'PAUSE' | 'ABORT' | 'FORCE_PHASE' | 'RESET_PARAMETRIC'
  goalId: string
  targetPhase?: string
}

// ── Memory ──

export interface MemoryUnit {
  id: string
  type: 'episodic' | 'semantic' | 'procedural' | 'global'
  primary_abstraction: string
  cue_anchors: string[]
  memory_value: string
  energy: number
  salience?: number
  created_at?: string
}

export interface MemoryFact {
  source: 'parametric' | 'harmonic'
  type: string
  content: string
  energy: number
}

export interface MemorySearchOptions {
  query: string
  topK?: number
  goalId?: string
}

export interface MergedSearchOptions {
  query: string
  maxFacts?: number
}

export interface EnergyDistribution {
  critical: number
  high: number
  medium: number
  low: number
  total: number
}

export interface Axiom {
  id: string
  content: string
  energy: number
}

// ── Approval ──

export interface Approval {
  id: string
  goalId: string
  question: string
  status: 'pending' | 'answered' | 'expired'
  createdAt: string
}

// ── Triage ──

export interface TriageItem {
  id: string
  summary: string
  automationId: string
  severity: 'low' | 'medium' | 'high'
  state: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED'
  discoveredAt: string
  proposedGoal?: {
    title: string
    boundaries: string[]
    estimatedLoops: number
  }
  userAction?: {
    type: string
    at: string
  } | null
  deadline?: string
}

// ── Automation ──

export interface AutomationRule {
  id: string
  enabled: boolean
  trigger: { type: 'cron'; schedule: string; timezone: string }
  action: { type: MemoryActionType }
  skill?: string
  args?: Record<string, any>
  onResult?: {
    type: 'triage' | 'goal'
    auto_confirm?: boolean
    template?: string
  }
  goal_defaults?: {
    maxLoops?: number
    metrics?: string[]
  }
}

export type MemoryActionType = 'cognitive_prune' | 'memory_decay' | 'memory_distill' | 'memory_review' | string

// ── Chat ──

export interface ChatResult {
  sessionID: string
}
