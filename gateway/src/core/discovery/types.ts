export type DiscoveryDegradedReason =
  | 'capability_absent'
  | 'runtime_error'
  | 'partial'
  | 'instructions_error';

export interface DiscoveryWarning {
  source: 'commands' | 'skills' | 'instructions';
  message: string;
}

export interface DiscoveryCommand {
  name: string;
  aliases?: string[];
  description: string;
  argumentHint?: string;
  category?: 'goals' | 'session' | 'memory' | 'custom' | 'runtime';
  destructive?: boolean;
  source: 'mafw' | 'custom' | 'runtime';
  scope: 'gateway' | 'user' | 'project' | 'runtime';
  runtime?: boolean;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  subtask?: boolean;
}

export interface DiscoverySkill {
  id: string;
  name: string;
  description?: string;
  slash: boolean;
  scope: 'user' | 'project' | 'path';
  location?: string;
  contentLength: number;
}

export interface DiscoveryInstruction {
  id: string;
  path: string;
  scope: 'global' | 'project' | 'nested';
  kind: 'agents-md';
  bytes: number;
  mtime: string;
}

export interface DiscoverySnapshot {
  sessionID: string;
  directory: string;
  revision: string;
  commandsRevision: string;
  generatedAt: string;
  commands: DiscoveryCommand[];
  skills: DiscoverySkill[];
  instructions: DiscoveryInstruction[];
  degraded: boolean;
  degradedReason?: DiscoveryDegradedReason;
  warnings: DiscoveryWarning[];
}

export interface DiscoverySkillContent extends DiscoverySkill {
  content: string;
}
