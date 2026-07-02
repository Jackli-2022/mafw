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
exports.getCurrentPhase = getCurrentPhase;
exports.canExecuteInPhase = canExecuteInPhase;
exports.recordSession = recordSession;
exports.markSessionDestroyed = markSessionDestroyed;
exports.updateWaveProgress = updateWaveProgress;
exports.shouldStartNextLoop = shouldStartNextLoop;
exports.startNextLoop = startNextLoop;
exports.createLoopStateMachine = createLoopStateMachine;
exports.clearLoopMachineCache = clearLoopMachineCache;
exports.handleLoopEvent = handleLoopEvent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const state_1 = require("../utils/state");
const loop_state_machine_1 = require("./loop-state-machine");
const VALID_TRANSITIONS = {
    'PLANNING': ['PLANNING_COMPLETE'],
    'PLANNING_COMPLETE': ['EXECUTING'],
    'EXECUTING': ['EXECUTING_COMPLETE'],
    'EXECUTING_COMPLETE': ['REVIEWING'],
    'REVIEWING': ['REVIEWING_COMPLETE'],
    'REVIEWING_COMPLETE': ['PLANNING', 'ARCHIVED'],
    'ARCHIVED': ['COMPLETED'],
    'COMPLETED': [],
    'FAILED': [],
    'WAVE_CHECK': ['WAVE_READY', 'REVIEWING'],
    'WAVE_RETRY': ['WAVE_READY']
};
const NEXT_ACTION_MAP = {
    'PLANNING_COMPLETE': 'CREATE_EXECUTE_SESSION',
    'EXECUTING_COMPLETE': 'CREATE_REVIEW_SESSION',
    'REVIEWING_COMPLETE': 'ARCHIVE',
    'ARCHIVED': 'COMPLETED'
};
/**
 * 验证并执行 Phase 转换
 */
async function transitionPhase(goalId, transition, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    // 验证转换合法性
    const validNext = VALID_TRANSITIONS[state.phase || ''] || [];
    if (!validNext.includes(transition.to)) {
        throw new Error(`Invalid phase transition: ${state.phase} → ${transition.to}`);
    }
    // 计算 nextAction
    const nextAction = transition.nextAction || NEXT_ACTION_MAP[transition.to] || 'WAIT_PHASE_COMPLETE';
    // 更新状态
    const patch = {
        phase: transition.to,
        lastPhase: state.phase,
        nextAction,
        updatedAt: new Date().toISOString()
    };
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
/**
 * 获取当前 Phase 信息
 */
async function getCurrentPhase(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return state.phase;
}
/**
 * 检查是否可以在当前 Phase 执行特定操作
 */
async function canExecuteInPhase(goalId, requiredPhase, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return state.phase === requiredPhase;
}
/**
 * 记录 Session 信息
 */
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
/**
 * 标记 Session 已销毁
 */
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
/**
 * 更新 Wave 进度
 */
async function updateWaveProgress(goalId, currentWave, totalWaves, projectDir = '.') {
    return (0, state_1.updateState)(goalId, { currentWave, totalWaves }, projectDir);
}
/**
 * 检查是否应该进入下一轮 Loop
 */
async function shouldStartNextLoop(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    const req = JSON.parse(fs.readFileSync(path.join(projectDir, '.opencode/mafw/requests', `${goalId}.json`), 'utf-8'));
    if (state.loop >= req.maxLoops) {
        return { should: false, reason: `maxLoops reached (${state.loop}/${req.maxLoops})` };
    }
    return { should: true, reason: 'next loop available' };
}
/**
 * 进入下一轮 Loop
 */
async function startNextLoop(goalId, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    return (0, state_1.updateState)(goalId, {
        loop: state.loop + 1,
        phase: 'PLANNING',
        lastPhase: state.phase,
        currentWave: 0,
        totalWaves: null,
        sessions: {},
        nextAction: 'CREATE_PLAN_SESSION',
        artifacts: {},
        error: undefined
    }, projectDir);
}
/**
 * 创建 Loop 状态机实例
 */
const loopMachines = new Map();
function createLoopStateMachine(goalId, loopNum, projectDir = '.') {
    const key = `${goalId}:${loopNum}:${path.resolve(projectDir)}`;
    if (loopMachines.has(key)) {
        return loopMachines.get(key);
    }
    const machine = new loop_state_machine_1.LoopStateMachineImpl(goalId, loopNum, projectDir);
    loopMachines.set(key, machine);
    return machine;
}
/** Clear cached loop machine instances (for testing) */
function clearLoopMachineCache() {
    loopMachines.clear();
}
/**
 * 处理 Loop 事件（包裹状态机 handleEvent）
 * 自动从 state.json 同步当前 Phase → LoopState
 */
async function handleLoopEvent(goalId, trigger, data, loopNum, projectDir = '.') {
    const state = await (0, state_1.loadState)(goalId, projectDir);
    if (loopNum === undefined) {
        loopNum = state.loop;
    }
    const machine = createLoopStateMachine(goalId, loopNum, projectDir);
    // 从 state.json phase → LoopState 同步
    const phase = state.phase || '';
    const basePhase = phase.replace(/_COMPLETE$/, '');
    const phaseStateMap = {
        'IDLE': loop_state_machine_1.LoopState.IDLE,
        'PLANNING': loop_state_machine_1.LoopState.PLANNING,
        'PLANNING_COMPLETE': loop_state_machine_1.LoopState.PLANNING,
        'WAVE_READY': loop_state_machine_1.LoopState.WAVE_READY,
        'EXECUTING': loop_state_machine_1.LoopState.EXECUTING,
        'EXECUTING_COMPLETE': loop_state_machine_1.LoopState.EXECUTING,
        'WAVE_CHECK': loop_state_machine_1.LoopState.WAVE_CHECK,
        'REVIEWING': loop_state_machine_1.LoopState.REVIEWING,
        'REVIEWING_COMPLETE': loop_state_machine_1.LoopState.REVIEWING,
        'WAVE_RETRY': loop_state_machine_1.LoopState.WAVE_RETRY,
        'VERDICT': loop_state_machine_1.LoopState.VERDICT,
        'ARCHIVED': loop_state_machine_1.LoopState.PASS,
        'FAILED': loop_state_machine_1.LoopState.FAIL,
    };
    if (phase in phaseStateMap) {
        machine.state = phaseStateMap[phase];
    }
    else if (basePhase in phaseStateMap) {
        machine.state = phaseStateMap[basePhase];
    }
    return machine.handleEvent(trigger, data);
}
//# sourceMappingURL=phase-orchestrator.js.map