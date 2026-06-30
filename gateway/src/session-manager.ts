import axios from 'axios';

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

export class SessionManager {
  private serverUrl: string;

  constructor(serverUrl: string = 'http://127.0.0.1:4096') {
    this.serverUrl = serverUrl;
  }

  /**
   * 创建指定目录的 session
   */
  async create(projectDir: string, metadata?: Record<string, any>): Promise<Session> {
    const res = await axios.post(
      `${this.serverUrl}/session`,
      { metadata },
      {
        headers: { 'X-OpenCode-Directory': projectDir },
        timeout: 10000
      }
    );
    return res.data as Session;
  }

  /**
   * 发送异步 skill prompt
   */
  async sendPrompt(sessionId: string, message: string): Promise<void> {
    await axios.post(
      `${this.serverUrl}/session/${sessionId}/prompt_async`,
      { message },
      { timeout: 10000 }
    );
  }

  /**
   * 终止 session
   */
  async kill(sessionId: string): Promise<void> {
    await axios.delete(`${this.serverUrl}/session/${sessionId}`, { timeout: 10000 });
  }

  /**
   * 检查 Server 是否可达
   */
  async isHealthy(): Promise<boolean> {
    try {
      await axios.get(`${this.serverUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 等待 Server 启动
   */
  async waitForServer(timeoutMs: number = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Server not reachable after timeout');
  }
}
