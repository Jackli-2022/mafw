import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

export class RemoteCliConnector {
  /**
   * 同步本地目录到远程
   */
  async sync(config: {
    localDir: string;
    remoteHost: string;
    remoteDir: string;
  }): Promise<{ success: boolean; output: string }> {
    const { localDir, remoteHost, remoteDir } = config;

    try {
      const result = await execAsync(
        `remote-cli sync --project "${localDir}" --host ${remoteHost} --remote-dir "${remoteDir}"`
      );
      return {
        success: true,
        output: result.stdout + result.stderr
      };
    } catch (err: any) {
      return {
        success: false,
        output: err.message + (err.stderr || '')
      };
    }
  }

  /**
   * 在远程执行命令
   */
  async run(config: {
    host: string;
    command: string;
    cwd: string;
  }): Promise<{ success: boolean; output: string; exitCode: number }> {
    const { host, command, cwd } = config;

    try {
      const result = await execAsync(
        `remote-cli run --host ${host} --cwd "${cwd}" -- "${command}"`
      );
      return {
        success: true,
        output: result.stdout + result.stderr,
        exitCode: 0
      };
    } catch (err: any) {
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
  async fetch(config: {
    host: string;
    remotePath: string;
  }): Promise<{ success: boolean; content: string }> {
    const { host, remotePath } = config;

    try {
      const result = await execAsync(
        `remote-cli run --host ${host} -- "cat ${remotePath}"`
      );
      return {
        success: true,
        content: result.stdout
      };
    } catch (err: any) {
      return {
        success: false,
        content: err.message
      };
    }
  }

  /**
   * 获取远程测试结果（解析格式）
   */
  async fetchTestResults(config: {
    host: string;
    resultPath: string;
  }): Promise<{ coverage: number; errors: number; raw: string }> {
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

/**
 * 解析测试结果
 */
function parseTestResults(raw: string): { coverage: number; errors: number; raw: string } {
  // 简单解析：查找 coverage 和 errors
  const coverageMatch = raw.match(/coverage[\s:]+(\d+\.?\d*)%?/i);
  const errorsMatch = raw.match(/errors?[\s:]+(\d+)/i);

  return {
    coverage: coverageMatch ? parseFloat(coverageMatch[1]) : 0,
    errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
    raw
  };
}
