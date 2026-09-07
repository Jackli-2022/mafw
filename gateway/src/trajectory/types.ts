export const TRAJECTORY_EVENT_TYPES = [
  'tool_start',
  'tool_update',
  'tool_end',
  'reasoning_start',
  'reasoning_end',
  'agent_switch',
  'model_switch',
  'step_finish',
  'turn_start',
  'turn_end',
  'text_start',
  'text_end',
] as const;

export type TrajectoryEventType = typeof TRAJECTORY_EVENT_TYPES[number];

export interface TokenCounts {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ModelUsageRow {
  provider: string | null;
  model: string;
  turns: number;
  tokens: TokenCounts;
}

export interface TrajectoryEvent {
  id?: number;
  projectID: string;
  sessionID: string;
  turnID: number;
  seq: number;
  eventType: TrajectoryEventType;
  toolName?: string;
  callID?: string;
  toolState?: 'running' | 'completed' | 'error';
  agent?: string;
  model?: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  tokens?: TokenCounts;
  cost?: number;
  finish?: string;
  timeMs: number;
  durationMs?: number;
}

export interface TrajectoryTurn {
  projectID: string;
  sessionID: string;
  turnID: number;
  turnStartMs: number;
  turnEndMs: number | null;
  durationMs: number | null;
  toolCount: number;
  toolErrorCount: number;
  reasoningCount: number;
  agentSwitchCount: number;
  tokens: TokenCounts;
  cost: number;
  finish: string | null;
  model: string | null;
  provider: string | null;
  agent: string | null;
  userText: string;
  assistantText?: string;
  workerRole?: string;
}
