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
exports.updateState = updateState;
exports.loadState = loadState;
exports.loadRequest = loadRequest;
exports.loadGoal = loadGoal;
exports.loadWaves = loadWaves;
exports.loadReceipts = loadReceipts;
exports.loadReview = loadReview;
exports.extractGoalId = extractGoalId;
exports.stateExists = stateExists;
exports.initState = initState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * 更新状态文件（主路径，Skill Entry 末尾调用）
 */
async function updateState(goalId, patch, projectDir = '.') {
    const statePath = path.join(projectDir, '.opencode/mafw/state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
        throw new Error(`State file not found: ${statePath}`);
    }
    const current = safeJsonParse(statePath);
    const updated = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
    };
    // 原子写入：先写临时文件，再重命名
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
    // 事件回调：通知 Gateway 状态变更 (fire-and-forget)
    try {
        const gatewayUrl = process.env.MAFW_GATEWAY_URL || 'http://127.0.0.1:3000';
        fetch(`${gatewayUrl}/api/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'state_change', goalId, patch, projectDir }),
            signal: AbortSignal.timeout(500)
        }).catch(() => { });
    }
    catch { }
    return updated;
}
function safeJsonParse(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch (err) {
        throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }
}
/**
 * 加载状态文件
 */
async function loadState(goalId, projectDir = '.') {
    const statePath = path.join(projectDir, '.opencode/mafw/state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
        throw new Error(`State file not found: ${statePath}`);
    }
    return safeJsonParse(statePath);
}
/**
 * 加载请求配置
 */
async function loadRequest(goalId, projectDir = '.') {
    const reqPath = path.join(projectDir, '.opencode/mafw/requests', `${goalId}.json`);
    if (!fs.existsSync(reqPath)) {
        throw new Error(`Request file not found: ${reqPath}`);
    }
    return safeJsonParse(reqPath);
}
/**
 * 加载 Goal Charter
 */
async function loadGoal(goalId, projectDir = '.') {
    const goalPath = path.join(projectDir, '.opencode/mafw/goals', `${goalId}.md`);
    if (!fs.existsSync(goalPath)) {
        throw new Error(`Goal Charter not found: ${goalPath}`);
    }
    return fs.readFileSync(goalPath, 'utf-8');
}
/**
 * 加载 Waves 配置
 */
async function loadWaves(goalId, projectDir = '.') {
    const wavesPath = path.join(projectDir, '.opencode/mafw/waves.json');
    if (!fs.existsSync(wavesPath)) {
        return [];
    }
    const data = safeJsonParse(wavesPath);
    return data.waves || [];
}
/**
 * 加载 Receipts
 */
async function loadReceipts(goalId, projectDir = '.') {
    const receiptsDir = path.join(projectDir, '.opencode/mafw/receipts', goalId);
    if (!fs.existsSync(receiptsDir)) {
        return [];
    }
    const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith('.json'));
    return files.map(f => safeJsonParse(path.join(receiptsDir, f)));
}
/**
 * 加载 Review 文件
 */
async function loadReview(goalId, loop, projectDir = '.') {
    const reviewPath = path.join(projectDir, '.opencode/mafw/reviews', `${goalId}-loop${loop}.md`);
    if (!fs.existsSync(reviewPath)) {
        return null;
    }
    return fs.readFileSync(reviewPath, 'utf-8');
}
/**
 * 提取 Goal ID 从消息
 */
function extractGoalId(message) {
    const parts = message.trim().split(/\s+/).filter(Boolean);
    // 支持格式: /skill mafw-plan 001-auth
    return parts[parts.length - 1] || '';
}
/**
 * 检查状态文件是否存在
 */
function stateExists(goalId, projectDir = '.') {
    const statePath = path.join(projectDir, '.opencode/mafw/state', `${goalId}.json`);
    return fs.existsSync(statePath);
}
/**
 * 初始化新 Goal 的状态文件
 */
function initState(goalId, projectDir = '.') {
    const stateDir = path.join(projectDir, '.opencode/mafw/state');
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }
    const state = {
        version: '2',
        goalId,
        loop: 1,
        phase: 'PLANNING',
        lastPhase: null,
        currentWave: 0,
        totalWaves: null,
        sessions: {},
        nextAction: 'CREATE_PLAN_SESSION',
        artifacts: {},
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(stateDir, `${goalId}.json`), JSON.stringify(state, null, 2), 'utf-8');
}
//# sourceMappingURL=state.js.map