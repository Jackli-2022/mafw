export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface GraphNodeData {
  label: string;
  status: NodeStatus;
  phase?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SSEEvent {
  type: 'text' | 'graph_state' | 'done' | 'error';
  content?: string;
  activeNodeId?: string;
  phase?: string;
  message?: string;
}

export interface Goal {
  goalId: string;
  phase: string;
  loop: number;
  currentWave: number;
  totalWaves: number;
  nextAction?: string;
  updatedAt?: string;
}
