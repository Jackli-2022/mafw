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
}
