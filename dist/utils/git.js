"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitUtils = void 0;
const simple_git_1 = __importDefault(require("simple-git"));
/**
 * Git Utils — 常用 Git 操作封装
 */
class GitUtils {
    git;
    constructor(projectDir = '.') {
        this.git = (0, simple_git_1.default)(projectDir);
    }
    async createBranch(branchName, base = 'main') {
        await this.git.checkoutBranch(branchName, base);
    }
    async checkout(branch) {
        await this.git.checkout(branch);
    }
    async merge(branchName, message) {
        await this.git.merge([branchName, '--no-ff', '-m', message]);
    }
    async abortMerge() {
        await this.git.merge(['--abort']);
    }
    async getBranches() {
        const result = await this.git.branchLocal();
        return result.all;
    }
    async commit(files, message) {
        await this.git.add(files);
        await this.git.commit(message);
    }
    async stash() {
        await this.git.stash(['push', '-m', 'MAFW auto-stash']);
    }
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
    async pruneWorktrees() {
        await this.git.raw(['worktree', 'prune']);
    }
    async hasLocalChanges() {
        const status = await this.git.status();
        return status.files.length > 0;
    }
    async fetch() {
        await this.git.fetch();
    }
    async push(branch) {
        if (branch) {
            await this.git.push('origin', branch);
        }
        else {
            await this.git.push();
        }
    }
}
exports.GitUtils = GitUtils;
//# sourceMappingURL=git.js.map