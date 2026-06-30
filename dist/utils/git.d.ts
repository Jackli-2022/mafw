/**
 * Git Utils — 常用 Git 操作封装
 */
export declare class GitUtils {
    private git;
    constructor(projectDir?: string);
    createBranch(branchName: string, base?: string): Promise<void>;
    checkout(branch: string): Promise<void>;
    merge(branchName: string, message: string): Promise<void>;
    abortMerge(): Promise<void>;
    getBranches(): Promise<string[]>;
    commit(files: string[], message: string): Promise<void>;
    stash(): Promise<void>;
}
//# sourceMappingURL=git.d.ts.map