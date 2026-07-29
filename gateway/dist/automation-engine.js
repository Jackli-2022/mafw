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
exports.AutomationEngine = exports.actionRegistry = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cron_1 = require("cron");
const harmonic_index_1 = require("./core/memory/harmonic-index");
const energy_system_1 = require("./core/memory/energy-system");
const review_scheduler_1 = require("./core/memory/review-scheduler");
const cognitive_graph_1 = require("./core/memory/cognitive-graph");
const abstraction_distiller_1 = require("./core/memory/abstraction-distiller");
exports.actionRegistry = new Map();
exports.actionRegistry.set('memory:distill', async (_rule, engine) => {
    console.log('[AutomationEngine] Starting memory distillation...');
    const indexManager = new harmonic_index_1.HarmonicIndexManager(engine.mafwDir);
    const result = await (0, abstraction_distiller_1.runDistillation)(indexManager, engine.mafwDir);
    console.log(`[AutomationEngine] Distillation complete: created ${result.created}, locked ${result.locked}`);
});
exports.actionRegistry.set('memory:decay', async (_rule, engine) => {
    console.log('[AutomationEngine] Running energy decay...');
    const indexManager = new harmonic_index_1.HarmonicIndexManager(engine.mafwDir);
    const index = indexManager.getIndex();
    const energySystem = new energy_system_1.EnergySystem();
    let decayed = 0;
    for (const entry of index.entries) {
        const salience = entry.salience || 1.0;
        const daysSinceUpdate = entry.energy > 0 ? 1 : 0;
        const newEnergy = energySystem.calculateEnergy(entry.energy, { type: 'retrieved' }, daysSinceUpdate, salience, entry.id);
        const diff = entry.energy - newEnergy;
        if (diff > 0.005) {
            indexManager.updateEnergy(entry.id, -(diff));
            decayed++;
        }
    }
    console.log(`[AutomationEngine] Energy decay applied to ${decayed} entries`);
});
exports.actionRegistry.set('memory:review', async (_rule, engine) => {
    console.log('[AutomationEngine] Checking review queue...');
    const indexManager = new harmonic_index_1.HarmonicIndexManager(engine.mafwDir);
    const scheduler = new review_scheduler_1.ReviewScheduler(indexManager, engine.mafwDir);
    scheduler.tick();
    const queue = scheduler.getReviewQueue();
    console.log(`[AutomationEngine] Review queue: ${queue.length} items due`);
});
exports.actionRegistry.set('memory:prune', async (_rule, engine) => {
    console.log('[AutomationEngine] Pruning cognitive graph...');
    const graph = new cognitive_graph_1.CognitiveGraphManager(engine.mafwDir);
    const before = graph.getGraph().edges.length;
    graph.prune(0.1);
    const after = graph.getGraph().edges.length;
    const pruned = before - after;
    if (pruned > 0) {
        console.log(`[AutomationEngine] Pruned ${pruned} low-weight edges`);
    }
    else {
        console.log('[AutomationEngine] No edges to prune');
    }
});
class AutomationEngine {
    rules = new Map();
    jobs = new Map();
    mafwDir;
    _ledger;
    constructor(mafwDir) {
        this.mafwDir = mafwDir;
    }
    setLedger(ledger) {
        this._ledger = ledger;
    }
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
    start() {
        for (const [id, rule] of this.rules) {
            // Defensive: trigger may be null despite earlier validation (fall-through)
            if (rule.trigger?.type === 'cron') {
                this.scheduleRule(id, rule);
            }
            else {
                this.scheduleEventRule(id, rule);
            }
        }
    }
    stop() {
        for (const [id, job] of this.jobs) {
            job.stop();
            this.jobs.delete(id);
        }
        console.log(`[AutomationEngine] Stopped ${this.jobs.size} jobs`);
    }
    scheduleRule(id, rule) {
        try {
            const cronTrigger = rule.trigger;
            const job = new cron_1.CronJob(cronTrigger.schedule, () => this.executeRule(id, 'cron', this._ledger), null, true, cronTrigger.timezone);
            this.jobs.set(id, job);
            console.log(`[AutomationEngine] Scheduled rule ${id}: ${cronTrigger.schedule} (${cronTrigger.timezone})`);
        }
        catch (err) {
            console.warn(`[AutomationEngine] Failed to schedule rule ${id}: ${err.message}`);
        }
    }
    scheduleEventRule(_id, _rule) {
        // Stub — will be implemented in Task 8
    }
    async executeRule(id, source, ledger) {
        const rule = this.rules.get(id);
        if (!rule) {
            console.warn(`[AutomationEngine] Rule not found: ${id}`);
            return;
        }
        console.log(`[AutomationEngine] Executing rule ${id}${rule.action ? ` [action: ${rule.action.type}]` : ''} (source=${source || 'cron'})`);
        if (rule.action) {
            await this.executeAction(rule.action.type, rule);
            if (ledger) {
                ledger.append({
                    timestamp: new Date().toISOString(),
                    event: 'AUTOMATION_TRIGGERED',
                    ruleId: id,
                    source: source || 'cron',
                    reason: `action:${rule.action.type}`,
                });
            }
            return;
        }
        if (!rule.onResult || !rule.skill) {
            console.log(`[AutomationEngine] Rule ${id} has no action, skill, or onResult �?skipping`);
            return;
        }
        if (rule.onResult.type === 'triage') {
            await this.createTriage(id, rule);
        }
        else {
            await this.createGoal(id, rule);
        }
        if (ledger) {
            ledger.append({
                timestamp: new Date().toISOString(),
                event: 'AUTOMATION_TRIGGERED',
                ruleId: id,
                source: source || 'cron',
                reason: rule.skill ? `skill:${rule.skill}` : 'unknown',
                details: rule.onResult ? { onResultType: rule.onResult.type } : undefined,
            });
        }
    }
    async executeAction(actionType, rule) {
        const handler = exports.actionRegistry.get(actionType);
        if (!handler) {
            console.warn(`[AutomationEngine] No handler registered for action: ${actionType}`);
            return;
        }
        try {
            await handler(rule, this);
        }
        catch (err) {
            console.error(`[AutomationEngine] Action ${actionType} failed: ${err.message}`);
        }
    }
    async createTriage(automationId, rule) {
        const triageDir = path.join(this.mafwDir, 'triage');
        if (!fs.existsSync(triageDir))
            fs.mkdirSync(triageDir, { recursive: true });
        const triageId = `triage-${Date.now()}`;
        const triageFile = path.join(triageDir, `${triageId}.json`);
        const onResult = rule.onResult;
        fs.writeFileSync(triageFile, JSON.stringify({
            id: triageId,
            automationId,
            discoveredAt: new Date().toISOString(),
            source: rule.skill,
            summary: {},
            proposedGoal: {
                title: onResult.template || `Automation: ${rule.id}`,
                boundaries: [],
                estimatedLoops: rule.goal_defaults?.maxLoops || 3,
            },
            state: 'PENDING_CONFIRMATION',
            userAction: null,
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            llmSuggestions: [],
            updatedAt: new Date().toISOString(),
        }, null, 2));
        console.log(`[AutomationEngine] Created triage: ${triageId}`);
    }
    async createGoal(automationId, rule) {
        const requestsDir = path.join(this.mafwDir, 'requests');
        if (!fs.existsSync(requestsDir)) {
            fs.mkdirSync(requestsDir, { recursive: true });
        }
        const goalId = `auto-${automationId}-${Date.now()}`;
        const requestFile = path.join(requestsDir, `${goalId}.json`);
        const stateDir = path.join(this.mafwDir, 'state');
        if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
        }
        const stateFile = path.join(stateDir, `${goalId}.json`);
        const onResult = rule.onResult;
        const goalContent = {
            goalId,
            source: 'automation',
            automationId,
            title: onResult.template || `Automation: ${rule.id}`,
            args: rule.args || {},
            maxLoops: rule.goal_defaults?.maxLoops || 3,
            metrics: rule.goal_defaults?.metrics || {},
            createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(requestFile, JSON.stringify(goalContent, null, 2), 'utf-8');
        const initialState = {
            version: '2',
            goalId,
            loop: 1,
            phase: 'PENDING',
            nextAction: 'START',
            error: null,
            updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2), 'utf-8');
        console.log(`[AutomationEngine] Created goal: ${goalId}`);
    }
    // ── Tier 1: Read-only methods ──
    getRules() {
        const rules = Array.from(this.rules.values());
        const autoDir = path.join(this.mafwDir, 'automations');
        if (fs.existsSync(autoDir)) {
            for (const file of fs.readdirSync(autoDir).filter((f) => f.endsWith('.json'))) {
                try {
                    const rule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
                    rule.id = file.replace('.json', '');
                    if (!rules.find(r => r.id === rule.id)) {
                        rules.push(rule);
                    }
                }
                catch { /* skip corrupt files */ }
            }
        }
        return rules;
    }
    getRule(id) {
        const cached = this.rules.get(id);
        if (cached)
            return cached;
        const filePath = path.join(this.mafwDir, 'automations', `${id}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const rule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                rule.id = id;
                return rule;
            }
            catch { /* fall through */ }
        }
        return undefined;
    }
    getNextTriggers(rule, count = 5) {
        if (rule.trigger.type !== 'cron')
            return { next5: [] };
        const cronTrigger = rule.trigger;
        const next5 = [];
        try {
            const job = new cron_1.CronJob(cronTrigger.schedule, () => { }, null, false, cronTrigger.timezone);
            const dates = job.nextDates(count);
            for (const dt of dates) {
                next5.push(dt.toJSDate().toISOString());
            }
            job.stop();
        }
        catch {
            // invalid cron —return empty
        }
        return { next5 };
    }
    // ── Tier 2: Safe action methods ──
    async runRuleFromLLM(id, ledger) {
        const rule = this.rules.get(id);
        if (!rule)
            throw new Error(`Rule not found: ${id}`);
        if (!rule.action && !rule.skill) {
            throw new Error(`Rule ${id} has no action or skill �?nothing to run`);
        }
        console.log(`[AutomationEngine] LLM triggered rule ${id}`);
        if (rule.action) {
            await this.executeAction(rule.action.type, rule);
            ledger.append({
                timestamp: new Date().toISOString(),
                event: 'AUTOMATION_TRIGGERED',
                ruleId: id,
                source: 'llm',
                reason: `action:${rule.action.type} (LLM-triggered)`,
            });
            return { triageId: '', message: `Action ${rule.action.type} executed` };
        }
        const triageId = await this.llmCreateTriage(id, rule);
        ledger.append({
            timestamp: new Date().toISOString(),
            event: 'AUTOMATION_TRIGGERED',
            ruleId: id,
            source: 'llm',
            reason: `scan:${rule.skill}`,
            details: { triageId, autoConfirmForced: true },
        });
        return { triageId, message: `Scan complete �?triage item ${triageId} created (pending your confirmation)` };
    }
    validateRule(rule) {
        const errors = [];
        if (!rule.id || typeof rule.id !== 'string') {
            errors.push('Rule must have a string id');
        }
        if (!rule.trigger || (rule.trigger.type !== 'cron' && rule.trigger.type !== 'event')) {
            errors.push('Trigger type must be "cron" or "event"');
        }
        if (rule.trigger?.type === 'cron') {
            const ct = rule.trigger;
            if (typeof ct.schedule !== 'string' || ct.schedule.trim() === '') {
                errors.push('Schedule must be a non-empty cron expression');
            }
            else {
                try {
                    const job = new cron_1.CronJob(ct.schedule, () => { }, null, false, ct.timezone || 'UTC');
                    job.stop();
                }
                catch (e) {
                    errors.push(`Invalid cron expression: ${e.message}`);
                }
            }
            if (ct.timezone && !Intl.supportedValuesOf?.('timeZone')?.includes(ct.timezone)) {
                try {
                    new Intl.DateTimeFormat(undefined, { timeZone: ct.timezone });
                }
                catch {
                    errors.push(`Invalid timezone: ${ct.timezone}`);
                }
            }
        }
        if (rule.trigger?.type === 'event') {
            const et = rule.trigger;
            if (!Array.isArray(et.on) || et.on.length === 0) {
                errors.push('Event trigger must have a non-empty "on" array');
            }
            if (typeof et.perGoalCooldown !== 'string' || !/^\d+(s|m|h)$/.test(et.perGoalCooldown)) {
                errors.push('Event trigger perGoalCooldown must be a valid duration (e.g. "60s", "5m")');
            }
        }
        if (!rule.action && !rule.skill) {
            errors.push('Rule must have either an action or a skill');
        }
        if (rule.action && !exports.actionRegistry.has(rule.action.type)) {
            errors.push(`Unknown action type: ${rule.action.type}`);
        }
        if (rule.onResult && !['triage', 'goal'].includes(rule.onResult.type)) {
            errors.push(`onResult.type must be "triage" or "goal", got "${rule.onResult.type}"`);
        }
        let nextTriggers = [];
        if (errors.length === 0 && rule.trigger?.type === 'cron') {
            const ct = rule.trigger;
            try {
                const job = new cron_1.CronJob(ct.schedule, () => { }, null, false, ct.timezone || 'UTC');
                nextTriggers = job.nextDates(5).map((d) => d.toJSDate().toISOString());
                job.stop();
            }
            catch { /* nextTriggers stays empty */ }
        }
        return { valid: errors.length === 0, errors, nextTriggers };
    }
    // ── Tier 3: Draft/Suggest methods ──
    getTriageItems(status) {
        const triageDir = path.join(this.mafwDir, 'triage');
        if (!fs.existsSync(triageDir))
            return [];
        const items = [];
        for (const file of fs.readdirSync(triageDir).filter((f) => f.endsWith('.json'))) {
            try {
                const item = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
                if (!status || item.state === status) {
                    items.push(item);
                }
            }
            catch { /* skip corrupt files */ }
        }
        return items.sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
    }
    getTriageItem(triageId) {
        const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
        if (!fs.existsSync(filePath))
            return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    proposeTriageDecision(triageId, suggestion, reason, priority) {
        const item = this.getTriageItem(triageId);
        if (!item)
            return { success: false, message: `Triage item not found: ${triageId}` };
        if (item.state !== 'PENDING_CONFIRMATION') {
            return { success: false, message: `Triage item ${triageId} is already ${item.state}` };
        }
        const llmSuggestion = {
            action: suggestion,
            reason,
            priority: (['high', 'medium', 'low'].includes(priority) ? priority : 'medium'),
            timestamp: new Date().toISOString(),
        };
        if (!item.llmSuggestions)
            item.llmSuggestions = [];
        item.llmSuggestions.push(llmSuggestion);
        item.updatedAt = new Date().toISOString();
        const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
        return { success: true, message: `Suggestion recorded for ${triageId}` };
    }
    draftRule(rule) {
        const validation = this.validateRule(rule);
        if (!validation.valid) {
            return { id: rule.id, valid: false, errors: validation.errors };
        }
        const autoDir = path.join(this.mafwDir, 'automations');
        if (!fs.existsSync(autoDir))
            fs.mkdirSync(autoDir, { recursive: true });
        const existingPath = path.join(autoDir, `${rule.id}.json`);
        if (fs.existsSync(existingPath)) {
            const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
            if (existing.enabled) {
                return { id: rule.id, valid: false, errors: [`Rule "${rule.id}" is already enabled �?cannot overwrite. Disable it first or use a different id`] };
            }
        }
        const draft = { ...rule, enabled: false };
        fs.writeFileSync(existingPath, JSON.stringify(draft, null, 2), 'utf-8');
        return { id: rule.id, valid: true, errors: [] };
    }
    confirmTriage(goalId, triageItem) {
        triageItem.state = 'CONFIRMED';
        triageItem.userAction = { type: 'confirm', at: new Date().toISOString() };
        triageItem.updatedAt = new Date().toISOString();
        const filePath = path.join(this.mafwDir, 'triage', `${triageItem.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(triageItem, null, 2), 'utf-8');
    }
    rejectTriage(triageId) {
        const item = this.getTriageItem(triageId);
        if (!item)
            return false;
        item.state = 'REJECTED';
        item.userAction = { type: 'ignore', at: new Date().toISOString() };
        item.updatedAt = new Date().toISOString();
        const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
        return true;
    }
    toggleRule(id, enabled) {
        const autoDir = path.join(this.mafwDir, 'automations');
        const filePath = path.join(autoDir, `${id}.json`);
        if (!fs.existsSync(filePath))
            return false;
        try {
            const rule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            rule.enabled = enabled;
            rule.id = id;
            fs.writeFileSync(filePath, JSON.stringify(rule, null, 2), 'utf-8');
            if (enabled) {
                this.rules.set(id, rule);
                // Defensive: trigger may be null despite earlier validation (fall-through)
                if (rule.trigger?.type === 'cron') {
                    this.scheduleRule(id, rule);
                }
                else {
                    this.scheduleEventRule(id, rule);
                }
            }
            else {
                this.rules.delete(id);
                const job = this.jobs.get(id);
                if (job) {
                    job.stop();
                    this.jobs.delete(id);
                }
                // Unregister event listener (stub until Task 8):
                // this.unregisterEventRule(id);
            }
            return true;
        }
        catch {
            return false;
        }
    }
    deleteRule(id) {
        const autoDir = path.join(this.mafwDir, 'automations');
        const filePath = path.join(autoDir, `${id}.json`);
        if (!fs.existsSync(filePath))
            return false;
        fs.unlinkSync(filePath);
        this.rules.delete(id);
        const job = this.jobs.get(id);
        if (job) {
            job.stop();
            this.jobs.delete(id);
        }
        return true;
    }
    async llmCreateTriage(automationId, rule) {
        const triageDir = path.join(this.mafwDir, 'triage');
        if (!fs.existsSync(triageDir))
            fs.mkdirSync(triageDir, { recursive: true });
        const triageId = `triage-llm-${Date.now()}`;
        const triageFile = path.join(triageDir, `${triageId}.json`);
        const onResult = rule.onResult || { type: 'triage', auto_confirm: false };
        fs.writeFileSync(triageFile, JSON.stringify({
            id: triageId,
            automationId,
            discoveredAt: new Date().toISOString(),
            source: rule.skill || 'llm-triggered',
            summary: {},
            proposedGoal: {
                title: onResult.template || `Automation: ${rule.id}`,
                boundaries: [],
                estimatedLoops: rule.goal_defaults?.maxLoops || 3,
            },
            state: 'PENDING_CONFIRMATION',
            userAction: null,
            deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            llmSuggestions: [],
            updatedAt: new Date().toISOString(),
        }, null, 2));
        console.log(`[AutomationEngine] LLM-created triage (auto_confirm forced false): ${triageId}`);
        return triageId;
    }
}
exports.AutomationEngine = AutomationEngine;
