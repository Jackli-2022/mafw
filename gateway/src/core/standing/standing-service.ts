import {
  StandingGoalError,
  type GoalRun,
  type StandingBudget,
  type StandingGoal,
  type StandingTemplate,
} from './standing-types';
import { parseStandingTriggers } from './standing-triggers';
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
  enabled(): boolean;
  log?(message: string): void;
  broadcast(event: { type: string; properties?: Record<string, unknown> }): void;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function earliest(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => !!value).sort();
  return valid[0] ?? null;
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
    const triggers = parseStandingTriggers(input.triggers);
    if (triggers.length === 0) throw new StandingGoalError(400, 'at least one trigger is required');
    const goal = this.deps.store.insertGoal({
      id: this.deps.newId('standing-goal'),
      projectDir: input.projectDir,
      title: clean(input.title) || 'Standing Goal',
      objective: clean(input.objective) || clean(input.title),
      template: input.template ?? {},
      triggers,
      state: 'active',
      concurrency: Math.max(1, Math.trunc(input.concurrency ?? 1)),
      cooldownMs: Math.max(0, Math.trunc(input.cooldownMs ?? 0)),
      budget: input.budget ?? {},
      approval: input.approval ?? 'plan',
      createdBy: input.createdBy ?? null,
      now: this.deps.now(),
    });
    const nextRunAt = this.registerCronTriggers(goal);
    const updated = this.deps.store.updateGoal(goal.id, { nextRunAt }, this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.created', properties: { standingGoalId: goal.id } });
    return updated;
  }

  update(
    id: string,
    patch: Partial<Pick<StandingGoal, 'title' | 'objective' | 'template' | 'triggers' | 'concurrency' | 'cooldownMs' | 'budget' | 'approval'>>,
  ): StandingGoal {
    this.requireEnabled();
    const current = this.requireGoal(id);
    const next: any = { ...patch };
    if (patch.triggers !== undefined) next.triggers = parseStandingTriggers(patch.triggers);
    const updated = this.deps.store.updateGoal(id, next, this.deps.now());
    this.unregisterCronTriggers(current);
    if (updated.state === 'active') {
      const nextRunAt = this.registerCronTriggers(updated);
      return this.deps.store.updateGoal(id, { nextRunAt }, this.deps.now());
    }
    return updated;
  }

  list(projectDir: string): StandingGoal[] {
    return this.deps.store.listGoals(projectDir);
  }

  listRuns(standingGoalId: string, limit?: number): GoalRun[] {
    return this.deps.store.listRuns(standingGoalId, limit);
  }

  pause(id: string): StandingGoal {
    const goal = this.requireGoal(id);
    this.unregisterCronTriggers(goal);
    const updated = this.deps.store.setGoalState(id, 'paused', this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.paused', properties: { standingGoalId: id } });
    return updated;
  }

  resume(id: string): StandingGoal {
    const goal = this.requireGoal(id);
    if (goal.state === 'stopped') throw new StandingGoalError(409, 'stopped standing goal cannot resume');
    this.deps.store.setGoalState(id, 'active', this.deps.now());
    const nextRunAt = this.registerCronTriggers(goal);
    const updated = this.deps.store.updateGoal(id, { nextRunAt }, this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.resumed', properties: { standingGoalId: id } });
    return updated;
  }

  stop(id: string): StandingGoal {
    const goal = this.requireGoal(id);
    this.unregisterCronTriggers(goal);
    const updated = this.deps.store.setGoalState(id, 'stopped', this.deps.now());
    this.deps.broadcast({ type: 'standing_goal.stopped', properties: { standingGoalId: id } });
    return updated;
  }

  async reconcile(): Promise<void> {
    if (!this.deps.enabled()) return;
    for (const goal of this.deps.store.listAllGoals()) {
      if (goal.state === 'active') {
        const nextRunAt = this.registerCronTriggers(goal);
        this.deps.store.updateGoal(goal.id, { nextRunAt }, this.deps.now());
      } else {
        this.unregisterCronTriggers(goal);
      }
    }
  }

  private registerCronTriggers(goal: StandingGoal): string | null {
    const next: Array<string | null> = [];
    for (const trigger of goal.triggers) {
      if (trigger.type !== 'cron') continue;
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
