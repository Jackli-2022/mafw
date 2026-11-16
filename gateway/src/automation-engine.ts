import { log } from './core/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { CronJob } from 'cron';
import { HarmonicIndexManager } from './core/memory/harmonic-index';
import { CognitiveGraphManager } from './core/memory/cognitive-graph';
import { config } from './config';
import { EnergySystem } from './core/memory/energy-system';
import { ReviewScheduler } from './core/memory/review-scheduler';
import { L5Store } from './core/memory/l5-store';
import { decayRateFor, catdDecayRate } from './core/memory/abstraction-level';
import { getRetrievalEventBuffer, RetrievalEvent } from './core/memory/retrieval-events';
import { actrBonus } from './core/memory/retrieval-bonus';
import { getEmbeddingRuntime } from './memory/embedding-runtime';
import { runEmbeddingBackfill } from './memory/embedding-backfill';
import { backfillT1Vectors } from './memory/t1-backfill';
import { backfillT1Episodes, closeIdleEpisodes } from './recall/t1-episode-rebuild';
import { Scheduler, TaskSkippedError, TaskTimeoutError, BudgetExceededError, TaskBudget } from './scheduler';

import { SchedulerLedger } from './ledger';
import { eventBus } from './event-bus';

export type MemoryActionType = string;

export interface CronTrigger {
  type: 'cron';
  schedule: string;
  timezone: string;
}

export interface EventTrigger {
  type: 'event';
  on: string[];
  perGoalCooldown: string;
}

export type Trigger = CronTrigger | EventTrigger;
export type ActionSource = 'cron' | 'event' | 'user' | 'llm';
export type ActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine,
  source?: ActionSource,
) => Promise<void>;

/** Per-action task metadata merged into the scheduler descriptor when the
 *  engine submits the action for execution. */
export interface RegisteredAction {
  handler: ActionHandler;
  taskOpts?: {
    /** Budget admission (kind:'pipeline' �� pipeline name must match the
     *  pipeline's internal PipelineBudget.allow() name). */
    budget?: TaskBudget;
    /** Watchdog override; default 30 min. */
    timeoutMs?: number;
  };
}

/** External (plugin/bridge) action resolved at execution time. */
export type ExternalActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine,
  source?: ActionSource,
) => Promise<void>;

export interface ExternalActionEntry {
  handler: ExternalActionHandler;
  taskOpts?: RegisteredAction['taskOpts'];
}

export type ExternalActionResolver = (type: string) => ExternalActionEntry | undefined;
/**
 * One energy-decay pass over a HarmonicIndexManager.
 *
 * Runs the one-time v1��v2 baseline migration on the first call (stamping
 * last_decay_at WITHOUT applying decay �� pre-fix passes over-decayed
 * quadratically from created_at, so the past is forgiven), then applies
 * incremental pure-time decay. Mutates the GIVEN manager so the caller's live
 * in-memory index stays authoritative: a throwaway manager would migrate the
 * file, but the live instance's next save would overwrite it back to v1 ��
 * the 2026-09 production freeze (index stuck at v1, zero decay).
 */
export function runEnergyDecay(
  indexManager: HarmonicIndexManager,
  now: number = Date.now(),
  events: RetrievalEvent[] = [],
  /** D5 CATD: topology-weighted decay �� when provided, each entry's decay rate
   *  is scaled by its anchor-graph weighted degree (load-bearing entries
   *  forget slower). */
  catd?: { degreeFor: (id: string) => number; beta?: number },
): { migrated: number; decayed: number; bonused: number } {
  const index = indexManager.getIndex();
  const energySystem = new EnergySystem();
  const nowIso = new Date(now).toISOString();
  const DAY_MS = 24 * 60 * 60 * 1000;
  if ((index.version || 1) < 2) {
    const migrated = indexManager.migrateDecayBaseline(nowIso);
    return { migrated, decayed: 0, bonused: 0 };
  }
  // A3 settlement: group drained retrieval events by id and apply the ACT-R
  // log-form bonus FIRST �� the decay loop below reads the same live entries,
  // so "use it or lose it" nets out within one pass. Bonuses clamp at the
  // 1.0 ceiling; ids no longer in the index (superseded/pruned meanwhile)
  // are dropped silently.
  let bonused = 0;
  if (events.length > 0) {
    const byId = new Map<string, RetrievalEvent[]>();
    for (const e of events) {
      if (!e?.id) continue;
      const list = byId.get(e.id);
      if (list) list.push(e); else byId.set(e.id, [e]);
    }
    const entryById = new Map(index.entries.map((e: any) => [e.id, e]));
    for (const [id, evts] of byId) {
      const entry = entryById.get(id);
      if (!entry) continue;
      const bonus = actrBonus(evts, now);
      const room = Math.max(0, 1.0 - entry.energy);
      const applied = Math.min(bonus, room);
      if (applied > 0.0005) {
        indexManager.updateEnergy(id, applied, { silent: true, save: false });
        bonused++;
      }
    }
  }
  let decayed = 0;
  for (const entry of index.entries) {
    const salience = (entry as any).salience || 1.0;
    // Incremental decay: days since the last APPLIED decay (entries created
    // after the migration have no last_decay_at yet �� fall back to created_at).
    const base = new Date(entry.last_decay_at || entry.created_at || 0).getTime();
    const daysSinceDecay = base > 0 ? Math.max(0, (now - base) / DAY_MS) : 0;
    // Pure time decay �� event bonuses are settled above from the retrieval
    // event buffer (ACT-R form), not from this pass. D5 CATD scales the rate
    // by topological load when a degree provider is wired.
    let rate = decayRateFor(entry.type);
    if (catd) {
      try {
        rate = catdDecayRate(rate, catd.degreeFor(entry.id), catd.beta ?? 0.5);
      } catch { /* fail-open: base rate */ }
    }
    const decayedEnergy = energySystem.decay(entry.energy, daysSinceDecay, salience, rate);
    const diff = entry.energy - decayedEnergy;
    if (diff > 0.005) {
      indexManager.updateEnergy(entry.id, -(diff), { silent: true, save: false });
      // Stamp only when decay is actually applied �� otherwise days keep
      // accumulating until the diff crosses the write threshold (prevents
      // starvation of low-salience / low-rate entries).
      indexManager.stampDecay(entry.id, nowIso);
      decayed++;
    }
  }

  // V2 �� graduation: capped pipeline writes whose 48h window elapsed with
  // no interference graduate to 0.75 (mechanical �� no LLM, independent of
  // the graceRevisit verdict phase). "Survived without PE = stabilized".
  let graduated = 0;
  try {
    const { selectGraduations, COMMITMENT_GRADUATE_TO, commitmentStats } = require('./recall/commitment');
    const grads = selectGraduations(indexManager.getIndex().entries, now);
    for (const id of grads) {
      const entry = indexManager.getIndex().entries.find(e => e.id === id);
      if (!entry) continue;
      indexManager.updateEnergy(id, COMMITMENT_GRADUATE_TO - entry.energy, { silent: true, save: false });
      delete (entry as any).commitment_capped_at;
    }
    if (grads.length > 0) {
      commitmentStats.graduated += grads.length;
      graduated = grads.length;
    }
  } catch { /* fail-open */ }

  indexManager.save();
  // One coalesced notice per pass; desktop only needs to know "energy changed".
  if (decayed > 0 || bonused > 0 || graduated > 0) {
    eventBus.emit('memory_energy_changed', {
      type: 'memory_energy_changed',
      decayed,
      bonused,
      graduated,
    } as any);
  }
  return { migrated: 0, decayed, bonused };
}

/**
 * Builtin actions registered on every engine instance. Each one follows the
 * live-instance discipline: they require the gateway's live managers to be
 * injected (setIndexManagerProvider / setGraphProvider) and skip with a loud
 * warning when absent �� a throwaway manager's writes would be clobbered by
 * the live instance's next save (the 2026-09 decay freeze).
 */
function registerBuiltinActionsOn(engine: AutomationEngine): void {
  engine.registerAction('memory:decay', async (_rule, eng) => {
    log.info('[AutomationEngine] Running energy decay...');
    const indexManager = eng.getLiveIndexManager();
    if (!indexManager) {
      log.warn('[AutomationEngine] memory:decay skipped: no live index manager injected (setIndexManagerProvider)');
      return;
    }
    const heartbeat = eng.getHeartbeat?.();
    try {
      // A3: settle the accumulated retrieval events (ACT-R log bonus + exposure
      // discount) in the same daily pass �� zero extra scheduling.
      const buffer = getRetrievalEventBuffer();
      const events = buffer.drain();
      // D5 CATD: scale decay by anchor-graph weighted degree when enabled.
      let catd: { degreeFor: (id: string) => number; beta?: number } | undefined;
      try {
        if (config.decay?.catd !== false) {
          const graph = indexManager.getAnchorGraphStore?.();
          if (graph) catd = { degreeFor: (id) => graph.weightedDegree(id), beta: config.decay?.catdBeta };
        }
      } catch { catd = undefined; }
      const res = runEnergyDecay(indexManager, Date.now(), events, catd);
      // Coverage top-up: write-path embedding is fire-and-forget (failed batches
      // are dropped), so vectors drift behind the index. Idempotent + fail-open.
      const rt = getEmbeddingRuntime();
      const backfill = await runEmbeddingBackfill(
        rt,
        indexManager.getIndex().entries.map((e) => e.id),
      );
      // T1 verbatim coverage: bounded archive-first backfill of missing vectors.
      let t1Backfill = { indexed: 0, missing: 0, failed: 0 };
      try {
        const db = eng.getGatewayDb?.();
        const t1Cfg = config.recall.t1Recall;
        const limit = t1Cfg?.t1BackfillLimit ?? 200;
        if (db && rt?.t1Indexer && rt?.t1Vectors && limit > 0 && t1Cfg?.enabled !== false) {
          t1Backfill = await backfillT1Vectors(
            {
              listRows: (offset, pageLimit) => db.listT1RowsForBackfill({ offset, limit: pageLimit }),
              hasVector: (key) => Boolean(rt.t1Vectors.get(key)),
              enqueue: (key, text) => rt.t1Indexer.enqueueText(key, text),
              flush: () => rt.t1Indexer.flushQueue(),
            },
            { limit },
          );
        }
      } catch { /* fail-open: T1 coverage converges on a later run */ }
      // T1 retrieval events are observe-only history: prune past retention in
      // the same daily pass (retention never affects energy or ranking).
      let prunedT1 = 0;
      try {
        const db = eng.getGatewayDb?.();
        const retentionDays = config.recall.t1Recall?.retentionDays ?? 90;
        if (db?.pruneT1RetrievalEvents && retentionDays > 0) {
          prunedT1 = db.pruneT1RetrievalEvents({
            before: Math.floor(Date.now() / 1000) - retentionDays * 86400,
          });
        }
      } catch { prunedT1 = 0; }
      if (prunedT1 > 0) {
        log.info(`[AutomationEngine] Pruned ${prunedT1} T1 retrieval event(s) past retention`);
      }
      // Bounded T1 activation decays on the same daily pass; state only — no
      // ranking consumer yet.
      let t1ActivationDecayed = 0;
      try {
        const db = eng.getGatewayDb?.();
        if (db?.decayT1TraceState) {
          t1ActivationDecayed = db.decayT1TraceState({
            halfLifeDays: config.recall.t1Recall?.activationHalfLifeDays ?? 14,
          });
        }
      } catch { t1ActivationDecayed = 0; }
      if (t1ActivationDecayed > 0) {
        log.info(`[AutomationEngine] Decayed activation on ${t1ActivationDecayed} T1 trace(s)`);
      }
      // T1 episode index: close idle tails, then bounded backfill of sessions
      // that have no episodes yet (turn pipeline keeps live sessions current).
      let episodesClosedIdle = 0;
      let episodeBackfill = { scanned: 0, rebuilt: 0, failed: 0 };
      try {
        const db = eng.getGatewayDb?.();
        if (db && config.recall.t1Episodes?.enabled !== false) {
          episodesClosedIdle = closeIdleEpisodes(db, {
            idleMs: config.recall.t1Episodes.idleCloseMs,
          });
          episodeBackfill = backfillT1Episodes(db, { limit: 500, sinceDays: 90 });
        }
      } catch { /* fail-open: episodes converge on a later run */ }
      if (res.migrated > 0) {
        log.info(`[AutomationEngine] Migrated ${res.migrated} entries to incremental decay baseline (v2)`);
      } else {
        log.info(`[AutomationEngine] Energy decay applied to ${res.decayed} entries, bonus to ${res.bonused} (from ${events.length} retrieval events)`);
      }
      heartbeat?.record('memory:decay', {
        ok: backfill.ok,
        error: backfill.ok ? undefined : `backfill: ${backfill.error}`,
        counts: {
          migrated: res.migrated,
          decayed: res.decayed,
          bonused: res.bonused,
          backfillIndexed: backfill.indexed,
          backfillMissing: backfill.missing,
          prunedT1,
          t1BackfillIndexed: t1Backfill.indexed,
          t1BackfillMissing: t1Backfill.missing,
          t1BackfillFailed: t1Backfill.failed,
          t1ActivationDecayed,
          episodesClosedIdle,
          episodesRebuilt: episodeBackfill.rebuilt,
          episodeRebuildFailed: episodeBackfill.failed,
        },
      });
    } catch (err: any) {
      heartbeat?.record('memory:decay', { ok: false, error: err?.message || String(err) });
      throw err;
    }
  });
  engine.registerAction('memory:review', async (_rule, eng) => {
    log.info('[AutomationEngine] Checking review queue...');
    const indexManager = eng.getLiveIndexManager();
    if (!indexManager) {
      log.warn('[AutomationEngine] memory:review skipped: no live index manager injected (setIndexManagerProvider)');
      return;
    }
    const scheduler = new ReviewScheduler(indexManager, eng.mafwDir);
    scheduler.tick();
    const queue = scheduler.getReviewQueue();
    log.info(`[AutomationEngine] Review queue: ${queue.length} items due`);
  });
  engine.registerAction('memory:prune', async (_rule, eng) => {
    log.info('[AutomationEngine] Pruning cognitive graph...');
    const graph = eng.getGraphManager();
    if (!graph) {
      log.warn('[AutomationEngine] memory:prune skipped: no live graph manager injected (setGraphProvider)');
      return;
    }
    const before = graph.getGraph().edges.length;
    graph.prune(0.1);
    const after = graph.getGraph().edges.length;
    const pruned = before - after;
    if (pruned > 0) {
      log.info(`[AutomationEngine] Pruned ${pruned} low-weight edges`);
    } else {
      log.info('[AutomationEngine] No edges to prune');
    }
  });
}

/** Outcome of one action execution, surfaced to interactive callers
 *  (runRuleFromLLM); cron/event callers ignore it. */
export type ActionRunStatus = 'ran' | 'skipped' | 'timeout' | 'denied' | 'error' | 'missing';

export interface AutomationRule {
  id: string;
  enabled: boolean;
  trigger: Trigger;
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
  private _runtimeClient?: import('./runtime/contract').BusinessRuntime;
  private eventListeners: Map<string, Set<string>> = new Map();
  private lastFireTimes: Map<string, number> = new Map();
  private reportedPairs: Set<string> = new Set();
  private eventHandlerRefs: Map<string, Array<{ event: string; handler: (...args: any[]) => void }>> = new Map();
  private _indexManagerProvider?: () => HarmonicIndexManager;
  private _graphProvider?: () => CognitiveGraphManager | undefined;
  private _gatewayDbProvider?: () => import('./memory/gateway-db').GatewayDatabase | undefined;
  private _heartbeat?: import('./recall/pipeline-heartbeat').PipelineHeartbeat;
  private _scheduler?: Scheduler;
  /** Instance-owned action registry �� the dispatch authority. Rebuilt from
   *  builtins + the host provider on start()/reloadRules(). */
  private actions = new Map<string, RegisteredAction>();
  private actionsProvider?: () => void;
  private externalActionResolver?: ExternalActionResolver;
  private stateVersionProvider?: (goalId: string) => number | null;
  /** Monotonic per-engine sequence for task ids (Date.now() collides when two
   *  triggers of the same action land in the same millisecond �� B2 M2). */
  private _actionSeq = 0;

  constructor(mafwDir: string) {
    this.mafwDir = mafwDir;
    this.registerBuiltinActions();
  }

  /** Register an action handler on this engine instance, with optional task
   *  metadata (budget admission / watchdog override) applied when the engine
   *  submits the action through the scheduler. */
  registerAction(type: string, handler: ActionHandler, taskOpts?: RegisteredAction['taskOpts']): void {
    this.actions.set(type, { handler, taskOpts });
  }

  getAction(type: string): ActionHandler | undefined {
    return this.actions.get(type)?.handler;
  }

  hasAction(type: string): boolean {
    return this.actions.has(type);
  }

  /** True when an enabled rule with this id is loaded (catch-up gate). */
  hasRule(id: string): boolean {
    return this.rules.has(id);
  }

  /** Optional bridge for actions that live outside the local map (plugin packs). */
  setExternalActionResolver(resolver: ExternalActionResolver | null): void {
    this.externalActionResolver = resolver ?? undefined;
  }

  /** Resolve a goal's state version from its real project `.mafw` directory. */
  setStateVersionProvider(resolver: ((goalId: string) => number | null) | null): void {
    this.stateVersionProvider = resolver ?? undefined;
  }

  canResolveAction(type: string): boolean {
    if (this.actions.has(type)) return true;
    try {
      return Boolean(this.externalActionResolver?.(type));
    } catch {
      return false;
    }
  }

  /** The host's re-registration hook: called by refreshActions() so the
   *  registry is rebuilt deterministically (start + reloadRules) rather than
   *  depending on registration order. */
  setActionsProvider(fn: () => void): void {
    this.actionsProvider = fn;
  }

  /** Rebuild the action registry: builtins + the host provider. Registrations
   *  made by bare registerAction() are wiped �� the lifecycle contract is
   *  explicit: register through the provider to survive refreshes. */
  refreshActions(): void {
    this.actions.clear();
    this.registerBuiltinActions();
    this.actionsProvider?.();
  }

  private registerBuiltinActions(): void {
    registerBuiltinActionsOn(this);
  }

  /** Inject the unified scheduler. When set, every action execution is
   *  submitted as a scheduler task (per-key skip + 30min watchdog; user/LLM
   *  triggers run at foreground priority). Absent: handlers run directly. */
  setScheduler(s: Scheduler): void {
    this._scheduler = s;
  }

  /** Inject the gateway's live CognitiveGraphManager �� memory:prune must
   *  mutate the SAME instance the gateway keeps in memory, or the live
   *  instance's next save clobbers the prune (same bug class as the decay
   *  freeze). */
  setGraphProvider(fn: () => CognitiveGraphManager | undefined): void {
    this._graphProvider = fn;
  }

  getGraphManager(): CognitiveGraphManager | undefined {
    return this._graphProvider?.();
  }

  /** Inject the pipeline heartbeat so background actions can record outcomes. */
  setHeartbeat(hb: import('./recall/pipeline-heartbeat').PipelineHeartbeat): void {
    this._heartbeat = hb;
  }

  getHeartbeat(): import('./recall/pipeline-heartbeat').PipelineHeartbeat | undefined {
    return this._heartbeat;
  }

  setLedger(ledger: SchedulerLedger): void {
    this._ledger = ledger;
  }

  /**
   * Inject the gateway's live HarmonicIndexManager. Actions that mutate the
   * index (memory:decay) must operate on the SAME instance the gateway keeps
   * in memory �� otherwise their file-level changes are clobbered by the live
   * instance's next save.
   */
  setIndexManagerProvider(fn: () => HarmonicIndexManager): void {
    this._indexManagerProvider = fn;
  }

  getLiveIndexManager(): HarmonicIndexManager | undefined {
    return this._indexManagerProvider?.();
  }

  /** Inject the gateway's live database (T1 retrieval-event retention). */
  setGatewayDbProvider(fn: () => import('./memory/gateway-db').GatewayDatabase | undefined): void {
    this._gatewayDbProvider = fn;
  }

  getGatewayDb(): import('./memory/gateway-db').GatewayDatabase | undefined {
    return this._gatewayDbProvider?.();
  }

  setRuntimeClient(client: import('./runtime/contract').BusinessRuntime): void {
    this._runtimeClient = client;
  }

  get runtimeClient(): import('./runtime/contract').BusinessRuntime | undefined {
    return this._runtimeClient;
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
        log.warn(`[AutomationEngine] Failed to load rule ${file}: ${err.message}`);
      }
    }

    log.info(`[AutomationEngine] Loaded ${this.rules.size} automation rules`);
  }

  // Hot-reload: stop() cancels future cron triggers and event listeners while
  // in-flight handlers run to completion (Node is single-threaded), then rules
  // are rebuilt from disk and rescheduled. start() refreshes the action
  // registry, so the reload also rebuilds it (spec ��5.4).
  reloadRules(): void {
    this.stop();
    this.rules.clear();
    this.loadRules();
    this.start();
    log.info('[AutomationEngine] Rules hot-reloaded');
  }

  start(): void {
    this.refreshActions();
    for (const [id, rule] of this.rules) {
      // Defensive: trigger may be null despite earlier validation (fall-through)
      if (rule.trigger?.type === 'cron') {
        this.scheduleRule(id, rule);
      } else {
        this.scheduleEventRule(id, rule);
      }
    }
  }

  stop(): void {
    const jobCount = this.jobs.size;
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
    const eventRuleIds = Array.from(this.eventHandlerRefs.keys());
    for (const id of eventRuleIds) {
      this.unregisterEventRule(id);
    }
    log.info(`[AutomationEngine] Stopped ${jobCount} cron jobs and cleaned up event listeners`);
  }

  private scheduleRule(id: string, rule: AutomationRule): void {
    try {
      const cronTrigger = rule.trigger as CronTrigger;
      // unrefTimeout (9th arg): cron timers must not keep the process alive
      // (tests, daemon shutdown). The gateway owns the process lifecycle; a
      // dangling scheduled tick should never block exit.
      const job = new CronJob(
        cronTrigger.schedule,
        () => {
          void this.executeRule(id, 'cron', this._ledger).catch((err) =>
            log.error(`[AutomationEngine] cron rule ${id} failed: ${err?.message || err}`),
          );
        },
        null,
        true,
        cronTrigger.timezone,
        null as any,
        undefined,
        undefined,
        true,
      );
      this.jobs.set(id, job);
      log.info(`[AutomationEngine] Scheduled rule ${id}: ${cronTrigger.schedule} (${cronTrigger.timezone})`);
    } catch (err: any) {
      log.warn(`[AutomationEngine] Failed to schedule rule ${id}: ${err.message}`);
    }
  }

  private scheduleEventRule(id: string, rule: AutomationRule): void {
    const et = rule.trigger as EventTrigger;
    for (const eventName of et.on) {
      if (!this.eventListeners.has(eventName)) {
        this.eventListeners.set(eventName, new Set());
      }
      this.eventListeners.get(eventName)!.add(id);
    }
    log.info(`[AutomationEngine] Registered event rule ${id} for events: ${et.on.join(', ')}`);

    const handler = (_data: any) => {
      const goalId = _data?.goalId;
      if (!goalId) return;
      const version = this.getStateVersion(goalId);
      this.fireEventRule(rule, goalId, version === null ? undefined : `goal:${version}`);
    };

    const refs: Array<{ event: string; handler: (...args: any[]) => void }> = [];
    for (const eventName of et.on) {
      // Plugin events arrive through the PluginEventRegistry sink, not eventBus.
      if (eventName.startsWith('plugin:')) continue;
      eventBus.on(eventName, handler);
      refs.push({ event: eventName, handler });
    }
    this.eventHandlerRefs.set(id, refs);
  }

  /**
   * External event ingress (plugin event sink). Goal events keep the
   * `goal + stateVersion` dedupe; other events use the session/global scope
   * plus the rule cooldown only.
   */
  handleExternalEvent(event: {
    type: string;
    properties?: Record<string, unknown>;
    sessionID?: string;
  }): void {
    if (!event || typeof event.type !== 'string') return;
    const properties = event.properties ?? {};
    const rawGoalId = typeof properties.goalId === 'string' ? properties.goalId : undefined;
    const goalId = rawGoalId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rawGoalId) ? rawGoalId : undefined;
    const scopeId = goalId ?? event.sessionID ?? 'external';
    const version = goalId ? this.getStateVersion(goalId) : null;
    const dedupeKey = version === null ? undefined : `goal:${version}`;

    for (const rule of this.rules.values()) {
      if (!rule.enabled || rule.trigger?.type !== 'event') continue;
      if (!rule.trigger.on.includes(event.type)) continue;
      try {
        // External events are package-controlled; enforce a small floor so a
        // missing/typo'd cooldown cannot create an event storm.
        this.fireEventRule(rule, scopeId, dedupeKey, 1000);
      } catch (err: any) {
        log.warn(`[AutomationEngine] External event rule ${rule.id} failed: ${err?.message || err}`);
      }
    }
  }

  private fireEventRule(
    rule: AutomationRule,
    scopeId: string,
    dedupeKey?: string,
    minCooldownMs = 0,
  ): void {
    const et = rule.trigger as EventTrigger;

    const cooldownMs = Math.max(parseDuration(et.perGoalCooldown) ?? 0, minCooldownMs);
    const lastFire = this.lastFireTimes.get(`${rule.id}:${scopeId}`);
    if (lastFire && Date.now() - lastFire < cooldownMs) return;

    let pairKey: string | undefined;
    if (dedupeKey) {
      pairKey = `${rule.id}:${scopeId}:${dedupeKey}`;
      if (this.reportedPairs.has(pairKey)) return;
    }

    this.lastFireTimes.set(`${rule.id}:${scopeId}`, Date.now());
    if (pairKey) this.reportedPairs.add(pairKey);
    this.pruneEventState();

    if (rule.action) {
      void this.executeRule(rule.id, 'event', this._ledger).catch((err) =>
        log.error(`[AutomationEngine] event rule ${rule.id} failed: ${err?.message || err}`),
      );
    }
  }

  private getStateVersion(goalId: string): number | null {
    if (this.stateVersionProvider) {
      try {
        return this.stateVersionProvider(goalId);
      } catch {
        return null;
      }
    }
    const stateFile = path.join(this.mafwDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(stateFile)) return null;
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      return typeof state.stateVersion === 'number' ? state.stateVersion : null;
    } catch {
      return null;
    }
  }

  /** Bound event bookkeeping; insertion order makes the oldest entries go first. */
  private pruneEventState(): void {
    const limit = 5000;
    const target = 4000;
    if (this.lastFireTimes.size > limit) {
      for (const key of this.lastFireTimes.keys()) {
        if (this.lastFireTimes.size <= target) break;
        this.lastFireTimes.delete(key);
      }
    }
    if (this.reportedPairs.size > limit) {
      for (const key of this.reportedPairs) {
        if (this.reportedPairs.size <= target) break;
        this.reportedPairs.delete(key);
      }
    }
  }

  private unregisterEventRule(id: string): void {
    const refs = this.eventHandlerRefs.get(id);
    if (refs) {
      for (const { event, handler } of refs) {
        eventBus.off(event, handler);
      }
      this.eventHandlerRefs.delete(id);
    }
    this.eventListeners.forEach((ids) => ids.delete(id));
    for (const key of this.lastFireTimes.keys()) {
      if (key.startsWith(`${id}:`)) this.lastFireTimes.delete(key);
    }
    for (const key of this.reportedPairs) {
      if (key.startsWith(`${id}:`)) this.reportedPairs.delete(key);
    }
  }

  async executeRule(id: string, source?: 'cron' | 'event' | 'user', ledger?: SchedulerLedger): Promise<void> {
    const rule = this.rules.get(id);
    if (!rule) {
      log.warn(`[AutomationEngine] Rule not found: ${id}`);
      return;
    }

    log.info(`[AutomationEngine] Executing rule ${id}${rule.action ? ` [action: ${rule.action.type}]` : ''} (source=${source || 'cron'})`);

    eventBus.emit('automation_triggered', {
      type: 'automation_triggered',
      ruleId: id,
      action: rule.action?.type || null,
      source: source || 'cron',
    });

    if (rule.action) {
      await this.executeAction(rule.action.type, rule, source);
      const result = { action: rule.action.type };
      eventBus.emit('automation_completed', {
        type: 'automation_completed',
        ruleId: id,
        result,
      });
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
      log.info(`[AutomationEngine] Rule ${id} has no action, skill, or onResult �� skipping`);
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

  private async executeAction(
    actionType: string,
    rule: AutomationRule,
    source?: ActionSource,
  ): Promise<ActionRunStatus> {
    const local = this.actions.get(actionType);
    let external: ExternalActionEntry | undefined;
    if (!local) {
      try {
        external = this.externalActionResolver?.(actionType);
      } catch {
        external = undefined;
      }
    }
    const handler = local?.handler ?? external?.handler;
    const taskOpts = local?.taskOpts ?? external?.taskOpts;
    if (!handler) {
      log.warn(`[AutomationEngine] No handler registered for action: ${actionType}`);
      return 'missing';
    }

    // Standalone engines (tests, embedders without a scheduler) run handlers
    // directly �� the scheduler is an optimization/discipline layer, not a
    // hard dependency.
    if (!this._scheduler) {
      try {
        await handler(rule, this, source);
        return 'ran';
      } catch (err: any) {
        log.error(`[AutomationEngine] Action ${actionType} failed: ${err instanceof Error ? err.message : err}`);
        return 'error';
      }
    }

    // Unified submission: per-key skip, 30min watchdog (overridable via
    // taskOpts), budget admission. User/LLM triggers are foreground (an
    // interactive caller is waiting); cron/event triggers are background.
    try {
      await this._scheduler.submit(
        {
          id: `automation:${actionType}:${++this._actionSeq}`,
          priority: source === 'user' || source === 'llm' ? 'foreground' : 'background',
          mutexKey: `action:${actionType}`,
          strategy: 'skip',
          timeoutMs: taskOpts?.timeoutMs ?? 30 * 60_000,
          budget: taskOpts?.budget,
        },
        () => handler(rule, this, source),
      );
      return 'ran';
    } catch (err) {
      if (err instanceof TaskSkippedError) {
        log.info(`[AutomationEngine] ${actionType} skipped: previous run still in flight`);
        return 'skipped';
      }
      if (err instanceof TaskTimeoutError) {
        log.warn(`[AutomationEngine] ${actionType} watchdog timeout (${err.message}) �� run continues in background`);
        return 'timeout';
      }
      if (err instanceof BudgetExceededError) {
        log.warn(`[AutomationEngine] ${actionType} denied by budget: ${err.message}`);
        return 'denied';
      }
      log.error(`[AutomationEngine] Action ${actionType} failed: ${err instanceof Error ? err.message : err}`);
      return 'error';
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

    log.info(`[AutomationEngine] Created triage: ${triageId}`);
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

    log.info(`[AutomationEngine] Created goal: ${goalId}`);
  }

  // ── Tier 1: Read-only methods ──

  getRules(): AutomationRule[] {
    const rules = Array.from(this.rules.values());
    const autoDir = path.join(this.mafwDir, 'automations');
    if (fs.existsSync(autoDir)) {
      for (const file of fs.readdirSync(autoDir).filter((f: string) => f.endsWith('.json'))) {
        try {
          const rule: AutomationRule = JSON.parse(fs.readFileSync(path.join(autoDir, file), 'utf-8'));
          if (!rule.id) rule.id = file.replace('.json', '');
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
    const filePath = this.existingAutomationRulePath(id);
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
    if (rule.trigger.type !== 'cron') return { next5: [] };
    const cronTrigger = rule.trigger as CronTrigger;
    const next5: string[] = [];
    try {
      const job = new CronJob(
        cronTrigger.schedule,
        () => {},
        null,
        false,
        cronTrigger.timezone,
      );
      const dates = job.nextDates(count);
      for (const dt of dates) {
        next5.push(dt.toJSDate().toISOString());
      }
      job.stop();
    } catch {
      // invalid cron —return empty
    }
    return { next5 };
  }

  // ── Tier 2: Safe action methods ──

  async runRuleFromLLM(id: string, ledger: SchedulerLedger): Promise<{ triageId: string; message: string }> {
    const rule = this.rules.get(id);
    if (!rule) throw new Error(`Rule not found: ${id}`);

    if (!rule.action && !rule.skill) {
      throw new Error(`Rule ${id} has no action or skill �� nothing to run`);
    }

    log.info(`[AutomationEngine] LLM triggered rule ${id}`);

    if (rule.action) {
      const status = await this.executeAction(rule.action.type, rule, 'llm');
      ledger.append({
        timestamp: new Date().toISOString(),
        event: 'AUTOMATION_TRIGGERED',
        ruleId: id,
        source: 'llm',
        reason: `action:${rule.action.type} (LLM-triggered)`,
      });
      return { triageId: '', message: `Action ${rule.action.type} ${status === 'ran' ? 'executed' : status}` };
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
    return { triageId, message: `Scan complete �� triage item ${triageId} created (pending your confirmation)` };
  }

  validateRule(rule: AutomationRule): ValidationResult {
    const errors: string[] = [];

    if (!rule.id || typeof rule.id !== 'string') {
      errors.push('Rule must have a string id');
    }
    if (!rule.trigger || (rule.trigger.type !== 'cron' && rule.trigger.type !== 'event')) {
      errors.push('Trigger type must be "cron" or "event"');
    }
    if (rule.trigger?.type === 'cron') {
      const ct = rule.trigger as CronTrigger;
      if (typeof ct.schedule !== 'string' || ct.schedule.trim() === '') {
        errors.push('Schedule must be a non-empty cron expression');
      } else {
        try {
          const job = new CronJob(ct.schedule, () => {}, null, false, ct.timezone || 'UTC');
          job.stop();
        } catch (e: any) {
          errors.push(`Invalid cron expression: ${e.message}`);
        }
      }
      if (ct.timezone && !Intl.supportedValuesOf?.('timeZone')?.includes(ct.timezone)) {
        try { new Intl.DateTimeFormat(undefined, { timeZone: ct.timezone }); } catch {
          errors.push(`Invalid timezone: ${ct.timezone}`);
        }
      }
    }
    if (rule.trigger?.type === 'event') {
      const et = rule.trigger as EventTrigger;
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
    if (rule.action && !this.canResolveAction(rule.action.type)) {
      errors.push(`Unknown action type: ${rule.action.type}`);
    }
    if (rule.onResult && !['triage', 'goal'].includes(rule.onResult.type)) {
      errors.push(`onResult.type must be "triage" or "goal", got "${rule.onResult.type}"`);
    }

    let nextTriggers: string[] = [];
    if (errors.length === 0 && rule.trigger?.type === 'cron') {
      const ct = rule.trigger as CronTrigger;
      try {
        const job = new CronJob(ct.schedule, () => {}, null, false, ct.timezone || 'UTC');
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

    const existingPath = this.existingAutomationRulePath(String(rule.id));
    if (fs.existsSync(existingPath)) {
      const existing: AutomationRule = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
      if (existing.enabled) {
        return { id: rule.id, valid: false, errors: [`Rule "${rule.id}" is already enabled �� cannot overwrite. Disable it first or use a different id`] };
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
    const filePath = this.existingAutomationRulePath(id);
    if (!fs.existsSync(filePath)) return false;
    try {
      const rule: AutomationRule = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      rule.enabled = enabled;
      rule.id = id;
      fs.writeFileSync(filePath, JSON.stringify(rule, null, 2), 'utf-8');
      if (enabled) {
        this.rules.set(id, rule);
        // Defensive: trigger may be null despite earlier validation (fall-through)
        if (rule.trigger?.type === 'cron') {
          this.scheduleRule(id, rule);
        } else {
          this.scheduleEventRule(id, rule);
        }
      } else {
        this.rules.delete(id);
        const job = this.jobs.get(id);
        if (job) { job.stop(); this.jobs.delete(id); }
        this.unregisterEventRule(id);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Filesystem-safe (and reversible) filename for a logical automation rule id. */
  private automationRulePath(id: string): string {
    const safe = Buffer.from(id, 'utf8').toString('base64url');
    return path.join(this.mafwDir, 'automations', `${safe}.json`);
  }

  /** Prefer the encoded path, but keep legacy human-readable rule files working. */
  private existingAutomationRulePath(id: string): string {
    const encoded = this.automationRulePath(id);
    if (fs.existsSync(encoded)) return encoded;
    if (!/[<>:"/\\|?*\u0000-\u001f]/.test(id)) {
      const legacy = path.join(this.mafwDir, 'automations', `${id}.json`);
      if (fs.existsSync(legacy)) return legacy;
    }
    return encoded;
  }

  deleteRule(id: string): boolean {
    const filePath = this.existingAutomationRulePath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    this.rules.delete(id);
    const job = this.jobs.get(id);
    if (job) { job.stop(); this.jobs.delete(id); }
    return true;
  }

  /** P2.5: register one Standing Goal cron trigger as an automation rule. */
  registerStandingCron(input: {
    key: string;
    schedule: string;
    timezone: string;
    standingGoalId: string;
    triggerId: string;
  }): { nextRunAt: string | null } {
    const rule: AutomationRule = {
      id: input.key,
      enabled: true,
      trigger: { type: 'cron', schedule: input.schedule, timezone: input.timezone },
      action: { type: 'standing_goal:tick' },
      args: { standingGoalId: input.standingGoalId, triggerId: input.triggerId },
    };
    const autoDir = path.join(this.mafwDir, 'automations');
    if (!fs.existsSync(autoDir)) fs.mkdirSync(autoDir, { recursive: true });
    fs.writeFileSync(this.automationRulePath(input.key), JSON.stringify(rule, null, 2), 'utf-8');
    const previous = this.jobs.get(input.key);
    if (previous) { previous.stop(); this.jobs.delete(input.key); }
    this.rules.set(input.key, rule);
    this.scheduleRule(input.key, rule);
    return { nextRunAt: this.getNextTriggers(rule, 1).next5[0] ?? null };
  }

  /** Next cron fire time for a Standing Goal rule (best effort). */
  nextStandingCronRun(key: string): string | null {
    const rule = this.rules.get(key);
    return rule ? (this.getNextTriggers(rule, 1).next5[0] ?? null) : null;
  }

  unregisterStandingCron(key: string): void {
    const job = this.jobs.get(key);
    if (job) { job.stop(); this.jobs.delete(key); }
    this.rules.delete(key);
    try {
      const filePath = this.automationRulePath(key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* best effort */ }
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

    log.info(`[AutomationEngine] LLM-created triage (auto_confirm forced false): ${triageId}`);
    return triageId;
  }
}

export function parseDuration(d: string): number | undefined {
  const num = parseInt(d);
  if (isNaN(num)) return undefined;
  if (d.endsWith('s')) return num * 1000;
  if (d.endsWith('m')) return num * 60 * 1000;
  if (d.endsWith('h')) return num * 60 * 60 * 1000;
  return undefined;
}



