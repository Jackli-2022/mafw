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
exports.sessionEndingHook = sessionEndingHook;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const state_1 = require("../utils/state");
async function sessionEndingHook(hookContext) {
    const sessionId = hookContext.sessionId;
    const projectDir = hookContext.projectDir || process.cwd();
    const mafwDir = path.join(projectDir, '.opencode/mafw');
    const stateDir = path.join(mafwDir, 'state');
    console.log(`[hook:session-ending] Session ${sessionId} ending`);
    // 1. 遍历所有 state 文件，找到包含该 sessionId 的 goal
    if (!fs.existsSync(stateDir)) {
        console.warn(`[hook:session-ending] State directory not found: ${stateDir}`);
        return;
    }
    const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    let targetGoalId = null;
    let targetPhase = null;
    for (const file of stateFiles) {
        const statePath = path.join(stateDir, file);
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            for (const [phase, session] of Object.entries(state.sessions || {})) {
                const sess = session;
                if (sess.id === sessionId && sess.active) {
                    targetGoalId = state.goalId;
                    targetPhase = phase;
                    break;
                }
            }
            if (targetGoalId)
                break;
        }
        catch (err) {
            console.warn(`[hook:session-ending] Failed to parse ${file}: ${err.message}`);
        }
    }
    if (!targetGoalId) {
        console.warn(`[hook:session-ending] No active state found for session ${sessionId}`);
        return;
    }
    console.log(`[hook:session-ending] Found session ${sessionId} in goal ${targetGoalId} phase ${targetPhase}`);
    // 2. 兜底检查：如果 state 的 nextAction 还是 WAIT_PHASE_COMPLETE，
    // 说明 Skill Entry 没来得及更新 state（异常或超时）
    try {
        const state = await (0, state_1.loadState)(targetGoalId, projectDir);
        if (state.nextAction === 'WAIT_PHASE_COMPLETE') {
            console.warn(`[hook:session-ending] Session ${sessionId} (${targetPhase}) ended without state update for ${targetGoalId}`);
            // 写入异常状态，让 Scheduler 重建
            await (0, state_1.updateState)(targetGoalId, {
                nextAction: `CREATE_${targetPhase.toUpperCase()}_SESSION`,
                error: 'session_ended_without_state_update',
                sessions: {
                    ...state.sessions,
                    [targetPhase]: {
                        ...state.sessions[targetPhase],
                        destroyedAt: new Date().toISOString(),
                        active: false
                    }
                }
            }, projectDir);
            console.log(`[hook:session-ending] Recovery state written for ${targetGoalId}: CREATE_${targetPhase.toUpperCase()}_SESSION`);
        }
        else {
            console.log(`[hook:session-ending] State already updated for ${targetGoalId}: ${state.nextAction}`);
        }
    }
    catch (err) {
        console.error(`[hook:session-ending] Failed to check state for ${targetGoalId}: ${err.message}`);
    }
}
//# sourceMappingURL=session-ending.js.map