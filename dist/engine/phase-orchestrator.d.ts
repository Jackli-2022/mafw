import { StateFile } from '../utils/state';
import { LoopStateMachineImpl } from './loop-state-machine';
/**
 * Phase Orchestrator — Phase 接力状态机
 *
 * 被 Skill Entry 调用，用于：
 *   1. 读取当前 Phase 状态
 *   2. 验证 Phase 转换合法性
 *   3. 执行状态转换
 *   4. 写入 artifacts 路径
 *
 * 不直接调用 LLM，只做状态管理。
 */
export interface PhaseTransition {
    from: string | null;
    to: string;
    nextAction: string;
    totalWaves?: number;
    artifacts?: Record<string, string>;
    metrics?: Record<string, number>;
    error?: string;
}
/**
 * 验证并执行 Phase 转换
 */
export declare function transitionPhase(goalId: string, transition: PhaseTransition, projectDir?: string): Promise<StateFile>;
/**
 * 获取当前 Phase 信息
 */
export declare function getCurrentPhase(goalId: string, projectDir?: string): Promise<string | null>;
/**
 * 检查是否可以在当前 Phase 执行特定操作
 */
export declare function canExecuteInPhase(goalId: string, requiredPhase: string, projectDir?: string): Promise<boolean>;
/**
 * 记录 Session 信息
 */
export declare function recordSession(goalId: string, phase: string, sessionId: string, projectDir?: string): Promise<StateFile>;
/**
 * 标记 Session 已销毁
 */
export declare function markSessionDestroyed(goalId: string, phase: string, projectDir?: string): Promise<StateFile>;
/**
 * 更新 Wave 进度
 */
export declare function updateWaveProgress(goalId: string, currentWave: number, totalWaves: number, projectDir?: string): Promise<StateFile>;
/**
 * 检查是否应该进入下一轮 Loop
 */
export declare function shouldStartNextLoop(goalId: string, projectDir?: string): Promise<{
    should: boolean;
    reason: string;
}>;
/**
 * 进入下一轮 Loop
 */
export declare function startNextLoop(goalId: string, projectDir?: string): Promise<StateFile>;
export declare function createLoopStateMachine(goalId: string, loopNum: number, projectDir?: string): LoopStateMachineImpl;
/** Clear cached loop machine instances (for testing) */
export declare function clearLoopMachineCache(): void;
/**
 * 处理 Loop 事件（包裹状态机 handleEvent）
 * 自动从 state.json 同步当前 Phase → LoopState
 */
export declare function handleLoopEvent(goalId: string, trigger: string, data?: any, loopNum?: number, projectDir?: string): Promise<boolean>;
//# sourceMappingURL=phase-orchestrator.d.ts.map