import { CronTime } from 'cron';
import { StandingGoalError, type GoalRun, type StandingGoal, type StandingTrigger } from './standing-types';

const TRIGGER_TYPES = new Set(['cron', 'event', 'manual']);
const OPEN_STATUSES = new Set(['queued', 'triaging', 'running', 'waiting_person']);

function assertCronShape(schedule: string, timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new StandingGoalError(400, `invalid timezone: ${timezone}`);
  }
  try {
    new CronTime(schedule, timezone);
  } catch (err: any) {
    throw new StandingGoalError(400, `invalid cron schedule: ${err?.message ?? schedule}`);
  }
}

export function parseStandingTriggers(value: unknown): StandingTrigger[] {
  if (!Array.isArray(value)) {
    throw new StandingGoalError(400, 'triggers must be an array');
  }
  const seen = new Set<string>();
  return value.map((raw: any) => {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    const type = typeof raw?.type === 'string' ? raw.type : '';
    if (!id || seen.has(id)) throw new StandingGoalError(400, `invalid or duplicate trigger id: ${id || '(empty)'}`);
    seen.add(id);
    if (!TRIGGER_TYPES.has(type)) {
      throw new StandingGoalError(400, `unknown trigger type: ${type}`);
    }
    if (type === 'cron') {
      const schedule = typeof raw.schedule === 'string' ? raw.schedule.trim() : '';
      const timezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
      if (!schedule || !timezone) {
        throw new StandingGoalError(400, 'cron triggers require schedule and timezone');
      }
      assertCronShape(schedule, timezone);
      const filter = raw.filter && typeof raw.filter === 'object' && !Array.isArray(raw.filter)
        ? raw.filter as Record<string, unknown>
        : undefined;
      return { id, type, schedule, timezone, ...(filter ? { filter } : {}) };
    }
    if (type === 'event') {
      const eventKinds = Array.isArray(raw.eventKinds)
        ? raw.eventKinds.map((kind: unknown) => String(kind)).filter(Boolean)
        : [];
      if (eventKinds.length === 0) {
        throw new StandingGoalError(400, 'event triggers require at least one event kind');
      }
      const filter = raw.filter && typeof raw.filter === 'object' && !Array.isArray(raw.filter)
        ? raw.filter as Record<string, unknown>
        : undefined;
      return { id, type, eventKinds, ...(filter ? { filter } : {}) };
    }
    return { id, type: 'manual' };
  });
}

export function triggerKeyFor(input: {
  standingGoalId: string;
  trigger: StandingTrigger;
  scheduledAt?: string;
  eventId?: string;
  manualId?: string;
}): string {
  if (input.trigger.type === 'cron' && input.scheduledAt) {
    return `${input.standingGoalId}:cron:${input.scheduledAt}`;
  }
  if (input.trigger.type === 'event' && input.eventId) {
    return `${input.standingGoalId}:event:${input.eventId}`;
  }
  if (input.trigger.type === 'manual' && input.manualId) {
    return `${input.standingGoalId}:manual:${input.manualId}`;
  }
  throw new StandingGoalError(400, `missing id for ${input.trigger.type} trigger ${input.trigger.id}`);
}

export function canStartRun(input: {
  goal: StandingGoal;
  openRuns: GoalRun[];
  todayCostUsd: number;
  now: string;
}): { ok: true } | { ok: false; reason: 'concurrency' | 'budget' | 'cooldown'; message: string } {
  const open = input.openRuns.filter((run) => OPEN_STATUSES.has(run.status));
  if (open.length >= Math.max(1, input.goal.concurrency)) {
    return {
      ok: false,
      reason: 'concurrency',
      message: `standing goal already has ${open.length} open run(s)`,
    };
  }
  const limit = input.goal.budget.perDayCostUsd;
  if (typeof limit === 'number' && input.todayCostUsd >= limit) {
    return {
      ok: false,
      reason: 'budget',
      message: `daily budget exhausted (${input.todayCostUsd}/${limit} USD)`,
    };
  }
  if (input.goal.cooldownMs > 0) {
    const latest = [...input.openRuns]
      .filter((run) => !!run.startedAt)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    if (latest?.startedAt) {
      const elapsed = Date.parse(input.now) - Date.parse(latest.startedAt);
      if (Number.isFinite(elapsed) && elapsed < input.goal.cooldownMs) {
        return {
          ok: false,
          reason: 'cooldown',
          message: `cooldown active (${elapsed}ms < ${input.goal.cooldownMs}ms)`,
        };
      }
    }
  }
  return { ok: true };
}
