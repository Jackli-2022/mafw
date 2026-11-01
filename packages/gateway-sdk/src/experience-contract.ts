/** Experience Contract DTOs（GET /api/experience/actions）。 */
export const EXPERIENCE_VERSION = '2026.11.0'

export type ExperienceActionId =
  | 'checkpoint.restore'
  | 'prompt.steer'
  | 'session.background'
  | 'mcp.manage'
  | 'mcp.config.write'

export type ActionUnavailableReason =
  | 'unsupported'
  | 'busy'
  | 'missing-data'
  | 'non-invertible-patch'
  | 'unsafe'

export interface ActionDescriptor {
  enabled: boolean
  reason?: ActionUnavailableReason
  warningKey?: string
  semantics?: Record<string, unknown>
}

export interface ExperienceActionsResponse {
  experienceVersion: string
  sessionID?: string
  actions: Partial<Record<ExperienceActionId, ActionDescriptor>>
}
