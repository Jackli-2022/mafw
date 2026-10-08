// gateway/src/core/goal/driver.ts
// NodeDriver —— goal 编排状态机（spec §3）。
// 驱动：state 文件（真相源）+ per-session 事件监听（idle/error 双门完成判定）。
// langgraph 三件套（graph/checkpointer/interrupt）退役；路由用 routing.ts 纯函数。
import * as fs from 'fs';
import * as path from 'path';
import {
  GoalStateV3, loadGoalState, writeGoalState, isTerminalState, effectiveRound,
} from './state-v3';
import { routeNext, GoalNodeName } from './routing';
import { renderNodePrompt, nodeArtifactPaths } from './node-prompts';
import { parseReviewVerdict } from '../langgraph/review-parser';
import { matchesSignature } from '../langgraph/signature-detector';

export interface GoalRuntimeClient {
  create(directory: string): Promise<{ id: string }>;
  promptAsync(opts: {
    sessionID: string;
    parts: Array<{ type: string; text: string }>;
    agent?: string;
  }): Promise<void>;
  delete(sessionID: string): Promise<void>;
  abort?(sessionID: string): Promise<void>;
}

export interface DriverDeps {
  client: GoalRuntimeClient;
  db: {
    insertNodeRun(i: { goalId: string; projectId: string; loop: number; node: string; attempt: number; sessionId: string | null; startedAt: string }): number;
    finishNodeRun(id: number, p: { status: string; finishedAt: string; outcome?: string | null; error?: string | null; tokensInput?: number | null; tokensOutput?: number | null; costUsd?: number | null }): void;
    listNodeRuns(goalId: string): any[];
    latestNodeAttempt(goalId: string, loop: number, node: string): any | null;
  };
  ledger: {
    appendQuestionEvent(e: any): void;
    getQuestionState(questionId: string): string | null;
  };
  emitNodeEvent(p: Record<string, unknown>): void;
  emitPhaseTransition(p: { type: 'phase_transition'; goalId: string; phase: string; loop: number; projectDir: string }): void;
  onSessionCreated(info: { goalId: string; sessionId: string; phase: string; loop: number }): void;
  archiveGoal(goalId: string, opts: { verdict: string; rounds: number; lastError?: string | null; reviewFeedback?: string }): Promise<void>;
  nodeTimeoutMs: number;
  maxAttempts: number;
}

const NODE_PHASE: Record<'plan' | 'execute' | 'review', { running: string; complete: string }> = {
  plan: { running: 'PLANNING', complete: 'PLANNING_COMPLETE' },
  execute: { running: 'EXECUTING', complete: 'EXECUTING_COMPLETE' },
  review: { running: 'REVIEWING', complete: 'REVIEWING_COMPLETE' },
};

export class NodeDriver {
  private mutex = new Map<string, Promise<void>>();
  private listeners = new Map<string, (ev: 'idle' | 'error', errorMsg?: string) => void>();
  private stateDirs = new Map<string, string>(); // goalId → mafwDir

  constructor(private deps: DriverDeps) {}

  /** index.ts 启动/starter 调用：登记 goal 的状态目录。 */
  registerGoalDir(goalId: string, mafwDir: string): void {
    this.stateDirs.set(goalId, mafwDir);
  }

  /** handleOpencodeEvent 分发入口（idle）。 */
  onSessionIdle(sessionID: string): void {
    const h = this.listeners.get(sessionID);
    if (h) { this.listeners.delete(sessionID); h('idle'); }
  }

  /** handleOpencodeEvent 分发入口（error）。 */
  onSessionError(sessionID: string, errorMsg: string): void {
    const h = this.listeners.get(sessionID);
    if (h) { this.listeners.delete(sessionID); h('error', errorMsg); }
  }

  /** 推进 goal（幂等、互斥）。所有入口（starter/完成回调/应答/恢复/watchdog）都走这里。 */
  async advance(goalId: string): Promise<void> {
    const prev = this.mutex.get(goalId) ?? Promise.resolve();
    const next = prev.then(() => this.advanceInner(goalId)).catch((err) => {
      // 驱动器异常绝不外抛（spec §7）；落 lastError
      try {
        const mafwDir = this.stateDirs.get(goalId);
        if (mafwDir) writeGoalState(mafwDir, goalId, { lastError: `driver: ${err?.message ?? err}` });
      } catch { /* last-resort */ }
    });
    this.mutex.set(goalId, next);
    try { await next; } finally { if (this.mutex.get(goalId) === next) this.mutex.delete(goalId); }
  }

  private findState(goalId: string): { mafwDir: string; state: GoalStateV3 } | null {
    const mafwDir = this.stateDirs.get(goalId);
    if (!mafwDir) return null;
    const s = loadGoalState(mafwDir, goalId);
    return s ? { mafwDir, state: s } : null;
  }

  private async advanceInner(goalId: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    if (isTerminalState(state)) return;
    if (state.nodeSession) return; // 节点在飞——完成回调会再次 advance

    const node = state.nextNode as GoalNodeName;
    if (node === 'plan' || node === 'execute' || node === 'review') {
      await this.executeNode(goalId, mafwDir, node);
    } else if (node === 'askUser') {
      this.executeAskUser(goalId, mafwDir);
    } else {
      await this.executeArchive(goalId, mafwDir, node);
    }
  }

  private async executeNode(goalId: string, mafwDir: string, node: 'plan' | 'execute' | 'review'): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const phaseNames = NODE_PHASE[node];

    // phase 广播（payload 形状与旧 syncToFile 一致——milestone-push 零迁移）
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: phaseNames.running, loop: round, projectDir: state.projectDir });

    // attempt 语义：上一行 failed/timeout/aborted → attempt+1（重试历史在 node_runs）
    const prevRun = this.deps.db.latestNodeAttempt(goalId, round, node);
    const attempt = prevRun && ['failed', 'timeout', 'aborted'].includes(prevRun.status)
      ? prevRun.attempt + 1 : 1;

    const session = await this.deps.client.create(state.projectDir);
    const sessionId = session.id;
    this.deps.onSessionCreated({ goalId, sessionId, phase: node, loop: round });

    const runId = this.deps.db.insertNodeRun({
      goalId, projectId: state.projectDir, loop: round, node, attempt, sessionId,
      startedAt: new Date().toISOString(),
    });

    const prompt = renderNodePrompt(node, {
      goalId, projectDir: state.projectDir, mafwDir, round, maxRounds: state.maxRounds,
      charterPath: path.join(mafwDir, 'goals', `${goalId}.md`),
      requestPath: path.join(mafwDir, 'requests', `${goalId}.json`),
      reviewFeedback: state.reviewFeedback || undefined,
    });

    // 不 await——pi 的 promptAsync 在 idle 会话阻塞到回合结束，await 会卡死 advance（spec §7）
    void this.deps.client.promptAsync({
      sessionID: sessionId, parts: [{ type: 'text', text: prompt }], agent: `mafw-${node}`,
    }).catch((err: any) => {
      this.onSessionError(sessionId, `promptAsync: ${err?.message ?? err}`);
    });

    writeGoalState(mafwDir, goalId, {
      phase: phaseNames.running, nextAction: `RUNNING_${node}`,
      nodeSession: { id: sessionId, phase: node, startedAt: new Date().toISOString(), attempt, runId },
    });

    this.listeners.set(sessionId, (ev, errorMsg) => {
      if (ev === 'idle') void this.completeNode(goalId, sessionId);
      else void this.failNode(goalId, sessionId, 'session_error', errorMsg ?? 'session error');
    });

    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node,
      transition: 'started', at: new Date().toISOString(), attempt,
    });
  }

  private executeAskUser(goalId: string, mafwDir: string): void {
    const state = loadGoalState(mafwDir, goalId)!;
    if (!state.pendingQuestion) { // 数据异常 → 回 plan
      writeGoalState(mafwDir, goalId, { nextNode: 'plan' });
      void this.advance(goalId);
      return;
    }
    const q = state.pendingQuestion;
    // asked 落地——现状断链根因（asked 事件无写入点 → respond 恒 404）
    this.deps.ledger.appendQuestionEvent({
      type: 'asked', questionId: q.questionId, goalId, node: q.node, loop: q.loop,
      questions: q.questions, askedAt: q.askedAt,
    });
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: 'ASKING_USER', loop: effectiveRound(state), projectDir: state.projectDir,
    });
    writeGoalState(mafwDir, goalId, { phase: 'ASKING_USER', nextAction: 'WAIT_USER_ANSWER' });
  }

  private async executeArchive(goalId: string, mafwDir: string, node: GoalNodeName): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const v = node === 'archive_success'
      ? { verdict: 'PASS', phase: 'ARCHIVED', nextAction: 'COMPLETED' }
      : node === 'archive_max_retries'
        ? { verdict: 'MAX_RETRIES', phase: 'FAILED', nextAction: 'FAILED' }
        : { verdict: 'FAIL', phase: 'FAILED', nextAction: 'FAILED' };
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: v.phase, loop: round, projectDir: state.projectDir });
    writeGoalState(mafwDir, goalId, { phase: v.phase, nextAction: v.nextAction, nodeSession: null });
    await this.deps.archiveGoal(goalId, {
      verdict: v.verdict, rounds: round,
      lastError: state.lastError, reviewFeedback: state.reviewFeedback,
    });
  }

  /** 节点失败（error/timeout/artifact 缺失或非法）。 */
  private async failNode(goalId: string, sessionID: string, kind: string, message: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (ns && ns.id === sessionID) {
      this.deps.db.finishNodeRun(ns.runId, {
        status: kind === 'timeout' ? 'timeout' : 'failed',
        finishedAt: new Date().toISOString(), error: message,
      });
      this.deps.emitNodeEvent({
        type: 'goal_node', goalId, projectDir: state.projectDir, loop: effectiveRound(state),
        node: ns.phase, transition: kind === 'timeout' ? 'timeout' : 'failed',
        at: new Date().toISOString(), error: message, attempt: ns.attempt,
      });
    }
    try { await this.deps.client.delete(sessionID); } catch { /* fail-open */ }
    writeGoalState(mafwDir, goalId, {
      nodeSession: null, lastError: `${kind}: ${message}`, reviewVerdict: 'ERROR',
      nextNode: 'archive_fail',
    });
    await this.advance(goalId);
  }

  /** 节点完成（idle + 产物双门）：解析产物 → 路由 → 写 state → advance。 */
  private async completeNode(goalId: string, sessionID: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (!ns || ns.id !== sessionID) return; // stale 事件守卫

    const node = ns.phase;
    const round = effectiveRound(state);
    const a = nodeArtifactPaths(mafwDir, goalId, round);

    // —— 双门之二：产物校验 ——
    const artifactPath = node === 'plan' ? a.waves : node === 'execute' ? a.receipt : a.review;
    if (!fs.existsSync(artifactPath)) {
      await this.failNode(goalId, sessionID, 'artifact_missing', `expected ${artifactPath}`);
      return;
    }

    // —— 解析（移植 NODE_CONFIGS.parseResult + plan.node/review.node 语义）——
    let patch: Partial<GoalStateV3>;
    let outcome: string;
    try {
      if (node === 'plan') {
        const waves = JSON.parse(fs.readFileSync(a.waves, 'utf-8'));
        if (waves.status === 'need_clarification') {
          patch = {
            pendingQuestion: {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'plan', loop: round, questions: waves.ambiguities || [], askedAt: new Date().toISOString(),
            },
          };
          outcome = 'need_clarification';
        } else {
          patch = { wavePlanPath: a.waves, pendingQuestion: null };
          outcome = `waves=${(waves.waves || []).length}`;
        }
      } else if (node === 'execute') {
        const receipt = JSON.parse(fs.readFileSync(a.receipt, 'utf-8'));
        patch = { receiptPath: a.receipt };
        outcome = `receipts=${(receipt.receipts || []).length}`;
      } else {
        const content = fs.readFileSync(a.review, 'utf-8');
        const verdict = parseReviewVerdict(content); // 既有共享模块
        const p: Partial<GoalStateV3> = {
          reviewVerdict: verdict.verdict,
          reviewReportPath: a.review,
          reviewFeedback: verdict.feedback,
          round: round + 1,
        };
        // same-signature 追问（移植 review.node.ts:56-74，上限 3）
        if (verdict.verdict === 'FAIL' && round < state.maxRounds) {
          const sameSig = state.reviewFeedback && matchesSignature(state.reviewFeedback, verdict.feedback);
          const newSameSigCount = sameSig ? state.sameSigCount + 1 : 1;
          p.sameSigCount = newSameSigCount;
          if (sameSig && newSameSigCount >= 2 && newSameSigCount <= 3) {
            p.pendingQuestion = {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'review', loop: round,
              questions: [`Review keeps failing with same issue: ${verdict.feedback}. Continue retrying?`],
              askedAt: new Date().toISOString(),
            };
          }
        } else {
          p.sameSigCount = 0;
        }
        patch = p;
        outcome = verdict.verdict;
      }
    } catch (err: any) {
      await this.failNode(goalId, sessionID, 'artifact_invalid', `${artifactPath}: ${err.message}`);
      return;
    }

    try { await this.deps.client.delete(sessionID); } catch { /* fail-open */ }

    const phaseNames = NODE_PHASE[node];
    const nextRound = patch.round ?? round;
    const nextNode = routeNext(
      node === 'plan' ? 'after_plan' : node === 'execute' ? 'after_execute' : 'after_review',
      {
        lastError: state.lastError,
        reviewVerdict: (patch.reviewVerdict ?? state.reviewVerdict) as any,
        round: nextRound,
        maxRounds: state.maxRounds,
        pendingQuestion: patch.pendingQuestion ?? null,
      },
    );

    this.deps.db.finishNodeRun(ns.runId, {
      status: 'succeeded', finishedAt: new Date().toISOString(), outcome,
    });
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: phaseNames.complete, loop: nextRound, projectDir: state.projectDir });
    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node,
      transition: 'finished', at: new Date().toISOString(), outcome, attempt: ns.attempt,
    });

    writeGoalState(mafwDir, goalId, {
      ...patch, nodeSession: null, phase: phaseNames.complete, nextNode, nextAction: `NEXT_${nextNode}`,
    }, { bumpVersion: node === 'review' });
    await this.advance(goalId);
  }

  /** askUser 应答——Task 8 实现。 */
  handleAnswer(_goalId: string, _questionId: string, _answer: string): boolean { return false; }

  /** askUser 取消——Task 8 实现。 */
  handleCancel(_goalId: string, _questionId: string): boolean { return false; }

  /** 崩溃恢复/watchdog 共用——Task 11 实现。 */
  async examineStaleNode(_goalId: string, _opts?: { probeSession?: (sessionID: string) => Promise<'alive' | 'dead'> }): Promise<void> {}

  /** 节点重跑——Task 12 实现。 */
  async retryNodeRun(_goalId: string, _runId: number): Promise<{ runId: number }> { throw new Error('not implemented'); }
}
