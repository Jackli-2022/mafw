"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubConnector = void 0;
const axios_1 = __importDefault(require("axios"));
class GitHubConnector {
    config;
    api;
    constructor(config) {
        this.config = { baseBranch: 'main', ...config };
        this.api = axios_1.default.create({
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
    async createPR(branch, title, body) {
        const res = await this.api.post(`/repos/${this.config.owner}/${this.config.repo}/pulls`, {
            title,
            head: branch,
            base: this.config.baseBranch,
            body
        });
        return { number: res.data.number, url: res.data.html_url };
    }
    /**
     * 检查 CI 状态
     */
    async checkCI(prNumber) {
        const res = await this.api.get(`/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`);
        const state = res.data.mergeable_state;
        if (state === 'clean')
            return { status: 'success' };
        if (state === 'blocked' || state === 'dirty')
            return { status: 'failure' };
        return { status: 'pending' };
    }
    /**
     * 合并 PR
     */
    async mergePR(prNumber) {
        await this.api.put(`/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/merge`, { merge_method: 'squash' });
    }
}
exports.GitHubConnector = GitHubConnector;
//# sourceMappingURL=github.js.map