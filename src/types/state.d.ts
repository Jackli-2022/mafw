/**
 * State Type Definitions — v3.5
 */

export interface StateFile {
  version: string;
  goalId: string;
  loop: number;
  phase: string | null;
  lastPhase: string | null;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, SessionInfo>;
  nextAction: string;
  artifacts: Record<string, string>;
  metrics?: Record<string, number>;
  error?: string;
  updatedAt: string;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  destroyedAt?: string;
  active: boolean;
}

export interface GoalRequest {
  version: string;
  goalId: string;
  title: string;
  state: string;
  createdAt: string;
  confirmedAt: string;
  source: string;
  projectDir: string;
  mafwDir: string;
  goalCharter: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  priority: string;
  maxLoops: number;
  parallel: boolean;
  degradeOnLoop: number;
  remoteCli?: {
    host: string;
    projectDir: string;
    syncOnExecute: boolean;
    testCommand: string;
  };
}
