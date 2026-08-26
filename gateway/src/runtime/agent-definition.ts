export type PermissionRule = 'allow' | 'deny' | 'ask';

export interface AgentPermissions {
  edit?: PermissionRule;
  bash?: PermissionRule;
  task?: Record<string, PermissionRule>;
  tools?: Record<string, PermissionRule>;
}

export interface AgentDefinition {
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  model?: string;
  temperature?: number;
  color?: string;
  systemPrompt: string;
  permissions: AgentPermissions;
}
