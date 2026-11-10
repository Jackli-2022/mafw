import { PodError, PodStore, isTerminalGoalRevisionStatus, type PodGoalRevisionStatus, type PodGoalRow, type PodProbeRow, type PodRow } from './pod-store';
import type { PodService } from './pod-service';
import { canonicalProjectDir } from './pod-identity';
import {
  buildPodAttention,
  buildPodGoalView,
  type PodGoalDescription,
  type PodGoalView,
} from './pod-view';
import type { PodAttentionItem, PodGoalVerdict, PodQueueReason } from './pod-stage';
import { isAcceptablePodResult, type PodGoalResult, type PodResultWorktree } from './pod-result';
import type { PodGoalWorktreeRow } from './pod-store';
import type { PodWorktreeService, PodWorktreeDiff } from './pod-worktree-service';
import { podTaskKindOf } from './pod-task-service';
import { summarizePodGoalProgress } from './pod-goal-progress';
import { planPromotions } from './pod-scheduler';
import { deriveAttention } from '../lead/attention';
import type {
  FinishRevisionInput,
  FinishRevisionResult,
  ReopenAfterRejectOptions,
  RejectRevisionResult,
} from './pod-goal-revision-service';

export interface PodEnqueueResult {
  /** discussing = Tech Lead discussion Goal (active but no NodeDriver run). */
  status: 'started' | 'queued' | 'discussing';
  podId: string;
  queueReason: PodQueueReason | null;
}

function resultWorktree(row: PodGoalWorktreeRow): PodResultWorktree {
  return {
    dir: row.dir,
    branch: row.branch,
    baseBranch: row.baseBranch,
    status: row.status,
    mergeCommit: row.mergeCommit,
    mergedAt: row.mergedAt,
  };
}

/** 闂佺懓鐏氶幐绋棵洪弽顐ょ＜闁规儳顕禍顖炴煥濞戞ɑ娌焌sk 16闂佹寧绋戦¨鈧紒鍙樺嵆瀹曘儳浠﹂懖鈺婁紘 Goal 闂佹眹鍔岀€氼亞绮崨顔锯枖闁?revision闂佹寧绋戦惌渚€顢樼捄銊﹀闁惧繐婀辫ぐ宀勬煕濡ゅ嫭鐝ù鐙€鍠楀鍕吋閸愶絽浜?*/
export interface PodRejectResult {
  podId: string;
  goalId: string;
  revision: number;
  status: PodGoalRevisionStatus;
  priority: number;
  feedback: string;
  archivedState: string | null;
  previous: RejectRevisionResult['previous'];
  /** Tech Lead 闁荤姳闄嶉崝蹇涱敊閹寸偛顕辨慨妯虹－濡牓鏌ㄥ☉妯煎ⅵ闁革絿顭堥?婵犮垼娉涚粔鍫曞极閵堝鍎?scoped session闂佹寧绋戦ˇ顓㈠焵?*/
  sessionID: string | null;
  sessionError?: string;
}

export interface PodGoalAcceptResult {
  podId: string;
  goalId: string;
  revision: number;
  branch: string;
  mergeCommit: string;
  mergedAt: string;
}

/** 闁诲海鎳撻張顒勫垂濮樿埖鐒绘慨妯夸含閸欌偓缂傚倷鐒﹂幐濠氭倶婢舵劖鏅慨姗嗗墯閸婂崬鈽夐幘顖氫壕 revision 闂佸憡鐟禍婊呯不瀹ュ绠绘い鎾寸箘椤忚鲸绻涢崱顓犵？缂侇喓鍔戝绋款煥閳ь剛鑺遍妸锔绢浄闂婎剚绁撮崑?*/
export interface PodResultNotification {
  podId: string;
  goalId: string;
  revision: number;
  verdict: PodGoalVerdict | null;
  /** true = 闂佸搫鐗滈崜姘额敃閼测晜瀚柛鎰典簼閺嗗繑顨ラ悙鏉戭嚋闁规瓕椴哥粋宥夊幢濞嗘垶灏濋梺鍝勵儐缁牏鑺遍妸锔绢浄闂婎剚绁撮崑?*/
  notified: boolean;
  /** true = 闁?revision 閻庤鐡曠亸娆戝垝閿熺姵鐒绘慨妯夸含閸欌偓闁哄鏅涘ù鍕濞嗘挻鐓傜€广儱鎷嬪Σ濠氭偣鐎ｎ亜鏆熼柡浣靛€栫粙澶婎吋婢跺﹥顏熸繝銏ｆ硾缁夊绮诲澶婄妞ゆ挶鍔庣粈鍡涙煏?*/
  duplicate: boolean;
}

/** 闂佺懓鐏氶幐绋棵洪弽顓炵闁逞屽墴濡線鍩€椤掑嫭鍎?revision 闂佹眹鍨婚崰搴ㄥ箠閿熺姴宸濋柕濠忛檮閸╁倿鏌ょ€圭姵顥夊┑顔肩箻閺佸秹宕烽惄绺甼 4 service闂佹寧绋掔粙鎺斺偓鍨矒濡線鍩€椤掆偓閳绘棃濡搁妷銉ユ辈闂佹寧绋戦ˇ顓㈠焵?*/
export interface PodRevisionLifecycle {
  finishRevision(goalId: string, input: FinishRevisionInput): FinishRevisionResult;
  reopenAfterReject(
    goalId: string,
    feedback: string,
    opts?: ReopenAfterRejectOptions,
  ): Promise<RejectRevisionResult>;
}

export interface PodGoalServiceDeps {
  store: PodStore;
  pods: PodService;
  startGoal(goalId: string, projectDirHint?: string): Promise<void>;
  advanceGoal?(goalId: string): Promise<void>;
  resolveProjectDir(goalId: string): string | null;
  now(): string;
  newId(): string;
  notify(podId: string, kind?: string, goalId?: string): void;
  /** P2: Goal reached a terminal state (memory promotion hook, fail-open). */
  onGoalCompleted?(goalId: string, outcome?: { verdict?: string }): void;
  budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } };
  /** P2: max normal slots per Pod (default 1; MAFW_POD_MAX_GOALS). */
  maxConcurrentGoals?(): number;
  goalState?(goalId: string): { terminal: boolean; verdict?: string } | null;
  describeGoal?(goalId: string): PodGoalDescription | null;
  resultForGoal?(goalId: string): PodGoalResult | null;
  listInFlightGoals?(projectDir: string): string[];
  listRegisteredProjectDirs?(): string[];
  finalizeGoal?(goalId: string, outcome?: { verdict?: string }): Promise<void>;
  /** Task 4闂佹寧绋掗鐞玽ision 闂佽　鍋撻悹楦挎閸?/ 闂佺懓鐏氶幐绋棵洪弽褜鍤曢柍褜鍓氱粙澶屸偓锝傛櫇椤忛亶鏌ｅΔ鈧悧鍕焵?*/
  revisions?: PodRevisionLifecycle;
  /** Revision session retirement (Tech Lead discussion lease). */
  sessions?: { retireRevision(goalId: string, revision: number): Promise<boolean> };
  /** Task 10闂佹寧绋掔喊宥嗘櫠閿曞倸鐐婇柣鎰级閸婄數绱掗弬娆惧剰鐎规挸妫濋獮渚€濮€閻欌偓濡插鎮?Goal 闂?Tech Lead 闁荤姳闄嶉崝蹇涱敊閹寸偛顕辨慨妯虹－濡牓鏌?*/
  techLead?: { ensureSession(goalId: string): Promise<string> };
  /** Task 6闂佹寧绋掔喊宥嗘櫠閿曞倸鐐婇柣鎰絻閸愨偓婵☆偓绲介悧鍛礊閺冣偓缁嬪鎮滃Ο鑽ゅ幍闂佸憡纰嶉崹鐢稿窗閸涱垪鍋撶憴鍕殤婵炲牊鍨跺蹇涘箻閸愭彃姹查梺鎸庣☉濞煎pend-only闂佹寧绋戞總鏃傜箔婢舵劕绠抽柕濞垮劚琚熼梻鍌氬暢閸╂牠顢欏畝鍕櫖濠㈣泛鐗冮崑?*/
  directions?: { recordRejectInput(input: {
    goalId: string;
    revision?: number;
    feedback: string;
    source?: string | null;
  }): unknown };
  /** Revision worktree lifecycle; production always injects PodWorktreeService. */
  worktrees?: Pick<PodWorktreeService, 'get' | 'ensure' | 'commitPending' | 'mergeForAcceptance' | 'markAbandoned' | 'branchDiff'>;
  log?(message: string): void;
}

export class PodGoalService {
  /** 閻庣懓鎲¤ぐ鍐不瀹ュ绠绘い鎿勭磿缁犳牜绱撴担瑙勫鞍闁诲繐顦扮粋宥団偓锝傛櫆椤愪粙鏌?`<podId>/<goalId>#<revision>`闂佹寧绋戝瀹攕t-effort 闂佸憡锚椤兘宕抽幖浣规櫖婵炴垯鍨瑰▍銏ゆ煕濮樼厧鐏犻柟顔筋殜瀵敻鍩€椤掍礁绶炴慨妯挎硾濞呫垽鏌涘▎鎰仯缂佹梹娼欓埢搴ㄥ煡閸涱垳顦梺?*/
  private readonly notifiedResults = new Set<string>();
  /** Accept/reject must be serialized per Goal: a rejected revision can never merge later. */
  private readonly goalMutations = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: PodGoalServiceDeps) {}

  private runGoalMutation<T>(podId: string, goalId: string, run: () => Promise<T>): Promise<T> {
    const key = `${podId}\u0000${goalId}`;
    const previous = this.goalMutations.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(run);
    let tail: Promise<unknown>;
    const cleanup = () => {
      if (this.goalMutations.get(key) === tail) this.goalMutations.delete(key);
    };
    tail = result.then(cleanup, cleanup);
    this.goalMutations.set(key, tail);
    return result;
  }

  async enqueueGoal(
    goalId: string,
    projectDirHint?: string,
  ): Promise<PodEnqueueResult> {
    const projectDir = projectDirHint ?? this.deps.resolveProjectDir(goalId);
    if (!projectDir) throw new PodError(400, `project not resolved for goal: ${goalId}`);
    const detail = await this.deps.pods.ensure(projectDir);
    const pod = detail.pod;
    const existing = this.deps.store.getGoal(pod.id, goalId);
    if (existing) {
      if (existing.status === 'active') {
        // An active row is not necessarily a running NodeDriver: a discussion Goal
        // is active by design but must report discussing/queued, never started.
        if (this.isStartable(existing.goalId)) {
          return { status: 'started', podId: pod.id, queueReason: null };
        }
        const revision = this.deps.store.getGoalRevision(
          pod.id,
          existing.goalId,
          existing.activeRevision,
        );
        return {
          status: revision?.status === 'direction_review' ? 'queued' : 'discussing',
          podId: pod.id,
          queueReason: null,
        };
      }
      if (existing.status === 'queued' && this.hasCapacity(pod.id)
        && pod.status !== 'paused' && pod.status !== 'archived') {
        const budget = this.deps.budget?.canStart(pod.id);
        if (!budget || budget.ok) await this.promote(pod.id);
        const current = this.deps.store.getGoal(pod.id, goalId);
        return {
          status: current?.status === 'active' ? 'started' : 'queued',
          podId: pod.id,
          queueReason: current?.status === 'active' ? null : (this.queueReasonFor(pod, current!) ?? null),
        };
      }
      return { status: 'queued', podId: pod.id, queueReason: this.queueReasonFor(pod, existing) ?? null };
    }

    const row = this.deps.store.enqueueGoal({
      id: this.deps.newId(),
      podId: pod.id,
      goalId,
      now: this.deps.now(),
    });
    const olderQueued = this.deps.store.listGoals(pod.id)
      .some((candidate) => candidate.id !== row.id && candidate.status === 'queued');
    const budget = this.deps.budget?.canStart(pod.id);
    if (pod.status === 'paused' || pod.status === 'archived' || !this.hasCapacity(pod.id) || (budget && !budget.ok)) {
      this.deps.notify(pod.id);
      return { status: 'queued', podId: pod.id, queueReason: this.queueReasonFor(pod, row) ?? null };
    }
    if (olderQueued) {
      await this.promote(pod.id);
      this.deps.notify(pod.id);
      const current = this.deps.store.getGoal(pod.id, goalId);
      return {
        status: current?.status === 'active' ? 'started' : 'queued',
        podId: pod.id,
        queueReason: current?.status === 'active' ? null : (this.queueReasonFor(pod, current ?? row) ?? null),
      };
    }

    await this.startQueued(row.id, pod.id, goalId, pod.projectDir);
    this.deps.notify(pod.id);
    const afterStart = this.deps.store.getGoal(pod.id, goalId) ?? row;
    return {
      status: afterStart.status === 'active' ? 'started' : 'queued',
      podId: pod.id,
      queueReason: afterStart.status === 'active' ? null : (this.queueReasonFor(pod, afterStart) ?? null),
    };
  }

  async onGoalArchived(
    goalId: string,
    outcome?: { verdict?: string },
  ): Promise<void> {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return;
    if (goal.status === 'done' || goal.status === 'aborted') return;
    const pod = this.deps.store.getPod(goal.podId);
    if (!pod) return;

    const wasActive = pod.status !== 'paused' && pod.status !== 'archived'
      && (pod.activeGoalId === goal.goalId || this.deps.store.listActiveGoals(pod.id).length > 0);
    const verdict = normalizeVerdict(outcome?.verdict);
    const nextStatus = verdict === 'CANCELLED' ? 'aborted' : 'done';
    this.deps.store.setGoalStatus(goal.id, nextStatus, {
      endedAt: this.deps.now(),
      ...(verdict ? { verdict } : {}),
    });
    try {
      this.deps.onGoalCompleted?.(goalId, outcome);
    } catch {
      /* fail-open: memory promotion must not block Goal archival */
    }

    const remaining = this.deps.store.listActiveGoals(pod.id);
    const pointerStillValid = remaining.some((candidate) => candidate.goalId === pod.activeGoalId);
    const nextPointer = pointerStillValid ? pod.activeGoalId : (remaining[0]?.goalId ?? null);
    if (pod.activeGoalId === goal.goalId || !pointerStillValid) {
      this.deps.store.updatePod(pod.id, {
        activeGoalId: nextPointer,
        status: pod.status === 'paused' || pod.status === 'archived'
          ? pod.status
          : (remaining.length > 0 ? 'active' : 'idle'),
      }, this.deps.now());
    }
    if (!wasActive) {
      this.deps.notify(pod.id);
      return;
    }
    if (pod.status === 'paused' || pod.status === 'archived') {
      this.deps.notify(pod.id);
      return;
    }
    await this.promote(pod.id);
    this.deps.notify(pod.id);
  }

  /** Public admission check for a brand-new Goal (queued goal does not count yet). */
  canAdmitGoal(podId: string): boolean {
    const pod = this.deps.store.getPod(podId);
    if (!pod || pod.status === 'paused' || pod.status === 'archived') return false;
    return this.deps.store.listActiveGoals(podId).length < this.capacityFor(podId);
  }

  /**
   * Admit a Goal whose direction decision is done. Starts it when a slot is
   * free; otherwise parks it in the queue so the scheduler can promote it later.
   */
  async admitReadyGoal(goalId: string, projectDirHint?: string): Promise<boolean> {
    const row = this.deps.store.getGoalByGoalId(goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    const pod = this.deps.store.getPod(row.podId);
    if (!pod) throw new PodError(404, `pod not found: ${row.podId}`);
    if (!this.isStartable(goalId)) return false;
    if (pod.status === 'paused' || pod.status === 'archived') return false;

    const activeOthers = this.deps.store.listActiveGoals(pod.id)
      .filter((candidate) => candidate.goalId !== goalId);
    if (activeOthers.length >= this.capacityFor(pod.id, goalId)) {
      if (row.status === 'active') this.deps.store.setGoalStatus(row.id, 'queued', {});
      const pointer = pod.activeGoalId === goalId
        ? (activeOthers[0]?.goalId ?? null)
        : pod.activeGoalId;
      this.deps.store.updatePod(pod.id, {
        activeGoalId: pointer,
        status: pointer ? 'active' : 'idle',
      }, this.deps.now());
      this.deps.notify(pod.id);
      return false;
    }

    await this.startQueued(row.id, pod.id, goalId, projectDirHint ?? pod.projectDir);
    this.deps.notify(pod.id);
    return true;
  }

  async promote(podId: string): Promise<boolean> {
    const pod = this.deps.store.getPod(podId);
    if (!pod || pod.status === 'paused' || pod.status === 'archived') return false;
    const budget = this.deps.budget?.canStart(podId);
    if (budget && !budget.ok) return false;

    const goals = this.deps.store.listGoals(podId);
    const humanAttention = new Set(
      deriveAttention(this.views(podId).filter((view) => !view.stateMissing)).map((item) => item.goalId),
    );
    const toCandidate = (goal: PodGoalRow) => ({
      goalId: goal.goalId,
      active: goal.status === 'active',
      priority: goal.priority ?? 0,
      enqueuedAt: goal.enqueuedAt,
      humanAttention: humanAttention.has(goal.goalId),
    });
    const active = goals.filter((goal) => goal.status === 'active').map(toCandidate);
    const queued = goals
      .filter((goal) => goal.status === 'queued' && this.isStartable(goal.goalId))
      .map(toCandidate);
    const plan = planPromotions({ active, queued, maxConcurrent: this.maxConcurrent() });

    let started = false;
    for (const goalId of plan.start) {
      const row = goals.find((goal) => goal.goalId === goalId);
      if (!row) continue;
      await this.startQueued(row.id, podId, goalId, pod.projectDir);
      started = true;
    }
    if (started) this.deps.notify(podId);
    return started;
  }

  schedulerStatus(podId: string): {
    active: string[];
    queued: string[];
    capacity: number;
    plan: ReturnType<typeof planPromotions>;
  } | null {
    const pod = this.deps.store.getPod(podId);
    if (!pod) return null;
    const goals = this.deps.store.listGoals(podId);
    const humanAttention = new Set(
      deriveAttention(this.views(podId).filter((view) => !view.stateMissing)).map((item) => item.goalId),
    );
    const toCandidate = (goal: PodGoalRow) => ({
      goalId: goal.goalId,
      active: goal.status === 'active',
      priority: goal.priority ?? 0,
      enqueuedAt: goal.enqueuedAt,
      humanAttention: humanAttention.has(goal.goalId),
    });
    const active = goals.filter((goal) => goal.status === 'active').map(toCandidate);
    const queued = goals.filter((goal) => goal.status === 'queued').map(toCandidate);
    const plan = planPromotions({ active, queued, maxConcurrent: this.maxConcurrent() });
    return {
      active: active.map((item) => item.goalId),
      queued: queued.map((item) => item.goalId),
      capacity: plan.capacity,
      plan,
    };
  }

  private maxConcurrent(): number {
    return Math.max(1, Math.trunc(this.deps.maxConcurrentGoals?.() ?? 1));
  }

  private hasCapacity(podId: string): boolean {
    return this.deps.store.listActiveGoals(podId).length < this.capacityFor(podId);
  }

  private capacityFor(podId: string, excludeGoalId?: string): number {
    const max = this.maxConcurrent();
    const human = deriveAttention(
      this.views(podId).filter((view) => !view.stateMissing && view.goalId !== excludeGoalId),
    ).length > 0;
    return max + (human ? 1 : 0);
  }

  /**
   * 闁荤姳闄嶉崝蹇涱敊閹寸偟鈻旀い鎾跺У閻?Goal闂佹寧绋戝涔獀ision discussing / direction_review闂佹寧绋戦ˇ杈╁垝闁垮鈻旂€广儱鐗嗛崢鎾级閳哄倻鈽夐柛?NodeDriver闂?
   * 闂佸憡鐟禍婵嗭耿?direction `clear`/`decided` 闂?revision 闂佽浜介崝宀勫春?planning 闂佸憡鑹鹃崙鐣屾濠靛妫橀柣鐔哄閸婅崵鈧鎮堕崕閬嶅矗閸ф绠ョ€广儱瀚粣?
   * 闂佸搫瀚崕宕囨閿涘嫭瀚柛鎰典簼閺?starter闂侀潧妫楅崐褰掓儉閸涙潙瀚?revision 闁荤偞绋戦惉鐓庘枔?legacy Goal 婵烇絽娲︾换鍐偓鍨瀹曪綁顢涘顓炲壔闂佸憡鏌ｉ崝濠囧焵?
   */
  isStartable(goalId: string): boolean {
    const goal = this.deps.store.getGoalByGoalId(goalId);
    if (!goal) return true;
    const revision = this.deps.store.getGoalRevision(goal.podId, goal.goalId, goal.activeRevision);
    if (!revision) return true;
    return revision.status !== 'discussing'
      && revision.status !== 'direction_review'
      && !isTerminalGoalRevisionStatus(revision.status);
  }

  private async startQueued(
    rowId: string,
    podId: string,
    goalId: string,
    projectDir: string,
  ): Promise<void> {
    if (!this.isStartable(goalId)) {
      this.deps.log?.(
        `[Pod] refusing to start discussing goal ${goalId} before a direction decision`,
      );
      return;
    }
    const before = this.deps.store.getPod(podId);
    const claimedPointer = !before?.activeGoalId;
    this.deps.store.setGoalStatus(rowId, 'active', { startedAt: this.deps.now() });
    this.deps.store.updatePod(podId, {
      status: 'active',
      ...(claimedPointer ? { activeGoalId: goalId } : {}),
    }, this.deps.now());
    try {
      await this.deps.startGoal(goalId, projectDir);
    } catch (err) {
      this.deps.store.setGoalStatus(rowId, 'queued', {});
      if (claimedPointer) {
        const others = this.deps.store.listActiveGoals(podId);
        this.deps.store.updatePod(podId, {
          status: others.length > 0 ? 'active' : 'idle',
          activeGoalId: others[0]?.goalId ?? null,
        }, this.deps.now());
      }
      throw err;
    }
  }

  async reconcile(): Promise<void> {
    const dirs = new Set<string>();
    for (const pod of this.deps.store.listPods()) dirs.add(canonicalProjectDir(pod.projectDir));
    for (const dir of this.deps.listRegisteredProjectDirs?.() ?? []) dirs.add(canonicalProjectDir(dir));

    for (const projectDir of dirs) {
      let pod = this.deps.store.getPodByProject(projectDir);
      if (!pod) {
        const inFlight = this.deps.listInFlightGoals?.(projectDir) ?? [];
        if (inFlight.length === 0) continue;
        try {
          pod = (await this.deps.pods.ensure(projectDir)).pod;
        } catch (err: any) {
          this.deps.log?.(`[Pod] reconcile ensure failed for ${projectDir}: ${err?.message ?? err}`);
          continue;
        }
      }
      try {
        await this.reconcilePod(pod);
      } catch (err: any) {
        this.deps.log?.(`[Pod] reconcile failed for ${pod.id}: ${err?.message ?? err}`);
      }
    }
  }

  private async reconcilePod(pod: PodRow): Promise<void> {
    const active = this.deps.store.getActiveGoal(pod.id);
    if (active) {
      if (pod.activeGoalId !== active.goalId) {
        this.deps.store.updatePod(pod.id, { activeGoalId: active.goalId }, this.deps.now());
      }
      const state = this.deps.goalState?.(active.goalId);
      if (this.deps.goalState && !state) return; // unreadable state stays blocked, never invented CANCELLED
      if (this.deps.goalState && state?.terminal) {
        const outcome = { verdict: state.verdict };
        if (this.deps.finalizeGoal) await this.deps.finalizeGoal(active.goalId, outcome);
        else await this.onGoalArchived(active.goalId, outcome);
        return;
      }
      return;
    }

    const unstartable = pod.status === 'paused' || pod.status === 'archived';
    if (pod.activeGoalId) {
      const state = this.deps.goalState?.(pod.activeGoalId);
      if (this.deps.goalState && !state) return;
      if (this.deps.goalState && state?.terminal) {
        this.deps.store.updatePod(pod.id, {
          activeGoalId: null,
          status: unstartable ? pod.status : 'idle',
        }, this.deps.now());
      } else if (!unstartable) {
        const row = this.deps.store.getGoalByGoalId(pod.activeGoalId)
          ?? this.deps.store.enqueueGoal({
            id: this.deps.newId(),
            podId: pod.id,
            goalId: pod.activeGoalId,
            now: this.deps.now(),
          });
        this.deps.store.setGoalStatus(row.id, 'active', { startedAt: this.deps.now() });
        this.deps.store.updatePod(pod.id, { activeGoalId: pod.activeGoalId, status: 'active' }, this.deps.now());
        return;
      }
    }

    if (!unstartable) {
      const inFlight = this.deps.listInFlightGoals?.(pod.projectDir) ?? [];
      const next = inFlight.find((goalId) => {
        if (this.deps.store.getGoalByGoalId(goalId)) return false;
        if (!this.isStartable(goalId)) return false;
        const state = this.deps.goalState?.(goalId);
        return !state || !state.terminal;
      });
      if (next) {
        const row = this.deps.store.enqueueGoal({
          id: this.deps.newId(),
          podId: pod.id,
          goalId: next,
          now: this.deps.now(),
        });
        this.deps.store.setGoalStatus(row.id, 'active', { startedAt: this.deps.now() });
        this.deps.store.updatePod(pod.id, { activeGoalId: next, status: 'active' }, this.deps.now());
        return;
      }
      await this.promote(pod.id);
    }
  }

  async pause(podId: string): Promise<void> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    this.deps.store.updatePod(podId, { status: 'paused' }, this.deps.now());
    this.deps.notify(podId);
  }

  async resume(podId: string): Promise<boolean> {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    if (pod.status === 'archived') throw new PodError(409, 'archived pod cannot resume');
    this.deps.store.updatePod(podId, { status: 'active' }, this.deps.now());

    const active = this.deps.store.getActiveGoal(podId);
    if (active) {
      if (this.isStartable(active.goalId)) {
        await this.deps.advanceGoal?.(active.goalId);
      } else {
        this.deps.log?.(
          `[Pod] resume kept discussing goal ${active.goalId} parked until a direction decision`,
        );
      }
      this.deps.notify(podId);
      return true;
    }
    return this.promote(podId);
  }

  cancelQueued(podId: string, goalId: string): PodGoalRow {
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    if (row.status !== 'queued') throw new PodError(409, `goal is not queued: ${goalId}`);
    this.deps.store.setGoalStatus(row.id, 'aborted', {
      endedAt: this.deps.now(),
      verdict: 'CANCELLED',
    });
    this.deps.notify(podId);
    return this.deps.store.getGoal(podId, goalId)!;
  }

  describeGoal(goalId: string): PodGoalDescription | null {
    return this.deps.describeGoal?.(goalId) ?? null;
  }

  views(podId: string): PodGoalView[] {
    const pod = this.deps.store.getPod(podId);
    if (!pod) return [];
    const runningProbe = this.deps.store.getRunningProbe(podId);
    const tasksByGoal = new Map<string, Array<{ kind: string; status: string }>>();
    for (const task of this.deps.store.listTasks(podId)) {
      if (!task.goalId) continue;
      const kind = podTaskKindOf(task);
      if (kind !== 'plan') continue;
      const items = tasksByGoal.get(task.goalId) ?? [];
      items.push({ kind, status: task.status });
      tasksByGoal.set(task.goalId, items);
    }
    const revisions = new Map(
      this.deps.store.listGoalRevisionsForPod(podId)
        .map((revision) => [`${revision.goalId}:${revision.revision}`, revision] as const),
    );
    return this.deps.store.listGoals(podId).map((row) => {
      const revision = revisions.get(`${row.goalId}:${row.activeRevision}`);
      return buildPodGoalView(
        row,
        this.describeWithRevision(row, runningProbe),
        this.queueReasonFor(pod, row),
        summarizePodGoalProgress(tasksByGoal.get(row.goalId) ?? []),
        revision?.goalMode ?? 'standard',
      );
    });
  }

  /**
   * 闂佺娉涢敃銈囩礊鐎ｎ喖绀?revision 闂佹眹鍔岀€氼亪骞戦姀銈呯闁挎稑瀚瑧闂佽鍏涘鎺旂箔?Spike 闁哄鏅滈崝姗€銆侀幋锕€绠戝ù锝嗙摃鐎氭瑩鏌涜箛瀣姕鐎殿喗瀵у鑽ゆ暜椤斿墽顦㏕ask 11 闁荤姴娲ㄧ划顖濆暞闂佹悶鍔岄鎴犳濮樿埖鏅?
   * revision 闁荤偞绋戦張顒€危閹间礁违鐎光偓閸曨兘鏋嗗┑?attention闂侀潧妫楃粔璺衡枔閹达箑绾ч柛鎰╁妷閺嬪棝鏌ㄥ☉姗嗗晪tate 闂佸憡鐟禍婵娿亹娴ｅ湱鐟?blockers 婵炴垶鎸哥€涒晠鎮ラ敐鍡矗婵☆垳纭堕崑?
   */
  private describeWithRevision(
    row: PodGoalRow,
    runningProbe: PodProbeRow | null,
  ): PodGoalDescription | null {
    const description = this.describeGoal(row.goalId);
    if (!description) return null;
    const revision = this.deps.store.getGoalRevision(row.podId, row.goalId, row.activeRevision);
    const worktree = this.deps.worktrees?.get(row.podId, row.goalId, row.activeRevision) ?? null;
    return {
      ...description,
      ...(revision
        ? {
          revisionStatus: revision.status,
          directionStatus: revision.directionStatus,
        }
        : {}),
      accepted: worktree?.status === 'merged',
      probeRunning: !!runningProbe
        && runningProbe.goalId === row.goalId
        && runningProbe.revision === row.activeRevision,
    };
  }

  attention(podId: string): PodAttentionItem[] {
    return buildPodAttention(this.views(podId));
  }

  result(podId: string, goalId: string): PodGoalResult {
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    const result = this.deps.resultForGoal?.(goalId);
    if (!result) throw new PodError(404, `goal result not found: ${goalId}`);
    const enriched: PodGoalResult = { ...result, verdict: row.verdict ?? result.verdict };
    const revision = Number.isFinite(result.revision) ? result.revision : row.activeRevision;
    const worktree = this.deps.worktrees?.get(podId, goalId, revision) ?? null;
    if (!worktree) return { ...enriched, worktree: null, acceptance: 'unavailable' };
    const acceptance = worktree.status === 'merged'
      ? 'accepted'
      : worktree.status === 'active' && isAcceptablePodResult(result)
        ? 'pending'
        : 'unavailable';
    return {
      ...enriched,
      worktree: resultWorktree(worktree),
      acceptance,
    };
  }

  /** Read-only revision branch preview (merge-base diff against the recorded base). */
  async worktreeDiff(
    podId: string,
    goalId: string,
    opts: { revision?: number } = {},
  ): Promise<PodWorktreeDiff> {
    const row = this.requireGoalRow(podId, goalId);
    const revision = opts.revision ?? row.activeRevision;
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, 'revision must be a positive integer');
    }
    if (!this.deps.worktrees?.branchDiff) {
      throw new PodError(503, 'worktree diff is unavailable');
    }
    return this.deps.worktrees.branchDiff(podId, goalId, revision);
  }

  /**
   * Explicit user acceptance: only the current revision, a trustworthy PASS /
   * quick UNREVIEWED result, and an active revision worktree can merge.
   */
  async acceptResult(
    podId: string,
    goalId: string,
    opts: { revision?: number } = {},
  ): Promise<PodGoalAcceptResult> {
    return this.runGoalMutation(podId, goalId, async () => {
      const row = this.requireGoalRow(podId, goalId);
    const revision = opts.revision ?? row.activeRevision;
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, 'revision must be a positive integer');
    }
    if (revision !== row.activeRevision) {
      throw new PodError(409, `revision ${revision} is not the active revision (${row.activeRevision})`);
    }
    const revisionRow = this.deps.store.getGoalRevision(podId, goalId, revision);
    if (!revisionRow) throw new PodError(404, `goal revision not found: ${goalId}#${revision}`);
    if (!isTerminalGoalRevisionStatus(revisionRow.status)) {
      throw new PodError(409, `goal revision is not finished: ${goalId}#${revision}`);
    }
    const result = this.deps.resultForGoal?.(goalId);
    if (!result) throw new PodError(409, `goal result is unavailable: ${goalId}`);
    if (result.revision !== revision) {
      throw new PodError(409, `result revision ${result.revision} does not match ${revision}`);
    }
    if (!isAcceptablePodResult(result)) {
      throw new PodError(409, `goal result is not acceptable: ${goalId}#${revision}`);
    }
    const worktree = this.deps.worktrees?.get(podId, goalId, revision);
    if (!worktree) throw new PodError(409, `goal revision has no worktree to merge: ${goalId}#${revision}`);
    if (worktree.status === 'abandoned') {
      throw new PodError(409, `goal revision worktree was abandoned: ${goalId}#${revision}`);
    }

    const merged = await this.deps.worktrees!.mergeForAcceptance(podId, goalId, revision);
    this.deps.notify(podId, 'result', goalId);
    return { podId, goalId, revision, ...merged };
    });
  }

  /**
   * 闁诲海鎳撻張顒勫垂濮樿埖鐒绘慨妯夸含閸欌偓闂佹寧绋戝鍍積c 闁?.1闂佹寧绋戦¨鈧紒杈╂珔eviewer 闂?PASS 闂佸憡鑹惧ù鐑藉极?Lead 闂備緡鍋呭銊╂偂閿熺姵鍋ㄩ柕濠忕畱閻撴洟鏌?
   *
   * - 閻熸粎澧楅幐鍛婃櫠?revision **婵烇絽娲︾换鍐偓?*闂佹椿浜為崰搴ㄦ偪閸曨厸鍋撻悷鐗堟拱闁搞劍姘ㄧ槐鎺楀箻鐎甸晲鍑介梺鎸庣☉閻楀繒鍒掗幘璇茬畱濞达絿鐡旈弨鑺ユ叏濮椻偓閺呰尙绮径鎰哗闁荤喐婢橀弲鎼佹煥濞戞瑧鈽夐柣銊ヮ煼瀵敻顢旈崨顔芥瘑闁诲繐绻愯ぐ鐐靛緤妤ｅ啫瀚夊璺烘捣濡插牓鏌熺拠鈥虫灍婵?
   *   闂佸憡鐟禍婵堚偓鍨矌閹风姵鎷呴悷鎵偊 verdict 闂佽　鍋撻悹楦挎閸熸彃鈽夐幘顖氫壕濠电偛妫屽Σ鍕濠靛牏纾兼繝闈涙噽閻熸繈鏌ゅ畡鐗堫棦闁?PASS闂佹寧绋戦¨鈧紒?
   * - 闂佸憡鐟禍婊呯不瀹ュ绠绘い鎾寸箘椤忛亶鏌?`pod.updated {kind:'result', goalId}`闂佹寧绋戦懟顖炲箖閹惧鈻旈柍?revision 婵炴垶鎸哥粔褰掑闯閸涘﹤绶炵€广儱鎳庣徊娲煥?
   * - 婵炴垶鎸哥粔鎾垂閸楃儐鍤堥弶鐐靛閻晫绱?attention闂佹寧绋戞總鏃傚姬閸愨晝鈻旂€广儱顦版禒姗€鎮烽弴姘冲厡闁轰降鍊濋獮瀣暋閺夋寧娅冮梺缁樺姍閳ь剚绋撻杈ㄧ箾閸犫剝澹嬮崑鎾崇暆閸曨厼鐭楅梺琛″亾闁割偅娲嶉崑鎾愁潩瀹曞洨鐣洪梺闈涙缁夋煡鍩€?
   */
  async notifyResult(podId: string, goalId: string): Promise<PodResultNotification> {
    const row = this.requireGoalRow(podId, goalId);
    const revision = this.deps.store.getGoalRevision(podId, goalId, row.activeRevision);
    if (!revision) {
      throw new PodError(404, `goal revision not found: ${goalId}#${row.activeRevision}`);
    }
    const result = this.deps.resultForGoal?.(goalId) ?? null;
    const verdict = normalizeVerdict(
      result?.verdict ?? revision.verdict ?? row.verdict ?? undefined,
    ) ?? null;
    const hasEvidence = verdict !== null || result?.resultReady === true;
    if (!hasEvidence) {
      throw new PodError(409, `goal has no result to notify: ${goalId}`);
    }
    if (!isTerminalGoalRevisionStatus(revision.status) && this.deps.revisions) {
      const finished = this.deps.revisions.finishRevision(goalId, {
        revision: revision.revision,
        status: 'completed',
        verdict,
      });
      if (finished.applied) {
        await this.deps.sessions?.retireRevision(goalId, revision.revision);
      }
    }

    const key = `${podId}/${goalId}#${revision.revision}`;
    if (this.notifiedResults.has(key)) {
      return {
        podId, goalId, revision: revision.revision, verdict, notified: false, duplicate: true,
      };
    }
    this.notifiedResults.add(key);
    this.deps.notify(podId, 'result', goalId);
    return {
      podId, goalId, revision: revision.revision, verdict, notified: true, duplicate: false,
    };
  }

  /**
   * 闂佺懓鐏氶幐绋棵洪弽顓熸櫖闁秆呮異ec 闁?.2 / 闁?.3闂佹寧绋戦¨鈧紒鍙樺嵆瀹曘儳浠﹂懖鈺婁紘 Goal 缂傚倷缍€閸涱垱鏆伴梺鎸庣☉閼活垳妲愰幋鐐碘枖閻庯絺鏅濋?revision闂?
   *
   * 婵＄偑鍊曢幖顐よ姳椤撶喓鈻旂€广儱鎳庣拋鎻捗瑰┃鍨偓鏍х暦閺屻儲鏅柛锔筋儖RD PREREQUISITE闂佹寧绋戦¨鈧紒鍙樺嵆瀹曟宕煎┑鍫熸殧缂傚倷鐒﹂幐濠氭倶婢跺本瀚氬ù锝囨嚀缁侊箓鏌￠埀顒傛崉閾忕懓鏆￠悷婊呭閹稿憡鏅?revision闂佹寧绋戦懟顖炲疮閳?
   * `openNextRevision(expectedRevision)`闂侀潧妫楅崐鐟拔?revision 闂佸憡鐟禍锝夊箯閻戣棄绀夐柣姗嗗枓閸嬫挻鎷呯憴鍕垫敵婵炴垶鎸哥粔褰掑闯閹间礁绀冩繛鍡樺姇閻忔鏌涘▎蹇曅㈢紓宥咃工椤╁ジ鏁愯箛鏇炶€?
   * 闂?revision 婵?`discussing` 閻庢鍠掗崑鎾斥攽椤旂⒈鍎滅紒杈ㄢ攺ech Lead 闁荤姳闄嶉崝蹇涱敊閹寸姷鍗氶悗锝庝簻缁侇噣鏌熼婊冪仼妞わ附鐓￠弫宥嗗緞濞戞氨顦Δ鐘靛仩濞夋盯鎮介锝団枖濠电姴鍟埅鐢告煕閵壯冧粧缂侀硸鍙冨畷妤呭醇閵忋倗宕滈梺?
   */
  async rejectResult(podId: string, goalId: string, feedback: string): Promise<PodRejectResult> {
    return this.runGoalMutation(podId, goalId, async () => {
    const reason = typeof feedback === 'string' ? feedback.trim() : '';
    if (!reason) throw new PodError(400, 'reject feedback is required');
    const row = this.requireGoalRow(podId, goalId);
    if (!this.deps.revisions) throw new PodError(503, 'goal revisions unavailable');
    const rejectedRevision = row.activeRevision;
    const worktree = this.deps.worktrees?.get(podId, goalId, rejectedRevision) ?? null;
    if (worktree?.status === 'merged') {
      throw new PodError(409, `goal revision is already accepted and merged: ${goalId}#${rejectedRevision}`);
    }
    if (worktree?.status === 'active') {
      await this.deps.worktrees!.commitPending(podId, goalId, rejectedRevision);
    }

    const reopened = await this.deps.revisions.reopenAfterReject(goalId, reason, {
      expectedRevision: rejectedRevision,
    });
    if (!reopened.opened) {
      throw new PodError(
        409,
        `goal revision ${rejectedRevision} could not be reopened`
        + ` (${reopened.staleReason ?? 'stale'})`,
      );
    }
    if (worktree?.status === 'active') {
      this.deps.worktrees!.markAbandoned(podId, goalId, rejectedRevision);
    }

    // 闂佸憡鑹炬總鏃傜博?Goal 闂佹悶鍎抽崑娑㈠春?Pod 闂傚倸鍟伴崰搴ㄥ垂椤忓牊鏅慨姗嗗墰缁夊ジ鏌涢幘宕囆ｉ柣銉ユ嚇瀵灚寰勬繝鍌滃姸闂?Goal 闂侀潻璐熼崝蹇曠玻閸モ晙鐒婇弶鍫氭櫇瑜板矂鏌?active闂佹寧绋掔粙鎴﹀箚娓氣偓瀹曟艾鈻庨幇顒傜懇闂傚倸鍟伴崰鎾绘偤閹寸偛顕辨俊顖氭惈鐢儳绱掗悪娆庤閸?
    const pod = this.deps.store.getPod(podId);
    const active = this.deps.store.getActiveGoal(podId);
    const blocked = !pod || pod.status === 'paused' || pod.status === 'archived';
    const nextStatus: 'active' | 'queued' = !blocked && (!active || active.goalId === goalId)
      ? 'active'
      : 'queued';
    this.deps.store.reopenGoal(podId, goalId, { status: nextStatus, now: this.deps.now() });
    if (nextStatus === 'active' && pod) {
      this.deps.store.updatePod(podId, { status: 'active', activeGoalId: goalId }, this.deps.now());
    }

    // 闂佺懓鐏氶幐绋棵洪弽顓炵煑鐎广儱顦藉ú顖毭归敐鍡欑焼閻犳劗鍠栧顒勬偡閻楀牆鈧鏌涢幇顒€鏆遍柣锝夌畺閹啴宕熼鍓х倳闂佺绻堥崕鑽ゆ濡惧兎pend-only闂佹寧绋掔粙鎰箔婢舵劕缁╅柣鐔告緲缂?discussing 闂傚倸鍟抽崺鏍敊瀹€鍕櫖濠㈣泛鐗冮崑?
    try {
      this.deps.directions?.recordRejectInput({
        goalId,
        revision: reopened.revision,
        feedback: reason,
      });
    } catch (err: any) {
      // revision 閻庤鐡曠亸娆戝垝閳ユ剚鍤曢柍褜鍓熷畷娆撴偖鐎靛摜鐛ラ梺鍛婄懃缁夊綊銆呴銏♀拹婵犲﹤鍟崜鐓庮熆閹壆绨块悷娆欓檮缁嬪顓奸崼婵嗗箣闁荤姳璁查弲婊勬櫠閿曞倸鐐婇柣鎰级缁€鈧┑鐘诧攻閻旑剛妲愬▎鎾冲偍闁绘棁鍩栭钘壝归悩鑼㈡繝鈧鍡樺仒?feedback 婵炴垶鎸搁…顓犳濮樿泛违?
      this.deps.log?.(
        `[Pod] reject feedback record failed for ${goalId}#${reopened.revision}`
        + ` (non-fatal): ${err?.message ?? err}`,
      );
    }

    let sessionID: string | null = null;
    let sessionError: string | undefined;
    try {
      // New revision inherits from the rejected one: provision its checkout before discussion.
      await this.deps.worktrees?.ensure(podId, goalId, reopened.revision);
      sessionID = (await this.deps.techLead?.ensureSession(goalId)) ?? null;
    } catch (err: any) {
      sessionError = String(err?.message ?? err);
      this.deps.log?.(
        `[Pod] Tech Lead session restore failed for ${goalId}#${reopened.revision}: ${sessionError}`,
      );
    }

    this.deps.notify(podId, 'revision', goalId);
    return {
      podId,
      goalId,
      revision: reopened.revision,
      status: 'discussing',
      priority: reopened.priority,
      feedback: reason,
      archivedState: reopened.archivedState,
      previous: reopened.previous,
      sessionID,
      ...(sessionError ? { sessionError } : {}),
    };
    });
  }

  list(podId: string): PodGoalRow[] {
    return this.deps.store.listGoals(podId);
  }

  private requireGoalRow(podId: string, goalId: string): PodGoalRow {
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    const row = this.deps.store.getGoal(podId, goalId);
    if (!row) throw new PodError(404, `goal not found: ${goalId}`);
    return row;
  }

  private queueReasonFor(pod: PodRow, row: PodGoalRow): PodQueueReason | undefined {
    if (pod.status === 'paused') return 'paused';
    if (pod.status === 'archived') return 'archived';

    const budget = this.deps.budget?.canStart(pod.id);
    if (budget && !budget.ok) return 'budget';
    if (row.status === 'queued') {
      return this.deps.store.getActiveGoal(pod.id) ? 'active_goal' : undefined;
    }
    return undefined;
  }
}

function normalizeVerdict(value: string | undefined): PodGoalVerdict | undefined {
  if (value === 'PASS' || value === 'FAIL' || value === 'MAX_RETRIES' || value === 'ERROR' || value === 'CANCELLED') {
    return value;
  }
  return undefined;
}
