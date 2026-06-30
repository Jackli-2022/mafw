import axios from 'axios';

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

export class GitHubConnector {
  private config: GitHubConfig;
  private api: any;

  constructor(config: GitHubConfig) {
    this.config = { baseBranch: 'main', ...config };
    this.api = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `token ${config.token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
  }

  /**
   * 创建 Pull Request
   */
  async createPR(branch: string, title: string, body: string): Promise<{ number: number; url: string }> {
    const res = await this.api.post(
      `/repos/${this.config.owner}/${this.config.repo}/pulls`,
      {
        title,
        head: branch,
        base: this.config.baseBranch,
        body
      }
    );
    return { number: res.data.number, url: res.data.html_url };
  }

  /**
   * 检查 CI 状态
   */
  async checkCI(prNumber: number): Promise<{ status: 'pending' | 'success' | 'failure' | 'error' }> {
    const res = await this.api.get(
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`
    );
    const state = res.data.mergeable_state;
    if (state === 'clean') return { status: 'success' };
    if (state === 'blocked' || state === 'dirty') return { status: 'failure' };
    return { status: 'pending' };
  }

  /**
   * 合并 PR
   */
  async mergePR(prNumber: number): Promise<void> {
    await this.api.put(
      `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/merge`,
      { merge_method: 'squash' }
    );
  }
}
