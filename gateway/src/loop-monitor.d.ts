export declare class LoopMonitor {
    private statusPath;
    constructor(statusPath: string);
    isStuck(timeoutMs?: number): boolean;
    getState(): {
        goalId: string;
        state: string;
        loop: number;
        updatedAt: string;
    } | null;
}
//# sourceMappingURL=loop-monitor.d.ts.map