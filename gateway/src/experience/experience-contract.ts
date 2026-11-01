/** Gateway → front-end Experience Contract（与 runtime 原生 coverage 分离）。 */
export const EXPERIENCE_VERSION = '2026.11.0';

export const EXPERIENCE_ACTION_IDS = [
  'checkpoint.restore',
  'prompt.steer',
  'session.background',
  'mcp.manage',
  'mcp.config.write',
] as const;

export type ExperienceActionId = typeof EXPERIENCE_ACTION_IDS[number];

export type ActionUnavailableReason =
  | 'unsupported'
  | 'busy'
  | 'missing-data'
  | 'non-invertible-patch'
  | 'unsafe';

export interface ActionDescriptor {
  enabled: boolean;
  reason?: ActionUnavailableReason;
  warningKey?: string;
  semantics?: Record<string, unknown>;
}

export interface ExperienceActionsResponse {
  experienceVersion: string;
  sessionID?: string;
  actions: Record<ExperienceActionId, ActionDescriptor>;
}

export function buildExperienceContractManifest() {
  return {
    experienceVersion: EXPERIENCE_VERSION,
    actions: [
      { id: 'checkpoint.restore', scope: 'checkpoint', description: 'Restore a server checkpoint' },
      { id: 'prompt.steer', scope: 'session', description: 'Deliver a busy prompt as steer or gateway queue' },
      { id: 'session.background', scope: 'session', description: 'Move blocking tools to background' },
      { id: 'mcp.manage', scope: 'app', description: 'List/connect/disconnect MCP servers' },
      { id: 'mcp.config.write', scope: 'app', description: 'Persist MCP server configuration' },
    ],
    reasons: ['unsupported', 'busy', 'missing-data', 'non-invertible-patch', 'unsafe'],
  } as const;
}
