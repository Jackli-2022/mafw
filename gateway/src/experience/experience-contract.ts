/** Gateway → front-end Experience Contract（与 runtime 原生 coverage 分离）。 */
export const EXPERIENCE_VERSION = '2026.11.1';

/**
 * 本响应可被消费的最低客户端 Experience 版本。
 *
 * v2 相对 v1 只做了加法（新增 `supported` 与新动作 id），读 `enabled` 的旧客户端仍能
 * 正常工作，所以门槛保持在 v1。仅在出现**破坏性** wire 变更时才抬升此值。
 */
export const MIN_CLIENT_EXPERIENCE_VERSION = '2026.11.0';

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
] as const;

export type ExperienceActionId = typeof EXPERIENCE_ACTION_IDS[number];

export const ACTION_UNAVAILABLE_REASONS = [
  'unsupported',
  'busy',
  'missing-data',
  'non-invertible-patch',
  'unsafe',
] as const;

export type ActionUnavailableReason = typeof ACTION_UNAVAILABLE_REASONS[number];

export interface ActionDescriptor {
  /** 当前 runtime/会话是否具备该能力（功能面是否存在）。 */
  supported: boolean;
  /** 此刻是否允许执行；对象级限制走 reason。 */
  enabled: boolean;
  reason?: ActionUnavailableReason;
  warningKey?: string;
  semantics?: Record<string, unknown>;
}

export interface ExperienceActionsResponse {
  experienceVersion: string;
  minClientVersion?: string;
  sessionID?: string;
  actions: Partial<Record<ExperienceActionId, ActionDescriptor>>;
}

/**
 * 构造 ActionDescriptor 的唯一入口：在 schema 层强制不变量。
 *
 * - `supported=false` → `enabled=false` + `reason='unsupported'`（无论调用方传了什么）。
 * - `enabled=true` → 丢弃 reason（可用动作不得携带不可用原因）。
 */
export function action(
  supported: boolean,
  enabled: boolean,
  reason?: ActionUnavailableReason,
  semantics?: Record<string, unknown>,
): ActionDescriptor {
  if (!supported) return { supported: false, enabled: false, reason: 'unsupported' };
  const descriptor: ActionDescriptor = { supported: true, enabled: enabled === true };
  if (!descriptor.enabled && reason) descriptor.reason = reason;
  if (semantics && Object.keys(semantics).length > 0) descriptor.semantics = semantics;
  return descriptor;
}

const ACTIONS: ReadonlyArray<{
  id: ExperienceActionId;
  scope: 'checkpoint' | 'branch' | 'run' | 'session' | 'approval' | 'background' | 'terminal' | 'app';
  description: string;
}> = [
  { id: 'checkpoint.restore', scope: 'checkpoint', description: 'Restore a server checkpoint (conversation, files or both)' },
  { id: 'checkpoint.create', scope: 'checkpoint', description: 'Create a manual checkpoint for the session' },
  { id: 'branch.fork', scope: 'branch', description: 'Fork a session from a message' },
  { id: 'branch.revert', scope: 'branch', description: 'Revert a session to a message' },
  { id: 'branch.unrevert', scope: 'branch', description: 'Undo the last revert' },
  { id: 'branch.diff', scope: 'branch', description: 'Read session or per-turn diffs and revert selected hunks' },
  { id: 'run.control', scope: 'run', description: 'Suspend, resume or discard a turn-level run state' },
  { id: 'session.worktree', scope: 'session', description: 'Create a session in an isolated worktree directory' },
  { id: 'session.summarize', scope: 'session', description: 'Compact the session history' },
  { id: 'session.switch-agent', scope: 'session', description: 'Switch the session agent' },
  { id: 'session.switch-model', scope: 'session', description: 'Switch the session model' },
  { id: 'session.discovery', scope: 'session', description: 'Read commands, skills and AGENTS sources' },
  { id: 'approval.permission', scope: 'approval', description: 'List and reply to permission requests' },
  { id: 'approval.question', scope: 'approval', description: 'List, reply to and reject questions' },
  { id: 'background.jobs', scope: 'background', description: 'List, read output and cancel background jobs' },
  { id: 'terminal.attach', scope: 'terminal', description: 'Attach to a session terminal over the neutral PTY protocol' },
  { id: 'prompt.steer', scope: 'session', description: 'Deliver a busy prompt as steer or gateway queue' },
  { id: 'session.background', scope: 'session', description: 'Move blocking tools to background' },
  { id: 'mcp.manage', scope: 'app', description: 'List/connect/disconnect MCP servers' },
  { id: 'mcp.config.write', scope: 'app', description: 'Persist MCP server configuration' },
];

export function buildExperienceContractManifest() {
  return {
    experienceVersion: EXPERIENCE_VERSION,
    minClientVersion: MIN_CLIENT_EXPERIENCE_VERSION,
    actions: ACTIONS,
    reasons: ACTION_UNAVAILABLE_REASONS,
  } as const;
}
