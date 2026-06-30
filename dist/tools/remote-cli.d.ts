/**
 * Remote CLI Connector — 唯一的 Connector
 *
 * 职责：
 *   1. 同步本地代码到远程
 *   2. 在远程执行命令（编译、测试）
 *   3. 拉取远程测试结果
 *
 * 使用场景：
 *   - Execute 阶段：remote-cli sync
 *   - Review 阶段：remote-cli run（拉取测试结果）
 */
export declare class RemoteCliConnector {
    /**
     * 同步本地目录到远程
     */
    sync(config: {
        localDir: string;
        remoteHost: string;
        remoteDir: string;
    }): Promise<{
        success: boolean;
        output: string;
    }>;
    /**
     * 在远程执行命令
     */
    run(config: {
        host: string;
        command: string;
        cwd: string;
    }): Promise<{
        success: boolean;
        output: string;
        exitCode: number;
    }>;
    /**
     * 拉取远程文件内容
     */
    fetch(config: {
        host: string;
        remotePath: string;
    }): Promise<{
        success: boolean;
        content: string;
    }>;
    /**
     * 获取远程测试结果（解析格式）
     */
    fetchTestResults(config: {
        host: string;
        resultPath: string;
    }): Promise<{
        coverage: number;
        errors: number;
        raw: string;
    }>;
}
//# sourceMappingURL=remote-cli.d.ts.map