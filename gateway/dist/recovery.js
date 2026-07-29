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
exports.RecoveryManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MAFW_DIR = '.mafw';
/**
 * Recovery �?崩溃恢复�? *
 * Scheduler 重启后：
 *   1. 读取 STATUS.md，找到所�?RUNNING 状态的 Goal
 *   2. 尝试找到最近的 Checkpoint
 *   3. 重新创建 session 并启�?Loop
 */
class RecoveryManager {
    projectDir;
    constructor(projectDir = '.') {
        this.projectDir = projectDir;
    }
    get mafwDir() {
        return path.join(this.projectDir, MAFW_DIR);
    }
    /**
     * 查找最近的 Checkpoint
     */
    findLastCheckpoint(goalId) {
        const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
        if (!fs.existsSync(checkpointsDir))
            return null;
        const files = fs.readdirSync(checkpointsDir)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
            const numA = parseInt(a.match(/(\d+)\.json$/)[1], 10);
            const numB = parseInt(b.match(/(\d+)\.json$/)[1], 10);
            return numB - numA;
        });
        return files.length > 0 ? path.join(checkpointsDir, files[0]) : null;
    }
    /**
     * 保存 Checkpoint
     */
    saveCheckpoint(goalId, loop, data, waveNum) {
        const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
        if (!fs.existsSync(checkpointsDir))
            fs.mkdirSync(checkpointsDir, { recursive: true });
        const name = waveNum !== undefined
            ? `wave-${loop}-${waveNum}.json`
            : `loop-${loop}.json`;
        const checkpointPath = path.join(checkpointsDir, name);
        const checkpoint = {
            goalId, loop, wave: waveNum,
            timestamp: new Date().toISOString(),
            ...data
        };
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    }
    /**
     * 加载 Checkpoint
     */
    loadCheckpoint(checkpointPath) {
        if (!fs.existsSync(checkpointPath))
            return null;
        return JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    }
    async restoreLoop(goalId, loop, targetWaveNum) {
        const checkpointsDir = path.join(this.mafwDir, 'checkpoints', goalId);
        if (!fs.existsSync(checkpointsDir))
            return false;
        const pattern = targetWaveNum !== undefined
            ? `wave-${loop}-${targetWaveNum}.json`
            : `loop-${loop}.json`;
        const cpPath = path.join(checkpointsDir, pattern);
        if (!fs.existsSync(cpPath))
            return false;
        const checkpoint = this.loadCheckpoint(cpPath);
        if (!checkpoint)
            return false;
        // Restore state file
        const statePath = path.join(this.mafwDir, 'state', `${goalId}.json`);
        if (fs.existsSync(statePath)) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            state.phase = checkpoint.phase || 'PLANNING';
            state.currentWave = targetWaveNum ?? state.currentWave;
            state.updatedAt = new Date().toISOString();
            state.error = undefined;
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
        }
        // Truncate waves.json to remove waves after the rollback point
        if (targetWaveNum !== undefined) {
            const wavesPath = path.join(this.mafwDir, 'waves.json');
            if (fs.existsSync(wavesPath)) {
                const wavesData = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
                wavesData.waves = (wavesData.waves || []).filter((w) => w.waveNum <= targetWaveNum);
                fs.writeFileSync(wavesPath, JSON.stringify(wavesData, null, 2), 'utf-8');
            }
        }
        return true;
    }
    /**
     * 恢复所有需要重启的 Goal
     */
    async recoverAll(callback) {
        const statusPath = path.join(this.mafwDir, 'STATUS.md');
        if (!fs.existsSync(statusPath))
            return;
        const content = fs.readFileSync(statusPath, 'utf-8');
        const blocks = content.split('---').filter(b => b.trim());
        for (const block of blocks) {
            const lines = block.trim().split('\n');
            const parseLine = (key) => {
                const line = lines.find(l => l.trim().startsWith(`${key}:`));
                return line ? line.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '') : '';
            };
            const goalId = parseLine('goalId');
            const state = parseLine('state');
            if (!goalId || state !== 'RUNNING')
                continue;
            const checkpoint = this.findLastCheckpoint(goalId);
            console.log(`[Recovery] Goal ${goalId} needs restart, checkpoint: ${checkpoint || 'none'}`);
            await callback(goalId, checkpoint);
        }
    }
}
exports.RecoveryManager = RecoveryManager;
