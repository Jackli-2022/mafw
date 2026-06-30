"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteCliConnector = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
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
class RemoteCliConnector {
    /**
     * 同步本地目录到远程
     */
    async sync(config) {
        const { localDir, remoteHost, remoteDir } = config;
        try {
            const result = await execAsync(`remote-cli sync --project "${localDir}" --host ${remoteHost} --remote-dir "${remoteDir}"`);
            return {
                success: true,
                output: result.stdout + result.stderr
            };
        }
        catch (err) {
            return {
                success: false,
                output: err.message + (err.stderr || '')
            };
        }
    }
    /**
     * 在远程执行命令
     */
    async run(config) {
        const { host, command, cwd } = config;
        try {
            const result = await execAsync(`remote-cli run --host ${host} --cwd "${cwd}" -- "${command}"`);
            return {
                success: true,
                output: result.stdout + result.stderr,
                exitCode: 0
            };
        }
        catch (err) {
            return {
                success: false,
                output: err.message + (err.stderr || ''),
                exitCode: err.code || 1
            };
        }
    }
    /**
     * 拉取远程文件内容
     */
    async fetch(config) {
        const { host, remotePath } = config;
        try {
            const result = await execAsync(`remote-cli run --host ${host} -- "cat ${remotePath}"`);
            return {
                success: true,
                content: result.stdout
            };
        }
        catch (err) {
            return {
                success: false,
                content: err.message
            };
        }
    }
    /**
     * 获取远程测试结果（解析格式）
     */
    async fetchTestResults(config) {
        const result = await this.fetch({
            host: config.host,
            remotePath: config.resultPath
        });
        if (!result.success) {
            return { coverage: 0, errors: 0, raw: result.content };
        }
        return parseTestResults(result.content);
    }
}
exports.RemoteCliConnector = RemoteCliConnector;
/**
 * 解析测试结果
 */
function parseTestResults(raw) {
    // 简单解析：查找 coverage 和 errors
    const coverageMatch = raw.match(/coverage[\s:]+(\d+\.?\d*)%?/i);
    const errorsMatch = raw.match(/errors?[\s:]+(\d+)/i);
    return {
        coverage: coverageMatch ? parseFloat(coverageMatch[1]) : 0,
        errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
        raw
    };
}
//# sourceMappingURL=remote-cli.js.map