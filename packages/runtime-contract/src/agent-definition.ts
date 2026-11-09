/** Runtime-neutral agent definition DTO (drivers translate it to their own format). */

export type PermissionRule = 'allow' | 'deny' | 'ask';

export interface RuntimeAgentPermissions {
  edit?: PermissionRule;
  bash?: PermissionRule;
  task?: Record<string, PermissionRule>;
  tools?: Record<string, PermissionRule>;
}

export interface RuntimeAgentDefinition {
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  model?: string;
  temperature?: number;
  color?: string;
  systemPrompt: string;
  permissions: RuntimeAgentPermissions;
  /** Native agent tool switches (supports '*' wildcard false), complementary to permissions. */
  tools?: Record<string, boolean>;
}
