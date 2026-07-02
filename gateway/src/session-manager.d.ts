/**
 * Session Manager — 通过 Server API 创建和管理 session
 *
 * API:
 *   POST /session?directory={projectDir} → 创建 session
 *   POST /session/{id}/prompt_async → 发送 skill prompt
 *   DELETE /session/{id} → 终止 session
 */
export interface Session {
    id: string;
    directory: string;
    createdAt: string;
    metadata?: Record<string, any>;
}
export declare class SessionManager {
    private serverUrl;
    constructor(serverUrl?: string);
    /**
     * 创建指定目录的 session
     */
    create(projectDir: string, metadata?: Record<string, any>): Promise<Session>;
    /**
     * 发送异步 skill prompt
     */
    sendPrompt(sessionId: string, message: string): Promise<void>;
    /**
     * 终止 session
     */
    kill(sessionId: string): Promise<void>;
    /**
     * 检查 Server 是否可达
     */
    isHealthy(): Promise<boolean>;
    /**
     * 等待 Server 启动
     */
    waitForServer(timeoutMs?: number): Promise<void>;
}
//# sourceMappingURL=session-manager.d.ts.map