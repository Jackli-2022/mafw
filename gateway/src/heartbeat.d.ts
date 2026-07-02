/**
 * Heartbeat — 监控活跃 Goal 的心跳
 *
 * 通过读取 STATUS.md 判断每个 RUNNING Goal 是否活跃。
 * 超过 5 分钟无心跳 → 标记为 STUCK，触发恢复。
 */
export interface HeartbeatStatus {
    goalId: string;
    state: string;
    loop: number;
    wave: number;
    task: string;
    progress: string;
    lastHeartbeat: string;
    sessionId: string | null;
    directory: string;
}
export declare class HeartbeatMonitor {
    private statusPath;
    private timeoutMs;
    constructor(projectDir?: string, timeoutMs?: number);
    /**
     * 检查所有活跃 Goal 的心跳
     */
    check(): {
        healthy: HeartbeatStatus[];
        stuck: HeartbeatStatus[];
    };
    /**
     * 加载所有 Goal 状态
     */
    loadAll(): HeartbeatStatus[];
    /**
     * 解析多 Goal STATUS.md 格式
     */
    private parse;
}
//# sourceMappingURL=heartbeat.d.ts.map