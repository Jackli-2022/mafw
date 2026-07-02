export declare class DashboardServer {
    private port;
    private server?;
    private api;
    private publicDir;
    private sseClients;
    constructor(port?: number, projectDir?: string);
    private resolveFilePath;
    start(): Promise<void>;
    broadcast(event: {
        type: string;
        [key: string]: any;
    }): void;
    stop(): void;
}
//# sourceMappingURL=server.d.ts.map