import simpleGit from 'simple-git';

/**
 * Git Utils — 常用 Git 操作封装
 */
export class GitUtils {
  private git: any;

  constructor(projectDir: string = '.') {
    this.git = simpleGit(projectDir);
  }

  async createBranch(branchName: string, base = 'main'): Promise<void> {
    await this.git.checkoutBranch(branchName, base);
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  async merge(branchName: string, message: string): Promise<void> {
    await this.git.merge([branchName, '--no-ff', '-m', message]);
  }

  async abortMerge(): Promise<void> {
    await this.git.merge(['--abort']);
  }

  async getBranches(): Promise<string[]> {
    const result = await this.git.branchLocal();
    return result.all as string[];
  }

  async commit(files: string[], message: string): Promise<void> {
    await this.git.add(files);
    await this.git.commit(message);
  }

  async stash(): Promise<void> {
    await this.git.stash(['push', '-m', 'MAFW auto-stash']);
  }

  async listWorktrees(): Promise<Array<{ path: string; branch: string; head: string }>> {
    const output: string = await this.git.raw(['worktree', 'list']);
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const parts = line.split(/\s+/);
      return {
        path: parts[0],
        branch: (parts[1] || '').replace(/\[|\]/g, ''),
        head: parts[2] || '',
      };
    });
  }

  async pruneWorktrees(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  async hasLocalChanges(): Promise<boolean> {
    const status = await this.git.status();
    return status.files.length > 0;
  }

  async fetch(): Promise<void> {
    await this.git.fetch();
  }

  async push(branch?: string): Promise<void> {
    if (branch) {
      await this.git.push('origin', branch);
    } else {
      await this.git.push();
    }
  }
}
