/**
 * GitHub Connector — PR + CI 检查
 *
 * 职责：
 *   1. Goal 完成后创建 GitHub PR
 *   2. 检查 CI 状态
 *   3. 合并通过 CI 的 PR
 */
export interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
    baseBranch?: string;
}
export declare class GitHubConnector {
    private config;
    private api;
    constructor(config: GitHubConfig);
    /**
     * 创建 Pull Request
     */
    createPR(branch: string, title: string, body: string): Promise<{
        number: number;
        url: string;
    }>;
    /**
     * 检查 CI 状态
     */
    checkCI(prNumber: number): Promise<{
        status: 'pending' | 'success' | 'failure' | 'error';
    }>;
    /**
     * 合并 PR
     */
    mergePR(prNumber: number): Promise<void>;
}
//# sourceMappingURL=github.d.ts.map