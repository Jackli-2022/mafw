import * as fs from 'fs';
import * as path from 'path';
import { CronJob } from 'cron';
import { HarmonicIndexManager } from './core/memory/harmonic-index';
import { EnergySystem } from './core/memory/energy-system';
import { ReviewScheduler } from './core/memory/review-scheduler';
import { CognitiveGraphManager } from './core/memory/cognitive-graph';
import { L5Store } from './core/memory/l5-store';
import { runDistillation } from './core/memory/abstraction-distiller';

import { SchedulerLedger } from './ledger';

export type MemoryActionType = string;
export type ActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine
) => Promise<void>;
export const actionRegistry: Map<string, ActionHandler> = new Map();
actionRegistry.set('memory:distill', async (_rule, engine) => {
  console.log('[AutomationEngine] Starting memory distillation...');
  const indexManager = new HarmonicIndexManager(engine.mafwDir);
  const result = await runDistillation(indexManager, engine.mafwDir);
  console.log(`[AutomationEngine] Distillation complete: created ${result.created}, locked ${result.locked}`);
});
actionRegistry.set('memory:decay', async (_rule, engine) => {
  console.log('[AutomationEngine] Running energy decay...');
  const indexManager = new HarmonicIndexManager(engine.mafwDir);
  const index = indexManager.getIndex();
  const energySystem = new EnergySystem();
  let decayed = 0;
  for (const entry of index.entries) {
    const salience = (entry as any).salience || 1.0;
    const daysSinceUpdate = entry.energy > 0 ? 1 : 0;
    const newEnergy = energySystem.calculateEnergy(entry.energy, { type: 'retrieved' }, daysSinceUpdate, salience, entry.id);
    const diff = entry.energy - newEnergy;
    if (diff > 0.005) { indexManager.updateEnergy(entry.id, -(diff)); decayed++; }
  }
  console.log(`[AutomationEngine] Energy decay applied to ${decayed} entries`);
});
actionRegistry.set('memory:review', async (_rule, engine) => {
  console.log('[AutomationEngine] Checking review queue...');
  const indexManager = new HarmonicIndexManager(engine.mafwDir);
  const scheduler = new ReviewScheduler(indexManager, engine.mafwDir);
  scheduler.tick();
  const queue = scheduler.getReviewQueue();
  console.log(`[AutomationEngine] Review queue: ${queue.length} items due`);
});
actionRegistry.set('memory:prune', async (_rule, engine) => {
  console.log('[AutomationEngine] Pruning cognitive graph...');
  const graph = new CognitiveGraphManager(engine.mafwDir);
  const before = graph.getGraph().edges.length;
  graph.prune(0.1);
  const after = graph.getGraph().edges.length;
  const pruned = before - after;
  if (pruned > 0) {
    console.log(`[AutomationEngine] Pruned ${pruned} low-weight edges`);
  } else {
    console.log('[AutomationEngine] No edges to prune');
  }
});

export interface AutomationRule {
  id: string;
  enabled: boolean;
  trigger: {
    type: 'cron';
    schedule: string;
    timezone: string;
  };
  skill?: string;
  args?: Record<string, any>;
  onResult?: {
    type: 'triage' | 'goal';
    auto_confirm?: boolean;
    template?: string;
  };
  goal_defaults?: {
    maxLoops?: number;
    metrics?: Record<string, { target: number; unit: string }>;
  };
  action?: {
    type: string;
  };
}

export interface LlmSuggestion {
  action: 'confirm' | 'reject';
  reason: string;
  priority: 'high' | 'medium' | 'low';
  timestamp: string;
}

export interface TriageItem {
  id: string;
  automationId: string;
  discoveredAt: string;
  source: string;
  summary: Record<string, any>;
  proposedGoal: {
    title: string;
    boundaries: string[];
    estimatedLoops: number;
  };
  state: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED';
  userAction: null | { type: 'confirm' | 'ignore' | 'edit'; at: string };
  deadline: string;
  llmSuggestions?: LlmSuggestion[];
  updatedAt?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  nextTriggers: string[];
}

export class AutomationEngine {
  private rules: Map<string, AutomationRule> = new Map();
  private jobs: Map<string, CronJob> = new Map();
  readonly mafwDir: string;
  private _ledger?: SchedulerLedger;

  constructor(mafwDir: string) {
    this.mafwDir = mafwDir;
  }

  setLedger(ledger: SchedulerLedger): void {
    this._ledger = ledger;
  }

  loadRules(): void {
    const autoDir = path.join(this.mafwDir, 'automations');
    if (!fs.existsSync(autoDir)) return;

    const files = fs.readdirSync(autoDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const rule: AutomationRule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
        if (rule.enabled) {
          this.rules.set(rule.id, rule);
        }
      } catch (err: any) {
        console.warn(`[AutomationEngine] Failed to load rule ${file}: ${err.message}`);
      }
    }

    console.log(`[AutomationEngine] Loaded ${this.rules.size} automation rules`);
  }

  start(): void {
    for (const [id, rule] of this.rules) {
      this.scheduleRule(id, rule);
    }
  }

  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
    console.log(`[AutomationEngine] Stopped ${this.jobs.size} jobs`);
  }

  private scheduleRule(id: string, rule: AutomationRule): void {
    try {
      const job = new CronJob(
        rule.trigger.schedule,
        () => this.executeRule(id, 'cron', this._ledger),
        null,
        true,
        rule.trigger.timezone,
      );
      this.jobs.set(id, job);
      console.log(`[AutomationEngine] Scheduled rule ${id}: ${rule.trigger.schedule} (${rule.trigger.timezone})`);
    } catch (err: any) {
      console.warn(`[AutomationEngine] Failed to schedule rule ${id}: ${err.message}`);
    }
  }

  async executeRule(id: string, source?: 'cron' | 'user', ledger?: SchedulerLedger): Promise<void> {
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
    } else {
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

  private async executeAction(actionType: string, rule: AutomationRule): Promise<void> {
    const handler = actionRegistry.get(actionType);
    if (!handler) {
      console.warn(`[AutomationEngine] No handler registered for action: ${actionType}`);
      return;
    }
    try {
      await handler(rule, this);
    } catch (err: any) {
      console.error(`[AutomationEngine] Action ${actionType} failed: ${err.message}`);
    }
  }

  private async createTriage(automationId: string, rule: AutomationRule): Promise<void> {
    const triageDir = path.join(this.mafwDir, 'triage');
    if (!fs.existsSync(triageDir)) fs.mkdirSync(triageDir, { recursive: true });

    const triageId = `triage-${Date.now()}`;
    const triageFile = path.join(triageDir, `${triageId}.json`);

    const onResult = rule.onResult!;
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

  private async createGoal(automationId: string, rule: AutomationRule): Promise<void> {
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

    const onResult = rule.onResult!;
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

  getRules(): AutomationRule[] {
    const rules = Array.from(this.rules.values());
    const autoDir = path.join(this.mafwDir, 'automations');
    if (fs.existsSync(autoDir)) {
      for (const file of fs.readdirSync(autoDir).filter((f: string) => f.endsWith('.json'))) {
        try {
          const rule: AutomationRule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
          rule.id = file.replace('.json', '');
          if (!rules.find(r => r.id === rule.id)) {
            rules.push(rule);
          }
        } catch { /* skip corrupt files */ }
      }
    }
    return rules;
  }

  getRule(id: string): AutomationRule | undefined {
    const cached = this.rules.get(id);
    if (cached) return cached;
    const filePath = path.join(this.mafwDir, 'automations', `${id}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const rule: AutomationRule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        rule.id = id;
        return rule;
      } catch { /* fall through */ }
    }
    return undefined;
  }

  getNextTriggers(rule: AutomationRule, count: number = 5): { next5: string[] } {
    const next5: string[] = [];
    try {
      const job = new CronJob(
        rule.trigger.schedule,
        () => {},
        null,
        false,
        rule.trigger.timezone,
      );
      const dates = job.nextDates(count);
      for (const dt of dates) {
        next5.push(dt.toJSDate().toISOString());
      }
      job.stop();
    } catch {
      // invalid cron �?return empty
    }
    return { next5 };
  }

  // ── Tier 2: Safe action methods ──

  async runRuleFromLLM(id: string, ledger: SchedulerLedger): Promise<{ triageId: string; message: string }> {
    const rule = this.rules.get(id);
    if (!rule) throw new Error(`Rule not found: ${id}`);

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

  validateRule(rule: AutomationRule): ValidationResult {
    const errors: string[] = [];

    if (!rule.id || typeof rule.id !== 'string') {
      errors.push('Rule must have a string id');
    }
    if (!rule.trigger || rule.trigger.type !== 'cron') {
      errors.push('Trigger type must be "cron"');
    }
    if (typeof rule.trigger?.schedule !== 'string' || rule.trigger.schedule.trim() === '') {
      errors.push('Schedule must be a non-empty cron expression');
    } else {
      try {
        const job = new CronJob(rule.trigger.schedule, () => {}, null, false, rule.trigger.timezone || 'UTC');
        job.stop();
      } catch (e: any) {
        errors.push(`Invalid cron expression: ${e.message}`);
      }
    }
    if (rule.trigger?.timezone && !Intl.supportedValuesOf?.('timeZone')?.includes(rule.trigger.timezone)) {
      try { new Intl.DateTimeFormat(undefined, { timeZone: rule.trigger.timezone }); } catch {
        errors.push(`Invalid timezone: ${rule.trigger.timezone}`);
      }
    }
    if (!rule.action && !rule.skill) {
      errors.push('Rule must have either an action or a skill');
    }
    if (rule.action && !actionRegistry.has(rule.action.type)) {
      errors.push(`Unknown action type: ${rule.action.type}`);
    }
    if (rule.onResult && !['triage', 'goal'].includes(rule.onResult.type)) {
      errors.push(`onResult.type must be "triage" or "goal", got "${rule.onResult.type}"`);
    }

    let nextTriggers: string[] = [];
    if (errors.length === 0 && rule.trigger?.schedule) {
      try {
        const job = new CronJob(rule.trigger.schedule, () => {}, null, false, rule.trigger.timezone || 'UTC');
        nextTriggers = job.nextDates(5).map((d: any) => d.toJSDate().toISOString());
        job.stop();
      } catch { /* nextTriggers stays empty */ }
    }

    return { valid: errors.length === 0, errors, nextTriggers };
  }

  // ── Tier 3: Draft/Suggest methods ──

  getTriageItems(status?: string): TriageItem[] {
    const triageDir = path.join(this.mafwDir, 'triage');
    if (!fs.existsSync(triageDir)) return [];

    const items: TriageItem[] = [];
    for (const file of fs.readdirSync(triageDir).filter((f: string) => f.endsWith('.json'))) {
      try {
        const item: TriageItem = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
        if (!status || item.state === status) {
          items.push(item);
        }
      } catch { /* skip corrupt files */ }
    }
    return items.sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
  }

  getTriageItem(triageId: string): TriageItem | null {
    const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  proposeTriageDecision(triageId: string, suggestion: 'confirm' | 'reject', reason: string, priority: string): { success: boolean; message: string } {
    const item = this.getTriageItem(triageId);
    if (!item) return { success: false, message: `Triage item not found: ${triageId}` };

    if (item.state !== 'PENDING_CONFIRMATION') {
      return { success: false, message: `Triage item ${triageId} is already ${item.state}` };
    }

    const llmSuggestion: LlmSuggestion = {
      action: suggestion,
      reason,
      priority: (['high', 'medium', 'low'].includes(priority) ? priority : 'medium') as 'high' | 'medium' | 'low',
      timestamp: new Date().toISOString(),
    };

    if (!item.llmSuggestions) item.llmSuggestions = [];
    item.llmSuggestions.push(llmSuggestion);
    item.updatedAt = new Date().toISOString();

    const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');

    return { success: true, message: `Suggestion recorded for ${triageId}` };
  }

  draftRule(rule: AutomationRule): { id: string; valid: boolean; errors: string[] } {
    const validation = this.validateRule(rule);
    if (!validation.valid) {
      return { id: rule.id, valid: false, errors: validation.errors };
    }

    const autoDir = path.join(this.mafwDir, 'automations');
    if (!fs.existsSync(autoDir)) fs.mkdirSync(autoDir, { recursive: true });

    const existingPath = path.join(autoDir, `${rule.id}.json`);
    if (fs.existsSync(existingPath)) {
      const existing: AutomationRule = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
      if (existing.enabled) {
        return { id: rule.id, valid: false, errors: [`Rule "${rule.id}" is already enabled �?cannot overwrite. Disable it first or use a different id`] };
      }
    }

    const draft: AutomationRule = { ...rule, enabled: false };
    fs.writeFileSync(existingPath, JSON.stringify(draft, null, 2), 'utf-8');

    return { id: rule.id, valid: true, errors: [] };
  }

  confirmTriage(goalId: string, triageItem: TriageItem): void {
    triageItem.state = 'CONFIRMED';
    triageItem.userAction = { type: 'confirm', at: new Date().toISOString() };
    triageItem.updatedAt = new Date().toISOString();
    const filePath = path.join(this.mafwDir, 'triage', `${triageItem.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(triageItem, null, 2), 'utf-8');
  }

  rejectTriage(triageId: string): boolean {
    const item = this.getTriageItem(triageId);
    if (!item) return false;
    item.state = 'REJECTED';
    item.userAction = { type: 'ignore', at: new Date().toISOString() };
    item.updatedAt = new Date().toISOString();
    const filePath = path.join(this.mafwDir, 'triage', `${triageId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
    return true;
  }

  toggleRule(id: string, enabled: boolean): boolean {
    const autoDir = path.join(this.mafwDir, 'automations');
    const filePath = path.join(autoDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    try {
      const rule: AutomationRule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      rule.enabled = enabled;
      rule.id = id;
      fs.writeFileSync(filePath, JSON.stringify(rule, null, 2), 'utf-8');
      if (enabled) {
        this.rules.set(id, rule);
        this.scheduleRule(id, rule);
      } else {
        this.rules.delete(id);
        const job = this.jobs.get(id);
        if (job) { job.stop(); this.jobs.delete(id); }
      }
      return true;
    } catch {
      return false;
    }
  }

  deleteRule(id: string): boolean {
    const autoDir = path.join(this.mafwDir, 'automations');
    const filePath = path.join(autoDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    this.rules.delete(id);
    const job = this.jobs.get(id);
    if (job) { job.stop(); this.jobs.delete(id); }
    return true;
  }

  private async llmCreateTriage(automationId: string, rule: AutomationRule): Promise<string> {
    const triageDir = path.join(this.mafwDir, 'triage');
    if (!fs.existsSync(triageDir)) fs.mkdirSync(triageDir, { recursive: true });

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
