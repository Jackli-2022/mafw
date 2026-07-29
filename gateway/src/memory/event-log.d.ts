export interface LogEntry {
    op: 'write' | 'archive' | 'rename' | 'access' | 'miss';
    id?: string;
    query?: string;
    miss_cause?: string;
    entry?: any;
    score?: number;
    round?: number;
    ts?: number;
}
export declare class EventLog {
    private baseDir;
    constructor(baseDir: string);
    private logFile;
    private append;
    appendWrite(id: string, entryData: any): void;
    appendArchive(id: string): void;
    appendMiss(query: string, cause: string): void;
    appendAccess(id: string, round: number, score: number): void;
    readAll(): LogEntry[];
}
//# sourceMappingURL=event-log.d.ts.map