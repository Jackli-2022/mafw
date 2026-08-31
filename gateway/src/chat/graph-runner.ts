import { log } from '../core/utils/logger';
import { config } from '../config';
import { buildExecutionGraph, FileCheckpointer } from '../core/langgraph';
import { LoopStateType } from '../core/langgraph/loop-state';
import { LoopMonitor } from '../loop-monitor';

export class GraphRunner {
  private loopMonitor: LoopMonitor | null = null;

  constructor(
    private projectDir: string,
    private mafwDir: string,
  ) {
    // Initialize loop monitor for stuck loop detection
    const statusPath = require('path').join(mafwDir, 'status.md');
    this.loopMonitor = new LoopMonitor(statusPath);
  }

  /**
   * Check if the loop is stuck (no updates for stuckLoopTimeout ms).
   * Returns true if stuck and should be intervened.
   */
  isLoopStuck(): boolean {
    if (!this.loopMonitor) return false;
    try {
      return this.loopMonitor.isStuck(config.timeouts.stuckLoopTimeout);
    } catch {
      return false;
    }
  }

  async run(
    goalId: string,
    extraContext: Record<string, any>,
    onState: (update: { activeNodeId: string; phase: string }) => void,
    signal?: AbortSignal,
  ): Promise<{ status: string }> {
    const timeoutSignal = AbortSignal.timeout(config.timeouts.graphRunTimeout);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const graph = buildExecutionGraph(this.buildNodeOptions(this.mafwDir));
    graph.checkpointer = new FileCheckpointer(this.mafwDir);

    const initialState: Partial<LoopStateType> = {
      goalId: goalId as any,
      projectDir: this.projectDir as any,
      mafwDir: this.mafwDir as any,
      round: 1,
      maxRounds: config.loop.maxRounds,
      ...extraContext,
    };

    const stream = await graph.stream(initialState, {
      configurable: { thread_id: goalId },
      signal: combinedSignal,
    });

    for await (const event of stream as any) {
      // Check for stuck loop before processing event
      if (this.isLoopStuck()) {
        log.warn(`[GraphRunner] Loop ${goalId} appears stuck (no updates for ${config.timeouts.stuckLoopTimeout}ms)`);
        // Continue processing but log warning - actual intervention is done by caller
      }

      const nodeName = event.name || event.metadata?.name;
      const nodeOutput = event.data?.output || event;
      if (nodeName && nodeOutput?.phase) {
        onState({ activeNodeId: nodeName.toUpperCase(), phase: nodeOutput.phase });
      }
    }

    return { status: 'completed' };
  }

  private buildNodeOptions(mafwDir: string) {
    return {
      plan: async (s: any) => ({ wavePlanPath: null, round: s.round }),
      askUser: async (s: any) => ({ pendingQuestion: null }),
      execute: async (s: any) => ({ receiptPath: null }),
      review: async (s: any) => ({ reviewVerdict: 'PASS' as const, reviewReportPath: null, reviewFeedback: '' }),
      archiveSuccess: async (s: any) => { log.info(`[ChatGraph] ${s.goalId} PASSED`); return {}; },
      archiveFail: async (s: any) => { log.error(`[ChatGraph] ${s.goalId} FAILED: ${s.lastError}`); return {}; },
      archiveMaxRetries: async (s: any) => { log.error(`[ChatGraph] ${s.goalId} max retries`); return {}; },
    };
  }
}



