/**
 * T2-2 RunCoordinator —— 软暂停编排。
 *
 * suspend：预检 user 锚点 → 挂队列闸门 → abort → 等终态落定 → 重取简报 → 落库
 * resume ：忙/未落定门 → **先标 resumed** → 清闸门 → fire-and-forget 续跑提示
 *          （pi 的 promptAsync 会阻塞到回合结束；发送失败异步 reopen→suspended）
 * finish ：只结束 resumed run；suspend 的 abort 终态只清 settled
 * reconcile：suspended 重挂闸门；resumed（重启僵尸）→ cancelled
 */
import { buildResumeBrief, composeResumePrompt } from './run-brief';
import { RunStateError, type RunState, type RunStateService } from './run-state-service';

export interface RunCoordinatorDeps {
  runtime(): {
    name?: string;
    capabilities?: { runStateApi?: boolean };
    session: {
      abort(opts: { sessionID: string }): Promise<void>;
      messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }>;
      promptAsync(opts: { sessionID: string; parts: Array<{ type: 'text'; text: string }> }): Promise<any>;
      get(opts: { sessionID: string }): Promise<any>;
    };
  } | null;
  service: RunStateService;
  isBusy(sessionID: string): boolean;
  queueSize(sessionID: string): number;
  flushQueue(sessionID: string): void;
  wait(ms: number): Promise<void>;
  log?(message: string): void;
}

const SETTLE_ATTEMPTS = 50;
const SETTLE_INTERVAL_MS = 100;

export class RunCoordinator {
  private suspended = new Set<string>();
  /** abort 终态已观察（或超时视为落定）——resume 的前置条件。 */
  private settled = new Set<string>();
  /** resume 已发送、等待 resumed 回合真正 started；期间到达的终态不结束 run
   *  （延迟的 abort 终态会把刚恢复的回合误标 cancelled——builder check #4）。
   *  值为 resume 发送时刻（ms），超过 TTL 后允许终态结束（builder review #8）。 */
  private awaitingStart = new Map<string, number>();
  /** suspend 单飞：abort/settle 窗口内并发请求会互相清闸门（review #2）。 */
  private pendingSuspend = new Set<string>();
  private static readonly AWAITING_START_TTL_MS = 30_000;

  constructor(private deps: RunCoordinatorDeps) {}

  isSuspended(sessionID: string): boolean {
    return this.suspended.has(sessionID);
  }

  /** 队列闸门：暂停中或 resume 等待回合启动（延迟 abort 终态不得续发队列）。 */
  shouldHoldQueue(sessionID: string): boolean {
    if (this.suspended.has(sessionID)) return true;
    const at = this.awaitingStart.get(sessionID);
    return at !== undefined && Date.now() - at < RunCoordinator.AWAITING_START_TTL_MS;
  }

  /** 活跃 run（路由 GET /run 用）。 */
  active(sessionID: string): RunState | null {
    return this.deps.service.active(sessionID);
  }

  async suspend(sessionID: string, reason?: string): Promise<RunState> {
    const rt = this.deps.runtime();
    if (!rt?.capabilities?.runStateApi || typeof rt.session.abort !== 'function') {
      throw new RunStateError(503, "capability 'runStateApi' not available on this runtime");
    }
    if (this.pendingSuspend.has(sessionID)) {
      throw new RunStateError(409, 'suspend already in progress for this session');
    }
    if (this.deps.service.active(sessionID)) {
      throw new RunStateError(409, 'run already active for this session');
    }
    // pi 的 abort 吞掉一切错误（pi-session.ts）——不能靠 abort 抛错区分"空闲"；
    // pi 必须由 busy 事件闸门判定，否则空闲暂停会造出挂起 run（review #1）。
    if (rt.name === 'pi' && !this.deps.isBusy(sessionID)) {
      throw new RunStateError(409, 'session is not running');
    }

    this.pendingSuspend.add(sessionID);
    try {
      const projectDir = await this.projectDir(rt, sessionID);

      // 先确认有可续跑的 user 锚点（避免 abort 后无可落库的 run）。
      const pre = await rt.session.messages({ sessionID, limit: 200 });
      const preBrief = buildResumeBrief(Array.isArray(pre?.data) ? pre.data : [], this.deps.queueSize(sessionID));
      if (!preBrief) {
        throw new RunStateError(409, 'no user message to resume from');
      }

      // 队列闸门必须先于 abort：否则 turn.aborted 的 flush 会立刻续发下一条。
      this.suspended.add(sessionID);
      try {
        await rt.session.abort({ sessionID });
      } catch (err: any) {
        this.suspended.delete(sessionID);
        throw new RunStateError(409, `session is not running: ${err?.message ?? err}`);
      }

      await this.waitSettled(sessionID);

      // abort 后重取：拿到 settle 后的部分输出（pre 仅用于锚点兜底）。
      let brief = preBrief;
      try {
        const post = await rt.session.messages({ sessionID, limit: 200 });
        brief = buildResumeBrief(Array.isArray(post?.data) ? post.data : [], this.deps.queueSize(sessionID)) ?? preBrief;
      } catch { /* keep preBrief */ }

      this.settled.add(sessionID);
      return this.deps.service.suspend({ sessionID, projectDir, brief, ...(reason ? { reason } : {}) });
    } finally {
      this.pendingSuspend.delete(sessionID);
    }
  }

  async resume(
    sessionID: string,
    runId?: string,
  ): Promise<{ run: RunState; prompted: true }> {
    const rt = this.deps.runtime();
    if (!rt) throw new RunStateError(503, 'runtime not available');
    if (this.deps.isBusy(sessionID)) {
      throw new RunStateError(409, 'session is still stopping; retry');
    }
    const active = this.deps.service.active(sessionID);
    if (!active || (runId && active.id !== runId)) {
      throw new RunStateError(404, 'run not found');
    }
    if (active.status !== 'suspended') {
      throw new RunStateError(409, `run is not suspended (status=${active.status})`);
    }
    if (!this.settled.has(sessionID)) {
      throw new RunStateError(409, 'run is still stopping; retry');
    }

    // 先落 resumed 再发送：pi 的 promptAsync 会阻塞到回合结束，终态事件
    // 若早于状态写入会被 finish 忽略（builder check #2）。
    const resumed = this.deps.service.resume(active.id);
    this.suspended.delete(sessionID);
    this.awaitingStart.set(sessionID, Date.now());

    void rt.session
      .promptAsync({ sessionID, parts: [{ type: 'text', text: composeResumePrompt(resumed.brief) }] })
      .catch((err: any) => {
        this.deps.log?.(`[Run] resume send failed for ${sessionID} (reopening): ${err?.message ?? err}`);
        this.awaitingStart.delete(sessionID);
        try {
          const reopened = this.deps.service.reopen(active.id, 'resume send failed');
          // 若 run 已被 discard/finish，reopen 是 no-op——不得重新挂闸门（review #3）。
          if (reopened.status === 'suspended') this.suspended.add(sessionID);
        } catch { /* fail-open */ }
      });

    return { run: resumed, prompted: true };
  }

  async discard(sessionID: string, runId?: string): Promise<RunState> {
    const active = this.deps.service.active(sessionID);
    if (!active || (runId && active.id !== runId)) {
      throw new RunStateError(404, 'run not found');
    }
    if (active.status === 'resumed' && this.deps.isBusy(sessionID)) {
      throw new RunStateError(409, 'resumed run is running; abort it first');
    }
    const run = this.deps.service.discard(active.id);
    this.suspended.delete(sessionID);
    this.settled.delete(sessionID);
    this.awaitingStart.delete(sessionID);
    // 放弃暂停不吞用户已排队的消息。
    this.deps.flushQueue(sessionID);
    return run;
  }

  /** resumed 回合真正开始：此后到达的终态才代表本 run。 */
  onTurnStarted(sessionID: string): void {
    this.awaitingStart.delete(sessionID);
  }

  /** turn 终态：settle 标记；resumed run → 对应终态（suspended run 不动）。 */
  onTerminal(sessionID: string, type: 'completed' | 'failed' | 'aborted'): void {
    this.settled.add(sessionID);
    const awaitingAt = this.awaitingStart.get(sessionID);
    if (awaitingAt !== undefined && Date.now() - awaitingAt < RunCoordinator.AWAITING_START_TTL_MS) {
      // 发送后回合尚未 started 的终态：只可能是延迟的 abort 终态（review #7）。
      return;
    }
    this.awaitingStart.delete(sessionID);
    const outcome = type === 'completed' ? 'completed' : type === 'failed' ? 'failed' : 'cancelled';
    this.deps.service.finish(sessionID, outcome);
  }

  /** 启动恢复：suspended 重挂闸门；resumed（进程已死）→ cancelled。 */
  reconcile(): void {
    for (const run of this.deps.service.listActive()) {
      if (run.status === 'suspended') {
        this.suspended.add(run.sessionID);
        this.settled.add(run.sessionID);
      } else if (run.status === 'resumed') {
        try { this.deps.service.finish(run.sessionID, 'cancelled'); } catch { /* fail-open */ }
      }
    }
  }

  deleteForSession(sessionID: string): void {
    this.deps.service.deleteForSession(sessionID);
    this.suspended.delete(sessionID);
    this.settled.delete(sessionID);
    this.awaitingStart.delete(sessionID);
  }

  private async waitSettled(sessionID: string): Promise<void> {
    for (let i = 0; i < SETTLE_ATTEMPTS; i++) {
      if (!this.deps.isBusy(sessionID)) return;
      await this.deps.wait(SETTLE_INTERVAL_MS);
    }
  }

  private async projectDir(rt: NonNullable<ReturnType<RunCoordinatorDeps['runtime']>>, sessionID: string): Promise<string> {
    const info = await rt.session.get({ sessionID });
    const dir = info?.directory ?? info?.location?.directory;
    // pi 的 session.get 目录恒为空串（pi-session.ts）——project_dir 只存储不读，
    // 缺失时降级为空串而不是把 pi 的 suspend 整个拒掉（review #1）。
    return typeof dir === 'string' ? dir : '';
  }
}
