import * as path from 'path';
import {
  StandingGoalError,
  type GoalRun,
  type StandingBudget,
  type StandingGoal,
  type StandingTemplate,
  type StandingTrigger,
} from './standing-types';
import { canStartRun, parseStandingTriggers, triggerKeyFor } from './standing-triggers';
import { validateRunTriage, type RunTriage, type StandingAction } from './standing-triage';
import type { StandingGoalStore } from './standing-store';

export interface StandingGoalServiceDeps {
  store: StandingGoalStore;
  now(): string;
  newId(prefix: string): string;
  registerCron(input: {
    key: string;
    schedule: string;
    timezone: string;
    standingGoalId: string;
    triggerId: string;
  }): Promise<{ nextRunAt: string | null }> | { nextRunAt: string | null };
  unregisterCron(key: string): Promise<void> | void;
  nextCronRun?(key: string): string | null;
  enabled(): boolean;
  log?(message: string): void;
  broadcast(event: { type: string; properties?: Record<string, unknown> }): void;
  createTriage?(input: {
    standingGoal: StandingGoal;
    trigger: StandingTrigger;
    payload: Record<string, unknown>;
    recentRuns: GoalRun[];
  }): Promise<{ sessionId: string; output: unknown; costUsd?: number; tokens?: number }>;
  createGoal?(input: {
    standingGoal: StandingGoal;
    run: GoalRun;
    mode: 'goal' | 'report';
    triage: RunTriage;
  }): Promise<{ goalId: string }>;
  executeAction?(action: StandingAction): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>;
  subscribeEvents?(input: { standingGoal: StandingGoal; trigger: StandingTrigger }): Promise<void> | void;
  unsubscribeEvents?(standingGoalId: string): Promise<void> | void;
  eventLayerEnabled?(): boolean;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function earliest(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => !!value).sort();
  return valid[0] ?? null;
}

const APPROVAL_POLICIES = new Set(['auto', 'plan', 'confirm']);

function assertFiniteNumber(value: unknown, label: string, min: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new StandingGoalError(400, `${label} must be a finite number >= ${min}`);
  }
  return number;
}

function validateBudget(value: unknown): StandingBudget {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new StandingGoalError(400, 'budget must be an object');
  }
  const raw = value as Record<string, unknown>;
  return {
    ...(raw.perRunTurns !== undefined ? { perRunTurns: assertFiniteNumber(raw.perRunTurns, 'budget.perRunTurns', 1) } : {}),
    ...(raw.perRunCostUsd !== undefined ? { perRunCostUsd: assertFiniteNumber(raw.perRunCostUsd, 'budget.perRunCostUsd', 0) } : {}),
    ...(raw.perDayCostUsd !== undefined ? { perDayCostUsd: assertFiniteNumber(raw.perDayCostUsd, 'budget.perDayCostUsd', 0) } : {}),
  };
}

function validateApproval(value: unknown): StandingGoal['approval'] {
  const approval = clean(value) || 'plan';
  if (!APPROVAL_POLICIES.has(approval)) {
    throw new StandingGoalError(400, `invalid approval policy: ${approval}`);
  }
  return approval as StandingGoal['approval'];
}

function validateTemplate(value: unknown): StandingTemplate {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new StandingGoalError(400, 'template must be an object');
  }
  return value as StandingTemplate;
}

function normalizeScheduledAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16)}:00.000Z`;
}

function payloadValue(payload: Record<string, unknown>, key: string): unknown {
  const anyPayload = payload as any;
  const aliases: Record<string, unknown> = {
    repo: anyPayload.repo ?? anyPayload.repository?.full_name,
    labels: payload.labels,
    branch: anyPayload.branch ?? anyPayload.ref
      ?? anyPayload.pull_request?.base?.ref
      ?? anyPayload.pull_request?.head?.ref,
    author: anyPayload.author ?? anyPayload.sender?.login,
  };
  if (key in aliases) return aliases[key];
  let cursor: any = payload;
  for (const part of key.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function matchesFilter(filter: Record<string, unknown> | undefined, payload: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (expected === undefined) continue;
    const actual = payloadValue(payload, key);
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    const actualValues = Array.isArray(actual) ? actual : [actual];
    if (!expectedValues.some((value) => actualValues.some((candidate) => String(candidate) === String(value)))) {
      return false;
    }
  }
  return true;
}

export class StandingGoalService {
  constructor(private readonly deps: StandingGoalServiceDeps) {}

  create(input: {
    projectDir: string;
    title: string;
    objective: string;
    template: StandingTemplate;
    triggers: unknown;
    concurrency?: number;
    cooldownMs?: number;
    budget?: StandingBudget;
    approval?: StandingGoal['approval'];
    createdBy?: string | null;
  }): StandingGoal {
    this.requireEnabled();
    if (!input.projectDir || !path.isAbsolute(input.projectDir)) {
      throw new StandingGoalError(400, 'projectDir must be an absolute path');
    }
    const triggers = parseStandingTriggers(input.triggers);
    if (triggers.length === 0) throw new StandingGoalError(400, 'at least one trigger is required');
    const now = this.deps.now();
    const goal = this.deps.store.insertGoal({
      id: this.deps.newId('standing-goal'),
      projectDir: input.projectDir,
      title: clean(input.title) || 'Standing Goal',
      objective: clean(input.objective) || clean(input.title),
      template: validateTemplate(input.template),
      triggers,
      state: 'active',
      concurrency: Math.max(1, Math.trunc(assertFiniteNumber(input.concurrency, 'concurrency', 1) ?? 1)),
      cooldownMs: Math.max(0, Math.trunc(assertFiniteNumber(input.cooldownMs, 'cooldownMs', 0) ?? 0)),
      budget: validateBudget(input.budget),
      approval: validateApproval(input.approval),
      createdBy: input.createdBy ?? null,
      now,
    });
    try {
      const nextRunAt = this.registerCronTriggers(goal);
      this.registerEventTriggers(goal);
      const updated = this.deps.store.updateGoal(goal.id, { nextRunAt }, now);
      this.deps.broadcast({ type: 'standing_goal.created', properties: { standingGoalId: goal.id } });
      return updated;
    } catch (err: any) {
      this.deps.store.setGoalState(goal.id, 'paused', now, 'trigger registration failed');
      this.deps.log?.(`[StandingGoals] create failed after persist: ${err?.message ?? err}`);
      throw new StandingGoalError(500, `failed to register standing goal triggers: ${err?.message ?? err}`);
    }
  }

  update(
    id: string,
    patch: Partial<Pick<StandingGoal, 'title' | 'objective' | 'template' | 'triggers' | 'concurrency' | 'cooldownMs' | 'budget' | 'approval'>>,
  ): StandingGoal {
    this.requireEnabled();
    const current = this.requireGoal(id);
    if (current.state === 'stopped') throw new StandingGoalError(409, 'stopped standing goal cannot be updated');
    const next: any = { ...patch };
    if (patch.triggers !== undefined) {
      const triggers = parseStandingTriggers(patch.triggers);
      if (triggers.length === 0) throw new StandingGoalError(400, 'at least one trigger is required');
      next.triggers = triggers;
    }
    if (patch.template !== undefined) next.template = validateTemplate(patch.template);
    if (patch.budget !== undefined) next.budget = validateBudget(patch.budget);
    if (patch.approval !== undefined) next.approval = validateApproval(patch.approval);
    if (patch.concurrency !== undefined) {
      next.concurrency = Math.max(1, Math.trunc(assertFiniteNumber(patch.concurrency, 'concurrency', 1)!));
    }
    if (patch.cooldownMs !== undefined) {
      next.cooldownMs = Math.max(0, Math.trunc(assertFiniteNumber(patch.cooldownMs, 'cooldownMs', 0)!));
    }
    const updated = this.deps.store.updateGoal(id, next, this.deps.now());
    this.unregisterCronTriggers(current);
    void this.deps.unsubscribeEvents?.(current.id);
    if (updated.state === 'active') {
      try {
        const nextRunAt = this.registerCronTriggers(updated);
        this.registerEventTriggers(updated);
        return this.deps.store.updateGoal(id, { nextRunAt }, this.deps.now());
      } catch (err: any) {
        this.deps.store.setGoalState(id, 'paused', this.deps.now(), 'trigger registration failed');
        throw new StandingGoalError(500, `failed to register standing goal triggers: ${err?.message ?? err}`);
      }
    }
    return updated;
  }

  list(projectDir: string): StandingGoal[] {
    return this.deps.store.listGoals(projectDir);
  }

  listRuns(standingGoalId: string, limit?: number): GoalRun[] {
    return this.deps.store.listRuns(standingGoalId, limit);
  }

  async runNow(
    id: string,
    payload: Record<string, unknown> = {},
    trigger?: StandingTrigger,
  ): Promise<GoalRun | null> {
    this.requireEnabled();
    const goal = this.requireGoal(id);
    if (goal.state === 'stopped') return null;
    const selected = trigger ?? { id: 'manual', type: 'manual' } as StandingTrigger;
    const now = this.deps.now();
    const triggerKey = triggerKeyFor({
      standingGoalId: goal.id,
      trigger: selected,
      scheduledAt: now,
      eventId: this.deps.newId('event'),
      manualId: this.deps.newId('manual'),
    });
    return this.startRun(goal, selected, triggerKey, payload, { allowPaused: true });
  }

  async handleCronTick(
    standingGoalId: string,
    scheduledAt: string,
    triggerId?: string,
  ): Promise<GoalRun | null> {
    this.requireEnabled();
    const goal = this.requireGoal(standingGoalId);
    if (goal.state !== 'active') return null;
    const trigger = goal.triggers.find((item) => item.type === 'cron' && (!triggerId || item.id === triggerId));
    if (!trigger) return null;
    const scheduled = normalizeScheduledAt(scheduledAt);
    const triggerKey = triggerKeyFor({ standingGoalId, trigger, scheduledAt: scheduled });
    const run = await this.startRun(goal, trigger, triggerKey, { scheduledAt: scheduled });
    const nextRunAt = earliest(goal.triggers
      .filter((item) => item.type === 'cron')
      .map((item) => this.deps.nextCronRun?.(`standing-goal:${goal.id}:${item.id}`) ?? null));
    this.deps.store.updateGoal(goal.id, { nextRunAt }, this.deps.now());
    return run;
  }

  async approveRun(runId: string): Promise<GoalRun> {
    const run = this.deps.store.getRun(runId);
    if (!run) throw new StandingGoalError(404, `goal run not found: ${runId}`);
    if (run.status !== 'waiting_person') {
      throw new StandingGoalError(409, `goal run is ${run.status}, not waiting_person`);
    }
    const goal = this.requireGoal(run.standingGoalId);
    const pending = (run.result as any)?.pendingTriage;
    const triage = validateRunTriage(pending);
    const now = this.deps.now();
    if (!this.deps.store.claimWaitingRun(run.id, now)) {
      throw new StandingGoalError(409, 'goal run is no longer waiting_person');
    }
    try {
      if (triage.mode === 'action') {
        if (!this.deps.executeAction) throw new StandingGoalError(503, 'action executor unavailable');
        const actionResult = await this.deps.executeAction(triage.action!);
        const status = actionResult.ok ? 'done' : 'failed';
        this.deps.store.updateRun(run.id, {
          status,
          result: actionResult.result ?? (actionResult.error ? { error: actionResult.error } : null),
          endedAt: now,
        });
        this.deps.store.updateGoal(goal.id, { lastRunAt: now }, now);
        this.deps.store.appendRunEvent(run.id, status === 'done' ? 'finished' : 'failed', { approved: true }, now);
        this.deps.broadcast({
          type: status === 'done' ? 'goal_run.finished' : 'goal_run.failed',
          properties: { standingGoalId: goal.id, runId: run.id, status },
        });
        if (status === 'failed') this.maybePauseAfterFailures(goal, now);
        return this.deps.store.getRun(run.id)!;
      }
      if (triage.mode !== 'goal' && triage.mode !== 'report') {
        throw new StandingGoalError(409, `run mode ${triage.mode} cannot be approved`);
      }
      if (!this.deps.createGoal) throw new StandingGoalError(503, 'goal executor unavailable');
      const created = await this.deps.createGoal({ standingGoal: goal, run, mode: triage.mode, triage });
      this.deps.store.updateRun(run.id, {
        status: 'running',
        mode: triage.mode,
        rationale: triage.rationale,
        goalId: created.goalId,
        startedAt: now,
      });
      this.deps.store.updateGoal(goal.id, { lastRunAt: now }, now);
      this.deps.store.appendRunEvent(run.id, 'started', { approved: true, goalId: created.goalId }, now);
      this.deps.broadcast({
        type: 'goal_run.started',
        properties: { standingGoalId: goal.id, runId: run.id, goalId: created.goalId, mode: triage.mode },
      });
      return this.deps.store.getRun(run.id)!;
    } catch (err: any) {
      const error = String(err?.message ?? err);
      this.deps.store.updateRun(run.id, {
        status: 'failed',
        result: { error },
        endedAt: this.deps.now(),
      });
      this.deps.store.appendRunEvent(run.id, 'failed', { approved: true, error }, this.deps.now());
      this.deps.broadcast({
        type: 'goal_run.failed',
        properties: { standingGoalId: goal.id, runId: run.id, error },
      });
      this.maybePauseAfterFailures(goal, this.deps.now());
      throw new StandingGoalError(500, `approved run failed: ${error}`);
    }
  }

  private maybePauseAfterFailures(goal: StandingGoal, now: string): void {
    const runs = this.deps.store.listRuns(goal.id, 20);
    let consecutive = 0;
    for (const run of runs) {
      if (run.status === 'failed') consecutive += 1;
      else if (run.status === 'done' || run.status === 'skipped') break;
    }
    if (consecutive < 3) return;
    this.pause(goal.id, 'three consecutive failures');
    this.deps.broadcast({
      type: 'goal_run.needs_person',
      properties: { standingGoalId: goal.id, reason: 'three consecutive failures' },
    });
  }

  async handleEventTrigger(
    standingGoalId: string,
    input: {
      payload: Record<string, unknown>;
      eventId: string;
      kind?: string;
      triggerId?: string;
      projectDir?: string;
    },
  ): Promise<GoalRun | null> {
    this.requireEnabled();
    const goal = this.requireGoal(standingGoalId);
    if (goal.state !== 'active') return null;
    if (input.projectDir && path.resolve(input.projectDir) !== path.resolve(goal.projectDir)) {
      return null;
    }
    const eventTriggers = goal.triggers.filter((item) => item.type === 'event' && (!input.triggerId || item.id === input.triggerId));
    if (eventTriggers.length === 0) return null;
    let first: GoalRun | null = null;
    for (const trigger of eventTriggers) {
      if (input.kind && trigger.eventKinds?.length && !trigger.eventKinds.includes(input.kind)) continue;
      if (!matchesFilter(trigger.filter, input.payload)) continue;
      const key = goal.triggers.filter((item) => item.type === 'event').length > 1
        ? `${goal.id}:event:${trigger.id}:${input.eventId}`
        : triggerKeyFor({ standingGoalId: goal.id, trigger, eventId: input.eventId });
      const run = await this.startRun(goal, trigger, key, {
        ...input.payload,
        eventId: input.eventId,
      });
      if (run && !first) first = run;
    }
    return first;
  }

  async onGoalFinished(
    goalId: string,
    outcome: { status: 'done' | 'failed'; costUsd?: number; tokens?: number; result?: Record<string, unknown> },
  ): Promise<void> {
    const run = this.deps.store.findRunByGoalId(goalId);
    if (!run) return;
    const now = this.deps.now();
    const status = outcome.status === 'done' ? 'done' : 'failed';
    this.deps.store.updateRun(run.id, {
      status,
      endedAt: now,
      ...(outcome.costUsd !== undefined ? { costUsd: (run.costUsd ?? 0) + outcome.costUsd } : {}),
      ...(outcome.tokens !== undefined ? { tokens: (run.tokens ?? 0) + outcome.tokens } : {}),
      ...(outcome.result !== undefined ? { result: { ...(run.result ?? {}), ...outcome.result } } : {}),
    });
    this.deps.store.updateGoal(run.standingGoalId, { lastRunAt: now }, now);
    this.deps.store.appendRunEvent(run.id, status === 'done' ? 'finished' : 'failed', { status }, now);
    this.deps.broadcast({
      type: status === 'done' ? 'goal_run.finished' : 'goal_run.failed',
      properties: { standingGoalId: run.standingGoalId, runId: run.id, goalId, status },
    });
    if (status === 'failed') {
      const goal = this.deps.store.getGoal(run.standingGoalId);
      if (goal) this.maybePauseAfterFailures(goal, now);
    }
  }

  pause(id: string, reason?: string | null): StandingGoal {
    const goal = this.requireGoal(id);
    if (goal.state === 'stopped') throw new StandingGoalError(409, 'stopped standing goal cannot pause');
    this.unregisterCronTriggers(goal);
    void this.deps.unsubscribeEvents?.(goal.id);
    const updated = this.deps.store.setGoalState(id, 'paused', this.deps.now(), reason ?? null);
    this.deps.store.updateGoal(id, { nextRunAt: null }, this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.paused', properties: { standingGoalId: id, reason: reason ?? null } });
    return this.deps.store.getGoal(id) ?? updated;
  }

  resume(id: string): StandingGoal {
    const goal = this.requireGoal(id);
    if (goal.state === 'stopped') throw new StandingGoalError(409, 'stopped standing goal cannot resume');
    this.deps.store.setGoalState(id, 'active', this.deps.now(), null);
    try {
      const nextRunAt = this.registerCronTriggers(goal);
      this.registerEventTriggers(goal);
      const updated = this.deps.store.updateGoal(id, { nextRunAt }, this.deps.now());
      this.deps.broadcast({ type: 'standing_goal.resumed', properties: { standingGoalId: id } });
      return updated;
    } catch (err: any) {
      this.deps.store.setGoalState(id, 'paused', this.deps.now(), 'trigger registration failed');
      throw new StandingGoalError(500, `failed to register standing goal triggers: ${err?.message ?? err}`);
    }
  }

  stop(id: string): StandingGoal {
    const goal = this.requireGoal(id);
    this.unregisterCronTriggers(goal);
    void this.deps.unsubscribeEvents?.(goal.id);
    const updated = this.deps.store.setGoalState(id, 'stopped', this.deps.now(), null);
    this.deps.store.updateGoal(id, { nextRunAt: null }, this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.stopped', properties: { standingGoalId: id } });
    return this.deps.store.getGoal(id) ?? updated;
  }

  async reconcile(): Promise<void> {
    if (!this.deps.enabled()) return;
    const nowMs = Date.parse(this.deps.now());
    if (Number.isFinite(nowMs)) {
      const staleBefore = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
      for (const run of this.deps.store.listStaleOpenRuns(staleBefore)) {
        this.deps.store.updateRun(run.id, {
          status: 'failed',
          result: { error: 'stale open run recovered' },
          endedAt: this.deps.now(),
        });
        this.deps.store.appendRunEvent(run.id, 'failed', { error: 'stale open run recovered' }, this.deps.now());
      }
    }
    for (const goal of this.deps.store.listAllGoals()) {
      try {
        if (goal.state === 'active') {
          const nextRunAt = this.registerCronTriggers(goal, false);
          this.registerEventTriggers(goal);
          this.deps.store.updateGoal(goal.id, { nextRunAt }, this.deps.now());
        } else {
          this.unregisterCronTriggers(goal);
          void this.deps.unsubscribeEvents?.(goal.id);
        }
      } catch (err: any) {
        this.deps.log?.(`[StandingGoals] reconcile failed for ${goal.id}: ${err?.message ?? err}`);
      }
    }
  }

  private async startRun(
    goal: StandingGoal,
    trigger: StandingTrigger,
    triggerKey: string,
    payload: Record<string, unknown>,
    options: { allowPaused?: boolean } = {},
  ): Promise<GoalRun | null> {
    if (goal.state !== 'active' && !(options.allowPaused && goal.state === 'paused')) return null;
    if (this.deps.store.findRunByTriggerKey(goal.id, triggerKey)) return null;
    const now = this.deps.now();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayCostUsd = this.deps.store
      .listRunsForDay(goal.projectDir, dayStart.toISOString())
      .filter((run) => run.standingGoalId === goal.id)
      .reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    const admission = canStartRun({
      goal,
      openRuns: this.deps.store.listRuns(goal.id, 100),
      todayCostUsd,
      now,
    });
    if (!admission.ok) {
      if (admission.reason === 'budget') {
        this.pause(goal.id, admission.message);
        this.deps.broadcast({
          type: 'goal_run.budget_exhausted',
          properties: { standingGoalId: goal.id, reason: admission.message },
        });
      }
      return null;
    }

    let run: GoalRun;
    try {
      run = this.deps.store.insertRun({
        id: this.deps.newId('goal_run'),
        standingGoalId: goal.id,
        triggerType: trigger.type,
        triggerKey,
        payload,
        status: 'queued',
        mode: null,
        rationale: null,
        goalId: null,
        sessionId: null,
        worktree: null,
        result: null,
        costUsd: null,
        tokens: null,
        now,
      });
    } catch (err: any) {
      if (String(err?.code ?? '').includes('SQLITE_CONSTRAINT')) return null;
      throw err;
    }
    this.deps.store.appendRunEvent(run.id, 'created', { triggerType: trigger.type }, now);
    this.deps.broadcast({
      type: 'goal_run.created',
      properties: { standingGoalId: goal.id, runId: run.id, triggerKey },
    });

    try {
      this.deps.store.updateRun(run.id, { status: 'triaging', startedAt: now });
      if (!this.deps.createTriage) throw new Error('triage executor unavailable');
      const triageResult = await this.deps.createTriage({
        standingGoal: goal,
        trigger,
        payload,
        recentRuns: this.deps.store.listRuns(goal.id, 5),
      });
      if (triageResult.costUsd !== undefined || triageResult.tokens !== undefined) {
        this.deps.store.updateRun(run.id, {
          ...(triageResult.costUsd !== undefined ? { costUsd: triageResult.costUsd } : {}),
          ...(triageResult.tokens !== undefined ? { tokens: triageResult.tokens } : {}),
        });
      }
      const triage = validateRunTriage(triageResult.output);
      this.deps.store.appendRunEvent(run.id, 'triaged', { mode: triage.mode }, now);
      this.deps.broadcast({
        type: 'goal_run.triaged',
        properties: { standingGoalId: goal.id, runId: run.id, mode: triage.mode },
      });

      if (triage.mode === 'skip') {
        this.deps.store.updateRun(run.id, {
          status: 'skipped',
          mode: 'skip',
          rationale: triage.rationale,
          sessionId: triageResult.sessionId,
          endedAt: now,
        });
        this.deps.store.updateGoal(goal.id, { lastRunAt: now }, now);
        this.deps.store.appendRunEvent(run.id, 'skipped', { rationale: triage.rationale }, now);
        this.deps.broadcast({
          type: 'goal_run.skipped',
          properties: { standingGoalId: goal.id, runId: run.id, rationale: triage.rationale },
        });
        return this.deps.store.getRun(run.id);
      }

      const needsApproval = triage.requiresApproval === true || goal.approval === 'confirm';
      if (needsApproval) {
        this.deps.store.updateRun(run.id, {
          status: 'waiting_person',
          mode: triage.mode,
          rationale: triage.rationale,
          sessionId: triageResult.sessionId,
          result: { pendingTriage: triage },
        });
        this.deps.store.appendRunEvent(run.id, 'needs_person', { mode: triage.mode }, now);
        this.deps.broadcast({
          type: 'goal_run.needs_person',
          properties: { standingGoalId: goal.id, runId: run.id, mode: triage.mode },
        });
        return this.deps.store.getRun(run.id);
      }

      if (triage.mode === 'action') {
        if (!this.deps.executeAction) throw new Error('action executor unavailable');
        const actionResult = await this.deps.executeAction(triage.action!);
        const status = actionResult.ok ? 'done' : 'failed';
        this.deps.store.updateRun(run.id, {
          status,
          mode: 'action',
          rationale: triage.rationale,
          sessionId: triageResult.sessionId,
          result: actionResult.result ?? (actionResult.error ? { error: actionResult.error } : null),
          endedAt: now,
        });
        this.deps.store.updateGoal(goal.id, { lastRunAt: now }, now);
        this.deps.store.appendRunEvent(run.id, status === 'done' ? 'finished' : 'failed', { mode: 'action' }, now);
        this.deps.broadcast({
          type: status === 'done' ? 'goal_run.finished' : 'goal_run.failed',
          properties: { standingGoalId: goal.id, runId: run.id, status },
        });
        if (status === 'failed') this.maybePauseAfterFailures(goal, now);
        return this.deps.store.getRun(run.id);
      }

      if (!this.deps.createGoal) throw new Error('goal executor unavailable');
      const created = await this.deps.createGoal({
        standingGoal: goal,
        run: this.deps.store.getRun(run.id)!,
        mode: triage.mode,
        triage,
      });
      this.deps.store.updateRun(run.id, {
        status: 'running',
        mode: triage.mode,
        rationale: triage.rationale,
        goalId: created.goalId,
        sessionId: triageResult.sessionId,
        startedAt: now,
      });
      this.deps.store.updateGoal(goal.id, { lastRunAt: now }, now);
      this.deps.store.appendRunEvent(run.id, 'started', { mode: triage.mode, goalId: created.goalId }, now);
      this.deps.broadcast({
        type: 'goal_run.started',
        properties: { standingGoalId: goal.id, runId: run.id, goalId: created.goalId, mode: triage.mode },
      });
      return this.deps.store.getRun(run.id);
    } catch (err: any) {
      const error = String(err?.message ?? err);
      this.deps.store.updateRun(run.id, {
        status: 'failed',
        result: { error },
        endedAt: this.deps.now(),
      });
      this.deps.store.updateGoal(goal.id, { lastRunAt: this.deps.now() }, this.deps.now());
      this.deps.store.appendRunEvent(run.id, 'failed', { error }, this.deps.now());
      this.deps.broadcast({
        type: 'goal_run.failed',
        properties: { standingGoalId: goal.id, runId: run.id, error },
      });
      this.maybePauseAfterFailures(goal, this.deps.now());
      return this.deps.store.getRun(run.id);
    }
  }

  private registerEventTriggers(goal: StandingGoal): void {
    if (this.deps.eventLayerEnabled && !this.deps.eventLayerEnabled()) return;
    for (const trigger of goal.triggers) {
      if (trigger.type !== 'event') continue;
      void this.deps.subscribeEvents?.({ standingGoal: goal, trigger });
    }
  }

  private registerCronTriggers(goal: StandingGoal, strict = true): string | null {
    const next: Array<string | null> = [];
    for (const trigger of goal.triggers) {
      if (trigger.type !== 'cron') continue;
      try {
        const result = this.deps.registerCron({
          key: `standing-goal:${goal.id}:${trigger.id}`,
          schedule: trigger.schedule!,
          timezone: trigger.timezone!,
          standingGoalId: goal.id,
          triggerId: trigger.id,
        });
        if (result && typeof (result as any).then === 'function') {
          // The automation adapter is synchronous in production; tests may use a
          // promise. Keep the nextRunAt best-effort without blocking create().
          void (result as Promise<{ nextRunAt: string | null }>).then((value) => {
            if (value?.nextRunAt) this.deps.store.updateGoal(goal.id, { nextRunAt: value.nextRunAt }, this.deps.now());
          });
        } else {
          next.push((result as { nextRunAt: string | null })?.nextRunAt ?? null);
        }
      } catch (err: any) {
        if (strict) throw err;
        this.deps.log?.(`[StandingGoals] cron registration failed for ${goal.id}/${trigger.id}: ${err?.message ?? err}`);
      }
    }
    return earliest(next);
  }

  private unregisterCronTriggers(goal: StandingGoal): void {
    for (const trigger of goal.triggers) {
      if (trigger.type !== 'cron') continue;
      void this.deps.unregisterCron(`standing-goal:${goal.id}:${trigger.id}`);
    }
  }

  private requireGoal(id: string): StandingGoal {
    const goal = this.deps.store.getGoal(id);
    if (!goal) throw new StandingGoalError(404, `standing goal not found: ${id}`);
    return goal;
  }

  private requireEnabled(): void {
    if (!this.deps.enabled()) throw new StandingGoalError(503, 'standing goals disabled');
  }
}
