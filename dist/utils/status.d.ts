/**
 * Status Manager — v2.1 更新
 *
 * 支持多 Goal STATUS.md 格式（文档 §2.2）。
 * 每个 Goal 一个 YAML 块，用 --- 分隔。
 */
export interface GoalStatus {
    goalId: string;
    state: string;
    loop: number;
    wave: number;
    task: string;
    progress: string;
    lastHeartbeat: string;
    sessionId: string | null;
    directory: string;
    phase?: string | null;
}
export declare class StatusManager {
    private statusPath;
    constructor(projectDir?: string);
    /**
     * 读取所有 Goal 状态
     */
    readAll(): GoalStatus[];
    /**
     * 读取单个 Goal 状态
     */
    read(goalId: string): GoalStatus | null;
    /**
     * 更新或创建 Goal 状态
     */
    update(goalId: string, updates: Partial<GoalStatus>): void;
    /**
     * 解析多 Goal STATUS.md
     */
    private parse;
    /**
     * 写入多 Goal STATUS.md
     */
    private write;
    /**
     * 检查是否卡死（5 分钟无更新）
     */
    isStuck(goalId: string): boolean;
}
//# sourceMappingURL=status.d.ts.map