/**
 * Scheduler Ledger — Scheduler 审计日志
 *
 * 独立记录 Scheduler 的事件（启动、恢复、重启、失败）。
 */
export interface LedgerEntry {
    timestamp: string;
    event: string;
    goalId?: string;
    reason?: string;
    sessionId?: string;
    details?: Record<string, any>;
}
export declare class SchedulerLedger {
    private ledgerPath;
    constructor(projectDir?: string);
    append(entry: LedgerEntry): void;
    read(): LedgerEntry[];
    private parse;
}
//# sourceMappingURL=ledger.d.ts.map