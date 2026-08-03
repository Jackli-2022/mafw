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
const logger_1 = require("./core/utils/logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MAFW_DIR = '.mafw';
/**
 * Recovery 锟?宕╂簝鎭㈠锟? *
 * Scheduler 閲嶅惎鍚庯細
 *   1. 璇诲彇 STATUS.md锛屾壘鍒版墍锟?RUNNING 鐘舵€佺殑 Goal
 *   2. 灏濊瘯鎵惧埌鏈€杩戠殑 Checkpoint
 *   3. 閲嶆柊鍒涘缓 session 骞跺惎锟?Loop
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
     * 鏌ユ壘鏈€杩戠殑 Checkpoint
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
     * 淇濆瓨 Checkpoint
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
     * 鍔犺浇 Checkpoint
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
     * 鎭㈠鎵€鏈夐渶瑕侀噸鍚殑 Goal
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
            logger_1.log.info(`[Recovery] Goal ${goalId} needs restart, checkpoint: ${checkpoint || 'none'}`);
            await callback(goalId, checkpoint);
        }
    }
}
exports.RecoveryManager = RecoveryManager;
