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
exports.transitionPhase = transitionPhase;
exports.recordSession = recordSession;
exports.updateWaveProgress = updateWaveProgress;
exports.startNextLoop = startNextLoop;
exports.getCurrentPhase = getCurrentPhase;
exports.canExecuteInPhase = canExecuteInPhase;
exports.markSessionDestroyed = markSessionDestroyed;
exports.shouldStartNextLoop = shouldStartNextLoop;
exports.handleLoopEvent = handleLoopEvent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const state_1 = require("../utils/state");
async function transitionPhase(goalId, transition, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const patch = {
        phase: transition.to,
        lastPhase: state.phase,
        updatedAt: new Date().toISOString()
    };
    if (transition.nextAction) {
        patch.nextAction = transition.nextAction;
    }
    if (transition.artifacts) {
        patch.artifacts = { ...state.artifacts, ...transition.artifacts };
    }
    if (transition.totalWaves !== undefined) {
        patch.totalWaves = transition.totalWaves;
    }
    if (transition.metrics) {
        patch.metrics = transition.metrics;
    }
    if (transition.error !== undefined) {
        patch.error = transition.error;
    }
    return (0, state_1.updateState)(goalId, patch, projectDir);
}
async function recordSession(goalId, phase, sessionId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const sessions = { ...state.sessions };
    sessions[phase] = {
        id: sessionId,
        createdAt: new Date().toISOString(),
        active: true
    };
    return (0, state_1.updateState)(goalId, { sessions }, projectDir);
}
async function updateWaveProgress(goalId, currentWave, totalWaves, projectDir = '.') {
    return (0, state_1.updateState)(goalId, { currentWave, totalWaves }, projectDir);
}
async function startNextLoop(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return (0, state_1.updateState)(goalId, {
        loop: state.loop + 1,
        phase: 'PLANNING',
        lastPhase: state.phase,
        currentWave: 0,
        totalWaves: null,
        sessions: {},
        nextAction: 'WAIT_PHASE_COMPLETE',
        artifacts: {},
        error: undefined
    }, projectDir);
}
async function getCurrentPhase(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return state.phase;
}
async function canExecuteInPhase(goalId, requiredPhase, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return state.phase === requiredPhase;
}
async function markSessionDestroyed(goalId, phase, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const sessions = { ...state.sessions };
    if (sessions[phase]) {
        sessions[phase] = {
            ...sessions[phase],
            destroyedAt: new Date().toISOString(),
            active: false
        };
    }
    return (0, state_1.updateState)(goalId, { sessions }, projectDir);
}
async function shouldStartNextLoop(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const reqPath = path.join(projectDir, '.mafw/requests', `${goalId}.json`);
    if (!fs.existsSync(reqPath)) {
        return { should: true, reason: 'no request file, allowing' };
    }
    const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
    if (state.loop >= req.maxLoops) {
        return { should: false, reason: `maxLoops reached (${state.loop}/${req.maxLoops})` };
    }
    return { should: true, reason: 'next loop available' };
}
async function handleLoopEvent(goalId, trigger, data, loopNum, projectDir = '.') {
    return true;
}
//# sourceMappingURL=phase-orchestrator.js.map