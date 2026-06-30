/**
 * State Machine Utilities — v3.5
 *
 * 核心职责：
 *   - updateState: Skill Entry 末尾显式更新 state.json
 *   - loadState: 读取当前状态
 *   - loadRequest: 读取请求配置
 *   - loadGoal: 读取 Goal Charter
 *   - loadWaves: 读取 Plan 产出
 *   - loadReceipts: 读取 Execute 产出
 *   - loadReview: 读取 Review 产出
 *
 * 设计原则：
 *   - 所有状态写入必须是原子操作（先写文件，再返回）
 *   - 所有读取必须验证文件存在性
 *   - 所有路径基于 projectDir 解析，避免硬编码
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
    metrics: Record<string, {
        target: number;
        unit: string;
    }>;
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
/**
 * 更新状态文件（主路径，Skill Entry 末尾调用）
 */
export declare function updateState(goalId: string, patch: Partial<StateFile>, projectDir?: string): Promise<StateFile>;
/**
 * 加载状态文件
 */
export declare function loadState(goalId: string, projectDir?: string): Promise<StateFile>;
/**
 * 加载请求配置
 */
export declare function loadRequest(goalId: string, projectDir?: string): Promise<GoalRequest>;
/**
 * 加载 Goal Charter
 */
export declare function loadGoal(goalId: string, projectDir?: string): Promise<string>;
/**
 * 加载 Waves 配置
 */
export declare function loadWaves(goalId: string, projectDir?: string): Promise<any[]>;
/**
 * 加载 Receipts
 */
export declare function loadReceipts(goalId: string, projectDir?: string): Promise<any[]>;
/**
 * 加载 Review 文件
 */
export declare function loadReview(goalId: string, loop: number, projectDir?: string): Promise<any>;
/**
 * 提取 Goal ID 从消息
 */
export declare function extractGoalId(message: string): string;
/**
 * 检查状态文件是否存在
 */
export declare function stateExists(goalId: string, projectDir?: string): boolean;
/**
 * 初始化新 Goal 的状态文件
 */
export declare function initState(goalId: string, projectDir?: string): void;
//# sourceMappingURL=state.d.ts.map