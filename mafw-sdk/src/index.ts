export { MafwClient } from './client/client'
export { SSEConnection } from './client/sse'
export type {
  SessionNamespace, ProjectNamespace, EventNamespace, ConfigNamespace,
  ChatNamespace, GoalsNamespace, MemoryNamespace, ApprovalsNamespace,
  TriageNamespace, AutomationsNamespace, IMafwClient,
} from './client/types'
export type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemoryFact, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, Approval, TriageItem, AutomationRule,
  MemoryActionType,
  ChatResult, TextPart,
  GatewayState, GatewayStatus,
} from './types'
