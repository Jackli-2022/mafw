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
exports.StatusManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class StatusManager {
    statusPath;
    constructor(projectDir = '.') {
        this.statusPath = path.join(projectDir, '.opencode/mafw/STATUS.md');
    }
    /**
     * 读取所有 Goal 状态
     */
    readAll() {
        if (!fs.existsSync(this.statusPath))
            return [];
        const content = fs.readFileSync(this.statusPath, 'utf-8');
        return this.parse(content);
    }
    /**
     * 读取单个 Goal 状态
     */
    read(goalId) {
        return this.readAll().find(g => g.goalId === goalId) || null;
    }
    /**
     * 更新或创建 Goal 状态
     */
    update(goalId, updates) {
        const all = this.readAll();
        const idx = all.findIndex(g => g.goalId === goalId);
        if (idx >= 0) {
            all[idx] = { ...all[idx], ...updates, lastHeartbeat: new Date().toISOString() };
        }
        else {
            all.push({
                goalId,
                state: 'UNKNOWN',
                loop: 0,
                wave: 0,
                task: '',
                progress: '0%',
                lastHeartbeat: new Date().toISOString(),
                sessionId: null,
                directory: '.',
                ...updates
            });
        }
        this.write(all);
    }
    /**
     * 解析多 Goal STATUS.md
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
                return value.replace(/^"|"$/g, '');
            };
            const goalId = parseLine('goalId');
            if (!goalId)
                continue;
            const sessionId = parseLine('sessionId');
            goals.push({
                goalId,
                state: parseLine('state') || 'UNKNOWN',
                loop: parseInt(parseLine('loop'), 10) || 0,
                wave: parseInt(parseLine('wave'), 10) || 0,
                task: parseLine('task') || '',
                progress: parseLine('progress') || '0%',
                lastHeartbeat: parseLine('lastHeartbeat') || new Date().toISOString(),
                sessionId: sessionId === 'null' || !sessionId ? null : sessionId,
                directory: parseLine('directory') || '.'
            });
        }
        return goals;
    }
    /**
     * 写入多 Goal STATUS.md
     */
    write(goals) {
        const lines = [
            '# MAFW Status',
            '',
            `lastUpdated: "${new Date().toISOString()}"`,
            `activeGoals: ${goals.filter(g => g.state === 'RUNNING').length}`,
            ''
        ];
        for (const g of goals) {
            lines.push('---');
            lines.push(`goalId: "${g.goalId}"`);
            lines.push(`state: "${g.state}"`);
            lines.push(`loop: ${g.loop}`);
            lines.push(`wave: ${g.wave}`);
            lines.push(`task: "${g.task}"`);
            lines.push(`progress: "${g.progress}"`);
            lines.push(`lastHeartbeat: "${g.lastHeartbeat}"`);
            lines.push(`sessionId: ${g.sessionId ? `"${g.sessionId}"` : 'null'}`);
            lines.push(`directory: "${g.directory}"`);
            lines.push('');
        }
        fs.writeFileSync(this.statusPath, lines.join('\n'), 'utf-8');
    }
    /**
     * 检查是否卡死（5 分钟无更新）
     */
    isStuck(goalId) {
        const goal = this.read(goalId);
        if (!goal)
            return false;
        const lastUpdate = new Date(goal.lastHeartbeat).getTime();
        return (Date.now() - lastUpdate) > 5 * 60 * 1000;
    }
}
exports.StatusManager = StatusManager;
//# sourceMappingURL=status.js.map