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
exports.HeartbeatMonitor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("./config");
class HeartbeatMonitor {
    statusPath;
    timeoutMs;
    constructor(projectDir = '.', timeoutMs = config_1.config.timeouts.heartbeatTimeout) {
        this.statusPath = path.join(projectDir, config_1.config.paths.mafwDir, 'STATUS.md');
        this.timeoutMs = timeoutMs;
    }
    /**
     * 检查所有活�?Goal 的心�?   */
    check() {
        const all = this.loadAll();
        const running = all.filter(g => g.state === 'RUNNING');
        const now = Date.now();
        const healthy = [];
        const stuck = [];
        for (const g of running) {
            const lastBeat = new Date(g.lastHeartbeat).getTime();
            if (now - lastBeat > this.timeoutMs) {
                stuck.push(g);
            }
            else {
                healthy.push(g);
            }
        }
        return { healthy, stuck };
    }
    /**
     * 加载所�?Goal 状�?   */
    loadAll() {
        if (!fs.existsSync(this.statusPath))
            return [];
        const content = fs.readFileSync(this.statusPath, 'utf-8');
        return this.parse(content);
    }
    /**
     * 解析�?Goal STATUS.md 格式
     */
    parse(content) {
        const blocks = content.split('---').filter(b => b.trim());
        const goals = [];
        for (const block of blocks) {
            const lines = block.trim().split('\n');
            const parseLine = (key) => {
                const line = lines.find(l => l.trim().startsWith(`${key}:`));
                if (!line)
                    return '';
                const value = line.split(':').slice(1).join(':').trim();
                return value.replace(/^"|"$/g, ''); // 去除引号
            };
            const goalId = parseLine('goalId');
            if (!goalId)
                continue;
            goals.push({
                goalId,
                state: parseLine('state') || 'UNKNOWN',
                loop: parseInt(parseLine('loop'), 10) || 0,
                wave: parseInt(parseLine('wave'), 10) || 0,
                task: parseLine('task') || '',
                progress: parseLine('progress') || '0%',
                lastHeartbeat: parseLine('lastHeartbeat') || new Date().toISOString(),
                sessionId: parseLine('sessionId') || null,
                directory: parseLine('directory') || '.'
            });
        }
        return goals;
    }
}
exports.HeartbeatMonitor = HeartbeatMonitor;
