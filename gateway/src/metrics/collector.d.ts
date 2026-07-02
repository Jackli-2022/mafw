/**
 * Metrics Collector — Gateway 运行时指标收集
 */
export declare class MetricsCollector {
    private metrics;
    record(data: {
        goalId: string;
        phase: string | null;
        loop: number;
        sessionCount: number;
        timestamp: string;
    }): Promise<void>;
    getSnapshot(): Promise<any>;
}
//# sourceMappingURL=collector.d.ts.map