import { StateFile } from '../utils/state';
/**
 * Simplified Phase Orchestrator — no state machine logic.
 * LangGraph handles all orchestration decisions.
 * This file only exists for skill entry backward compatibility.
 */
export interface PhaseTransition {
    from: string | null;
    to: string;
    nextAction?: string;
    totalWaves?: number;
    artifacts?: Record<string, string>;
    metrics?: Record<string, number>;
    error?: string;
}
export declare function transitionPhase(goalId: string, transition: PhaseTransition, projectDir?: string): Promise<StateFile>;
export declare function recordSession(goalId: string, phase: string, sessionId: string, projectDir?: string): Promise<StateFile>;
export declare function updateWaveProgress(goalId: string, currentWave: number, totalWaves: number, projectDir?: string): Promise<StateFile>;
export declare function startNextLoop(goalId: string, projectDir?: string): Promise<StateFile>;
export declare function getCurrentPhase(goalId: string, projectDir?: string): Promise<string | null>;
export declare function canExecuteInPhase(goalId: string, requiredPhase: string, projectDir?: string): Promise<boolean>;
export declare function markSessionDestroyed(goalId: string, phase: string, projectDir?: string): Promise<StateFile>;
export declare function shouldStartNextLoop(goalId: string, projectDir?: string): Promise<{
    should: boolean;
    reason: string;
}>;
export declare function handleLoopEvent(goalId: string, trigger: string, data?: any, loopNum?: number, projectDir?: string): Promise<boolean>;
//# sourceMappingURL=phase-orchestrator.d.ts.map