"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalWorktreeManager = void 0;
const simple_git_1 = __importDefault(require("simple-git"));
class GoalWorktreeManager {
    projectDir;
    git;
    constructor(projectDir = '.') {
        this.projectDir = projectDir;
        this.git = (0, simple_git_1.default)(projectDir);
    }
    /**
     * 准备 Goal 的 Worktree
     */
    async prepare(config) {
        const { projectDir, goalId, parallel } = config;
        if (!parallel) {
            // 非并行模式：在当前目录切换分支
            const branch = `goal/${goalId}`;
            const branches = await this.git.branchLocal();
            if (!branches.all.includes(branch)) {
                await this.git.checkoutLocalBranch(branch);
            }
            await this.git.checkout(branch);
            return { worktreeDir: projectDir, branch, isIsolated: false };
        }
        // 并行模式：创建独立 worktree
        const worktreeDir = `${projectDir}-goal-${goalId}`;
        const branch = `goal/${goalId}`;
        const branches = await this.git.branchLocal();
        if (!branches.all.includes(branch)) {
            await this.git.checkoutLocalBranch(branch);
        }
        // 创建 worktree
        try {
            await this.git.raw(['worktree', 'add', worktreeDir, branch]);
            console.log(`[GoalWorktree] Created worktree ${worktreeDir} for branch ${branch}`);
        }
        catch (err) {
            // 如果 worktree 已存在，直接返回
            console.log(`[GoalWorktree] Worktree ${worktreeDir} already exists`);
        }
        return { worktreeDir, branch, isIsolated: true };
    }
    /**
     * 归档 Goal（合并到 main）
     */
    async archive(info, strategy = 'merge') {
        console.log(`[GoalWorktree] Archiving goal ${info.branch}`);
        await this.git.checkout('main');
        if (strategy === 'merge') {
            try {
                await this.git.merge([info.branch, '--no-ff', '-m', `Merge goal ${info.branch}`]);
                console.log(`[GoalWorktree] Merged ${info.branch} into main`);
            }
            catch (err) {
                console.error(`[GoalWorktree] Merge conflict in ${info.branch}:`, err.message);
                await this.git.merge(['--abort']);
                throw new Error(`Merge conflict: ${info.branch}`);
            }
        }
        else {
            // Squash merge
            await this.git.merge([info.branch, '--squash', '-m', `Squash merge goal ${info.branch}`]);
            await this.git.commit(`Squash merge goal ${info.branch}`);
            console.log(`[GoalWorktree] Squash merged ${info.branch} into main`);
        }
        // 清理独立 worktree
        if (info.isIsolated) {
            try {
                await this.git.raw(['worktree', 'remove', info.worktreeDir]);
                await this.git.deleteBranch(info.branch);
                console.log(`[GoalWorktree] Removed worktree ${info.worktreeDir} and branch ${info.branch}`);
            }
            catch (err) {
                console.warn(`[GoalWorktree] Cleanup warning: ${err.message}`);
            }
        }
    }
    /**
     * 获取当前 Goal 分支信息
     */
    async getCurrentInfo(goalId) {
        const branch = `goal/${goalId}`;
        const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
        return {
            worktreeDir: this.projectDir,
            branch: currentBranch.trim(),
            isIsolated: false
        };
    }
    /**
     * 检查分支是否存在
     */
    async branchExists(branch) {
        const branches = await this.git.branchLocal();
        return branches.all.includes(branch);
    }
    /**
     * 列出所有 git worktree
     */
    async listWorktrees() {
        const output = await this.git.raw(['worktree', 'list']);
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
    /**
     * 清理已删除的 worktree 记录
     */
    async prune() {
        try {
            await this.git.raw(['worktree', 'prune']);
            console.log('[GoalWorktree] Pruned stale worktree records');
        }
        catch (err) {
            console.warn(`[GoalWorktree] Prune warning: ${err.message}`);
        }
    }
}
exports.GoalWorktreeManager = GoalWorktreeManager;
//# sourceMappingURL=goal-worktree-manager.js.map