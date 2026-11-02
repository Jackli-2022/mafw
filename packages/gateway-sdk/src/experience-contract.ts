/** Experience Contract DTOs（GET /api/experience/actions）。 */
export const EXPERIENCE_VERSION = '2026.11.1'

/**
 * 本响应可被消费的最低客户端 Experience 版本。v2 只做了加法（新增 `supported` 与动作 id），
 * 读 `enabled` 的旧客户端仍可用，因此门槛保持在 v1。
 */
export const MIN_CLIENT_EXPERIENCE_VERSION = '2026.11.0'

export const EXPERIENCE_ACTION_IDS = [
  'checkpoint.restore',
  'checkpoint.create',
  'branch.fork',
  'branch.revert',
  'branch.unrevert',
  'branch.diff',
  'run.control',
  'session.worktree',
  'session.summarize',
  'session.switch-agent',
  'session.switch-model',
  'session.discovery',
  'approval.permission',
  'approval.question',
  'background.jobs',
  'terminal.attach',
  'prompt.steer',
  'session.background',
  'mcp.manage',
  'mcp.config.write',
] as const

export type ExperienceActionId = typeof EXPERIENCE_ACTION_IDS[number]

export const ACTION_UNAVAILABLE_REASONS = [
  'unsupported',
  'busy',
  'missing-data',
  'non-invertible-patch',
  'unsafe',
] as const

export type ActionUnavailableReason = typeof ACTION_UNAVAILABLE_REASONS[number]

export interface ActionDescriptor {
  /** 当前 runtime/会话是否具备该能力（功能面是否存在）。 */
  supported: boolean
  /** 此刻是否允许执行；对象级限制走 reason。 */
  enabled: boolean
  reason?: ActionUnavailableReason
  warningKey?: string
  semantics?: Record<string, unknown>
}

export interface ExperienceActionsResponse {
  experienceVersion: string
  minClientVersion?: string
  sessionID?: string
  actions: Partial<Record<ExperienceActionId, ActionDescriptor>>
}

/**
 * 与 gateway 同形的构造助手：`supported=false` ⇒ `enabled=false`；`enabled=true` ⇒ 无 reason。
 * 客户端 fixture 与未来「离线契约校验」复用同一不变量。
 */
export function action(
  supported: boolean,
  enabled: boolean,
  reason?: ActionUnavailableReason,
  semantics?: Record<string, unknown>,
): ActionDescriptor {
  if (!supported) return { supported: false, enabled: false, reason: 'unsupported' }
  const descriptor: ActionDescriptor = { supported: true, enabled: enabled === true }
  if (!descriptor.enabled && reason) descriptor.reason = reason
  if (semantics && Object.keys(semantics).length > 0) descriptor.semantics = semantics
  return descriptor
}
