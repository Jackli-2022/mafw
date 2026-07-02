"use strict";
/**
 * Automation Engine — Gateway 子模块
 *
 * 职责：
 *   1. 读取 automations/*.json 规则
 *   2. 注册 Cron 定时器
 *   3. 触发 Skill 执行发现
 *   4. 处理结果 → Triage 或 Goal
 *
 * 核心原则：只发现工作，不执行工作
 */
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
exports.AutomationEngine = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AutomationEngine {
    rules = new Map();
    timers = new Map();
    mafwDir;
    constructor(mafwDir) {
        this.mafwDir = mafwDir;
    }
    /**
     * 加载所有自动化规则
     */
    loadRules() {
        const autoDir = path.join(this.mafwDir, 'automations');
        if (!fs.existsSync(autoDir))
            return;
        const files = fs.readdirSync(autoDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const rule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
                if (rule.enabled) {
                    this.rules.set(rule.id, rule);
                }
            }
            catch (err) {
                console.warn(`[AutomationEngine] Failed to load rule ${file}: ${err.message}`);
            }
        }
        console.log(`[AutomationEngine] Loaded ${this.rules.size} automation rules`);
    }
    /**
     * 启动所有定时器
     */
    start() {
        for (const [id, rule] of this.rules) {
            this.scheduleRule(id, rule);
        }
    }
    /**
     * 停止所有定时器
     */
    stop() {
        for (const [id, timer] of this.timers) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
    }
    /**
     * 调度单个规则
     */
    scheduleRule(id, rule) {
        // 简化实现：使用 setTimeout 模拟 cron
        // 实际实现应使用 node-cron 库
        console.log(`[AutomationEngine] Scheduled rule ${id}: ${rule.trigger.schedule}`);
    }
    /**
     * 执行规则（触发 Skill）
     */
    async executeRule(id) {
        const rule = this.rules.get(id);
        if (!rule) {
            console.warn(`[AutomationEngine] Rule not found: ${id}`);
            return;
        }
        console.log(`[AutomationEngine] Executing rule ${id}: ${rule.skill}`);
        // 创建 Triage 或 Goal
        if (rule.onResult.type === 'triage') {
            await this.createTriage(id, rule);
        }
        else {
            await this.createGoal(id, rule);
        }
    }
    /**
     * 创建 Triage 项
     */
    async createTriage(automationId, rule) {
        const triageDir = path.join(this.mafwDir, 'triage');
        if (!fs.existsSync(triageDir))
            fs.mkdirSync(triageDir, { recursive: true });
        const triageId = `triage-${Date.now()}`;
        const triageFile = path.join(triageDir, `${triageId}.json`);
        fs.writeFileSync(triageFile, JSON.stringify({
            id: triageId,
            automationId,
            discoveredAt: new Date().toISOString(),
            source: rule.skill,
            summary: {},
            proposedGoal: {
                title: rule.onResult.template || `Automation: ${rule.id}`,
                boundaries: [],
                estimatedLoops: rule.goal_defaults?.maxLoops || 3
            },
            state: 'PENDING_CONFIRMATION',
            userAction: null,
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }, null, 2));
        console.log(`[AutomationEngine] Created triage: ${triageId}`);
    }
    /**
     * 创建 Goal（直接执行，无需 Triage）
     */
    async createGoal(automationId, rule) {
        // 直接写入 requests/ 和 state/
        console.log(`[AutomationEngine] Direct goal creation not yet implemented for ${automationId}`);
    }
}
exports.AutomationEngine = AutomationEngine;
//# sourceMappingURL=automation-engine.js.map