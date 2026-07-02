import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState, loadWaves, loadReview } from '../utils/state';
import { startNextLoop } from './phase-orchestrator';
import { RecoveryManager } from '../../gateway/src/recovery';

export enum LoopState {
  IDLE = 'idle',
  PLANNING = 'planning',
  WAVE_READY = 'wave_ready',
  EXECUTING = 'executing',
  WAVE_CHECK = 'wave_check',
  REVIEWING = 'reviewing',
  VERDICT = 'verdict',
  PASS = 'pass',
  FAIL = 'fail',
  PARTIAL = 'partial',
  LOOP_RESET = 'loop_reset',
  WAVE_RETRY = 'wave_retry'
}

export enum WaveState {
  PENDING = 'pending',
  READY = 'ready',
  RUNNING = 'running',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export interface StateTransition {
  from: LoopState;
  to: LoopState;
  trigger: string;
  condition?: (state: LoopStateMachineImpl) => boolean;
  action?: (state: LoopStateMachineImpl) => Promise<void>;
}

export interface WaveStateMachine {
  waveNum: number;
  state: WaveState;
  dependencies: number[];
  agentId?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface LoopStateMachine {
  readonly goalId: string;
  readonly loopNum: number;
  state: LoopState;
  waves: WaveStateMachine[];
  currentWave: number;
  phase: string;
  verdict: string | null;
  transitions: StateTransition[];

  initTransitions(): void;
  handleEvent(trigger: string, data?: any): Promise<boolean>;
  getState(): {
    goalId: string;
    loopNum: number;
    state: LoopState;
    waves: WaveStateMachine[];
    currentWave: number;
    phase: string;
    verdict: string | null;
    transitions: number;
  };
  canStartWave(waveNum: number): boolean;
}

export class LoopStateMachineImpl implements LoopStateMachine {
  readonly goalId: string;
  readonly loopNum: number;
  state: LoopState = LoopState.IDLE;
  waves: WaveStateMachine[] = [];
  currentWave: number = 0;
  phase: string = '';
  verdict: string | null = null;
  transitions: StateTransition[] = [];
  private configDir: string;
  private pendingData: any;

  constructor(goalId: string, loopNum: number, configDir: string = '.') {
    this.goalId = goalId;
    this.loopNum = loopNum;
    this.configDir = configDir;
    this.pendingData = undefined;
    this.initTransitions();
  }

  initTransitions(): void {
    this.transitions = [
      {
        from: LoopState.IDLE,
        to: LoopState.PLANNING,
        trigger: 'goal.create',
        action: async (m) => { await m.initLoop(); }
      },
      {
        from: LoopState.PLANNING,
        to: LoopState.WAVE_READY,
        trigger: 'plan.complete',
        action: async (m) => { await m.loadWaves(); }
      },
      {
        from: LoopState.WAVE_READY,
        to: LoopState.EXECUTING,
        trigger: 'deps.satisfied',
        condition: (m) => m.waves.some(w => w.state === WaveState.READY),
        action: async (m) => { await m.assignAgent(); }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.WAVE_CHECK,
        trigger: 'wave.complete',
        action: async (m) => { await m.markWaveCompleted(); }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.WAVE_RETRY,
        trigger: 'wave.fail',
        condition: (m) => {
          const w = m.waves.find(w => w.state === WaveState.FAILED);
          return w !== undefined && w.retryCount < w.maxRetries;
        },
        action: async (m) => { await m.incrementRetry(); }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.LOOP_RESET,
        trigger: 'wave.fail',
        condition: (m) => {
          const w = m.waves.find(w => w.state === WaveState.FAILED);
          return w !== undefined && w.retryCount >= w.maxRetries;
        },
        action: async (m) => {
          const prevWave = m.currentWave > 1 ? m.currentWave - 1 : undefined;
          const recovery = new RecoveryManager(m.configDir);
          await recovery.restoreLoop(m.goalId, m.loopNum, prevWave);
          await m.startNewLoop();
        }
      },
      {
        from: LoopState.EXECUTING,
        to: LoopState.REVIEWING,
        trigger: 'wave.complete',
        condition: (m) => m.waves.every(w => w.state === WaveState.COMPLETED || w.state === WaveState.FAILED),
        action: async (m) => { await m.triggerReview(); }
      },
      {
        from: LoopState.WAVE_CHECK,
        to: LoopState.WAVE_READY,
        trigger: 'moreWaves',
        condition: (m) => m.waves.some(w => w.state === WaveState.READY),
      },
      {
        from: LoopState.WAVE_CHECK,
        to: LoopState.REVIEWING,
        trigger: 'noMoreWaves',
        condition: (m) => !m.waves.some(w => w.state === WaveState.READY || w.state === WaveState.RUNNING),
        action: async (m) => { await m.triggerReview(); }
      },
      {
        from: LoopState.REVIEWING,
        to: LoopState.VERDICT,
        trigger: 'review.complete',
        action: async (m) => { await m.parseVerdict(); }
      },
      {
        from: LoopState.VERDICT,
        to: LoopState.PASS,
        trigger: 'auto',
        condition: (m) => m.verdict === 'PASS',
        action: async (m) => { await m.archiveGoal(); }
      },
      {
        from: LoopState.VERDICT,
        to: LoopState.FAIL,
        trigger: 'auto',
        condition: (m) => m.verdict === 'FAIL',
        action: async (m) => { await m.startNewLoop(); }
      },
      {
        from: LoopState.VERDICT,
        to: LoopState.PARTIAL,
        trigger: 'auto',
        condition: (m) => m.verdict === 'PARTIAL',
        action: async (m) => { await m.retryFailedWaves(); }
      },
      {
        from: LoopState.LOOP_RESET,
        to: LoopState.PLANNING,
        trigger: 'auto',
        action: async (m) => { await m.resetLoop(); }
      },
      {
        from: LoopState.WAVE_RETRY,
        to: LoopState.WAVE_READY,
        trigger: 'auto',
        action: async (m) => { await m.resetWave(); }
      }
    ];
  }

  async handleEvent(trigger: string, data?: any): Promise<boolean> {
    this.pendingData = data;
    for (const t of this.transitions) {
      if (t.from === this.state && t.trigger === trigger) {
        if (t.condition && !t.condition(this)) {
          continue;
        }
        this.state = t.to;
        if (t.action) {
          await t.action(this);
        }
        return true;
      }
    }
    return false;
  }

  getState() {
    return {
      goalId: this.goalId,
      loopNum: this.loopNum,
      state: this.state,
      waves: this.waves,
      currentWave: this.currentWave,
      phase: this.phase,
      verdict: this.verdict,
      transitions: this.transitions.length
    };
  }

  canStartWave(waveNum: number): boolean {
    const wave = this.waves.find(w => w.waveNum === waveNum);
    if (!wave) return false;
    return wave.dependencies.every(depNum => {
      const depWave = this.waves.find(w => w.waveNum === depNum);
      return depWave && depWave.state === WaveState.COMPLETED;
    });
  }

  private async initLoop(): Promise<void> {
    this.phase = 'PLANNING';
    await updateState(this.goalId, {
      phase: 'PLANNING',
      lastPhase: null,
      loop: this.loopNum,
      nextAction: 'CREATE_PLAN_SESSION'
    }, this.configDir);
  }

  private async loadWaves(): Promise<void> {
    const wavesData = await loadWaves(this.goalId, this.configDir);
    this.waves = wavesData.map((w: any, i: number) => ({
      waveNum: i + 1,
      state: w.dependencies && w.dependencies.length > 0 ? WaveState.PENDING : WaveState.READY,
      dependencies: w.dependencies || [],
      retryCount: 0,
      maxRetries: 3
    }));
    this.phase = 'WAVE_READY';
    await updateState(this.goalId, {
      phase: 'WAVE_READY',
      totalWaves: this.waves.length,
      nextAction: 'WAIT_PHASE_COMPLETE'
    }, this.configDir);
    // Auto-trigger deps.satisfied if any wave is READY
    if (this.waves.some(w => w.state === WaveState.READY)) {
      await this.handleEvent('deps.satisfied');
    }
  }

  private async assignAgent(): Promise<void> {
    const wave = this.waves.find(w => w.state === WaveState.READY);
    if (!wave) return;
    wave.state = WaveState.RUNNING;
    wave.startTime = new Date().toISOString();
    this.currentWave = wave.waveNum;
    this.phase = 'EXECUTING';
    await updateState(this.goalId, {
      phase: 'EXECUTING',
      currentWave: this.currentWave,
      nextAction: 'CREATE_EXECUTE_SESSION'
    }, this.configDir);
  }

  private async markWaveCompleted(): Promise<void> {
    const wave = this.waves.find(w => w.state === WaveState.RUNNING);
    if (wave) {
      wave.state = WaveState.COMPLETED;
      wave.endTime = new Date().toISOString();
      // Save checkpoint at wave level for rollback
      const recovery = new RecoveryManager(this.configDir);
      recovery.saveCheckpoint(this.goalId, this.loopNum,
        { phase: this.phase, currentWave: wave.waveNum },
        wave.waveNum
      );
    }
  }

  private async incrementRetry(): Promise<void> {
    const wave = this.waves.find(w => w.state === WaveState.FAILED);
    if (wave) {
      wave.retryCount++;
      wave.state = WaveState.RETRYING;
    }
  }

  private async triggerReview(): Promise<void> {
    this.phase = 'REVIEWING';
    await updateState(this.goalId, {
      phase: 'REVIEWING',
      nextAction: 'CREATE_REVIEW_SESSION'
    }, this.configDir);
  }

  private async parseVerdict(): Promise<void> {
    // Check for forced verdict from pendingData first
    if (this.pendingData && this.pendingData.verdict) {
      this.verdict = this.pendingData.verdict;
    } else {
      try {
        const reviewContent = await loadReview(this.goalId, this.loopNum, this.configDir);
        if (!reviewContent) {
          this.verdict = 'FAIL';
        } else {
          const verdictMatch = reviewContent.match(/Verdict:\s*(PASS|FAIL|PARTIAL)/i);
          if (verdictMatch) {
            this.verdict = verdictMatch[1].toUpperCase();
          } else if (reviewContent.includes('PASS') || reviewContent.includes('pass')) {
            this.verdict = 'PASS';
          } else {
            this.verdict = 'FAIL';
          }
        }
      } catch {
        this.verdict = 'FAIL';
      }
    }
    // Auto-trigger the verdict routing
    await this.handleEvent('auto');
  }

  private async archiveGoal(): Promise<void> {
    await updateState(this.goalId, {
      phase: 'ARCHIVED',
      nextAction: 'ARCHIVE',
      metrics: {}
    }, this.configDir);
  }

  private async startNewLoop(): Promise<void> {
    await startNextLoop(this.goalId, this.configDir);
  }

  private async retryFailedWaves(): Promise<void> {
    for (const wave of this.waves) {
      if (wave.state === WaveState.FAILED) {
        wave.state = WaveState.RETRYING;
        wave.retryCount = 0;
      }
    }
    const readyWaves = this.waves.filter(w => w.state === WaveState.RETRYING);
    for (const w of readyWaves) {
      w.state = WaveState.READY;
    }
    this.phase = 'WAVE_READY';
    await updateState(this.goalId, {
      phase: 'WAVE_READY',
      nextAction: 'WAIT_PHASE_COMPLETE'
    }, this.configDir);
  }

  private async resetLoop(): Promise<void> {
    this.state = LoopState.PLANNING;
    this.waves = [];
    this.currentWave = 0;
    this.phase = 'PLANNING';
    this.verdict = null;
  }

  private async resetWave(): Promise<void> {
    const retryingWave = this.waves.find(w => w.state === WaveState.RETRYING);
    if (retryingWave) {
      retryingWave.state = WaveState.READY;
      retryingWave.error = undefined;
      retryingWave.startTime = undefined;
      retryingWave.endTime = undefined;
    }
  }
}
