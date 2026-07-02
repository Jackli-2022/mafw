"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class RequestManager {
    requestsDir;
    constructor(projectDir = '.') {
        this.requestsDir = path.join(projectDir, '.opencode/mafw/requests');
        if (!fs.existsSync(this.requestsDir)) {
            fs.mkdirSync(this.requestsDir, { recursive: true });
        }
    }
    /**
     * 加载所有请求文件
     */
    loadAll() {
        const files = fs.readdirSync(this.requestsDir).filter(f => f.endsWith('.json'));
        return files.map(f => this.load(f.replace('.json', ''))).filter(Boolean);
    }
    /**
     * 加载单个请求
     */
    load(goalId) {
        const p = path.join(this.requestsDir, `${goalId}.json`);
        if (!fs.existsSync(p))
            return null;
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    /**
     * 更新请求状态
     */
    updateState(goalId, state, sessionId) {
        const req = this.load(goalId);
        if (!req)
            return;
        req.state = state;
        req.updatedAt = new Date().toISOString();
        if (sessionId)
            req.sessionId = sessionId;
        this.save(req);
    }
    /**
     * 保存请求
     */
    save(req) {
        const p = path.join(this.requestsDir, `${req.goalId}.json`);
        fs.writeFileSync(p, JSON.stringify(req, null, 2), 'utf-8');
    }
    /**
     * 查找 PENDING 状态的请求
     */
    findPending() {
        return this.loadAll().filter(r => r.state === 'PENDING');
    }
    /**
     * 查找 RUNNING 状态的请求
     */
    findRunning() {
        return this.loadAll().filter(r => r.state === 'RUNNING');
    }
    /**
     * 移动已完成的请求到 processed/
     */
    archive(goalId) {
        const src = path.join(this.requestsDir, `${goalId}.json`);
        const processedDir = path.join(this.requestsDir, '../processed');
        if (!fs.existsSync(processedDir))
            fs.mkdirSync(processedDir, { recursive: true });
        const dest = path.join(processedDir, `${goalId}.json`);
        if (fs.existsSync(src)) {
            fs.renameSync(src, dest);
        }
    }
}
exports.RequestManager = RequestManager;
//# sourceMappingURL=poll.js.map