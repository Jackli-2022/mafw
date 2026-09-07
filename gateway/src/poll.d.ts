/**
 * Request Manager — 读写 requests/ 目录的请求文件
 *
 * Schema: .mafw/requests/{goalId}.json
 */
export interface GoalRequest {
    version: string;
    goalId: string;
    title: string;
    state: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED' | 'ABORTED';
    createdAt: string;
    confirmedAt: string;
    source: string;
    projectDir: string;
    goalCharter: string;
    metrics: Record<string, {
        target: number;
        unit: string;
    }>;
    boundaries: string[];
    priority: string;
    maxLoops: number;
    degradeOnLoop: number;
    resumeFrom?: string;
    updatedAt?: string;
    sessionId?: string;
}
export declare class RequestManager {
    private requestsDir;
    constructor(projectDir?: string);
    /**
     * 加载所有请求文件
     */
    loadAll(): GoalRequest[];
    /**
     * 加载单个请求
     */
    load(goalId: string): GoalRequest | null;
    /**
     * 更新请求状态
     */
    updateState(goalId: string, state: GoalRequest['state'], sessionId?: string): void;
    /**
     * 保存请求
     */
    save(req: GoalRequest): void;
    /**
     * 查找 PENDING 状态的请求
     */
    findPending(): GoalRequest[];
    /**
     * 查找 RUNNING 状态的请求
     */
    findRunning(): GoalRequest[];
    /**
     * 移动已完成的请求到 processed/
     */
    archive(goalId: string): void;
}
//# sourceMappingURL=poll.d.ts.map