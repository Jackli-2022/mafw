// gateway/tests/unit/helpers/goal-driver-harness.ts
// NodeDriver 测试共享基建：fake client/deps + state 工厂。
// Tasks 6/7/8/11 的驱动器测试统一 import；改动此处需跑全部 goal-driver* 测试回归。
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NodeDriver, DriverDeps, GoalRuntimeClient } from '../../../src/core/goal/driver';
import { ensureGoalState, loadGoalState, writeGoalState } from '../../../src/core/goal/state-v3';

export interface Harness {
  mafwDir: string;
  driver: NodeDriver;
  deps: DriverDeps;
  calls: any[];        // client/onSessionCreated/archiveGoal 调用记录
  events: any[];       // goal_node 事件
  phases: any[];       // phase_transition 事件
  ledgerEvents: any[]; // QuestionLedger 事件
  nodeRuns: any[];     // node_runs 行（内存实现）
  charter(goalId: string): void;
  startAndIdle(goalId: string): Promise<string>;  // advance → 返回在飞 sessionId
  fireIdle(sessionId?: string): Promise<void>;    // 触发 idle + 等 microtask
  fireError(sessionId: string, msg: string): Promise<void>;
  load(goalId: string): any;
  write(goalId: string, patch: any): void;
}

export function makeHarness(opts?: { nodeTimeoutMs?: number; maxAttempts?: number; promptAsyncThrows?: boolean }): Harness {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-driver-'));
  for (const d of ['goals', 'requests', 'receipts', 'reviews']) {
    fs.mkdirSync(path.join(mafwDir, d), { recursive: true });
  }
  const calls: any[] = [];
  const events: any[] = [];
  const phases: any[] = [];
  const ledgerEvents: any[] = [];
  const nodeRuns: any[] = [];
  let seq = 1;
  let currentSession: string | null = null;

  const client: GoalRuntimeClient = {
    create: async () => { const id = `ses_${seq++}`; currentSession = id; calls.push({ op: 'create', id }); return { id }; },
    promptAsync: async (o: any) => {
      if (opts?.promptAsyncThrows) throw new Error('boom');
      calls.push({ op: 'promptAsync', ...o });
    },
    delete: async (sid: string) => { calls.push({ op: 'delete', sid }); },
    abort: async (sid: string) => { calls.push({ op: 'abort', sid }); },
  };

  const deps: DriverDeps = {
    client,
    db: {
      insertNodeRun: (i: any) => { const id = seq++; nodeRuns.push({ id, status: 'running', ...i }); return id; },
      finishNodeRun: (id: number, p: any) => { const r = nodeRuns.find((x) => x.id === id); if (r) Object.assign(r, p); },
      listNodeRuns: (g: string) => nodeRuns.filter((r) => r.goalId === g),
      latestNodeAttempt: (g: string, l: number, n: string) =>
        [...nodeRuns].reverse().find((r) => r.goalId === g && r.loop === l && r.node === n) ?? null,
    },
    ledger: {
      appendQuestionEvent: (e: any) => ledgerEvents.push(e),
      getQuestionState: (qid: string) => (qid.endsWith('_ok') ? 'pending' : null),
    },
    emitNodeEvent: (p: any) => events.push(p),
    emitPhaseTransition: (p: any) => phases.push(p),
    onSessionCreated: (i: any) => calls.push({ op: 'onSessionCreated', ...i }),
    archiveGoal: async (goalId: string, o: any) => { calls.push({ op: 'archiveGoal', goalId, ...o }); },
    nodeTimeoutMs: opts?.nodeTimeoutMs ?? 30 * 60_000,
    maxAttempts: opts?.maxAttempts ?? 2,
  };

  const driver = new NodeDriver(deps);
  const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

  return {
    mafwDir, driver, deps, calls, events, phases, ledgerEvents, nodeRuns,
    charter: (goalId) => fs.writeFileSync(path.join(mafwDir, 'goals', `${goalId}.md`), '# charter', 'utf-8'),
    async startAndIdle(goalId) {
      await driver.advance(goalId);
      return loadGoalState(mafwDir, goalId)!.nodeSession!.id;
    },
    async fireIdle(sid?: string) {
      driver.onSessionIdle(sid ?? currentSession!);
      await settle();
    },
    async fireError(sid: string, msg: string) {
      driver.onSessionError(sid, msg);
      await settle();
    },
    load: (goalId) => loadGoalState(mafwDir, goalId),
    write: (goalId, patch) => writeGoalState(mafwDir, goalId, patch),
    _bumpSeq: (n: number) => { seq = Math.max(seq, n); },
  };
}

/** 便捷：建 goal + charter + 注册目录。nodeSession patch 时同步补一条 running run 行（与真实语义一致）。 */
export function seedGoal(h: Harness, goalId: string, init?: { maxRounds?: number; patch?: any }): void {
  ensureGoalState(h.mafwDir, goalId, { projectDir: 'C:/p', maxRounds: init?.maxRounds ?? 3 });
  h.driver.registerGoalDir(goalId, h.mafwDir);
  h.charter(goalId);
  if (init?.patch) {
    h.write(goalId, init.patch);
    const ns = init.patch.nodeSession;
    if (ns?.runId) {
      const round = init.patch.round ?? init.patch.loop ?? 1;
      h.nodeRuns.push({
        id: ns.runId, goalId, loop: round, node: ns.phase, attempt: ns.attempt ?? 1,
        sessionId: ns.id, status: 'running', startedAt: ns.startedAt,
      });
      (h as any)._bumpSeq?.(ns.runId + 1);
    }
  }
}
