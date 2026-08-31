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
  /** opencode 原生 agent tools 开关（支持 '*' 通配 false）—— 与 permissions 互补的硬禁用面 */
  tools?: Record<string, boolean>;
}
