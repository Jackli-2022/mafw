"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const axios_1 = __importDefault(require("axios"));
class SessionManager {
    serverUrl;
    constructor(serverUrl = 'http://127.0.0.1:4096') {
        this.serverUrl = serverUrl;
    }
    /**
     * 创建指定目录的 session
     */
    async create(projectDir, metadata) {
        const res = await axios_1.default.post(`${this.serverUrl}/session`, { metadata }, {
            headers: { 'X-OpenCode-Directory': projectDir },
            timeout: 10000
        });
        return res.data;
    }
    /**
     * 发送异步 skill prompt
     */
    async sendPrompt(sessionId, message) {
        await axios_1.default.post(`${this.serverUrl}/session/${sessionId}/prompt_async`, { message }, { timeout: 10000 });
    }
    /**
     * 终止 session
     */
    async kill(sessionId) {
        await axios_1.default.delete(`${this.serverUrl}/session/${sessionId}`, { timeout: 10000 });
    }
    /**
     * 检查 Server 是否可达
     */
    async isHealthy() {
        try {
            await axios_1.default.get(`${this.serverUrl}/health`, { timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 等待 Server 启动
     */
    async waitForServer(timeoutMs = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this.isHealthy())
                return;
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('Server not reachable after timeout');
    }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=session-manager.js.map