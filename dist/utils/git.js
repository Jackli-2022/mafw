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
}
exports.GitUtils = GitUtils;
//# sourceMappingURL=git.js.map