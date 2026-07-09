import { buildExecutionGraph, FileCheckpointer } from '../../src/langgraph';
import { LoopStateType } from '../../src/langgraph/loop-state';

export class GraphRunner {
  constructor(
    private projectDir: string,
    private mafwDir: string,
  ) {}

  async run(
    goalId: string,
    extraContext: Record<string, any>,
    onState: (update: { activeNodeId: string; phase: string }) => void,
    signal?: AbortSignal,
  ): Promise<{ status: string }> {
    const timeoutSignal = AbortSignal.timeout(120_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const cp = new FileCheckpointer(this.mafwDir);
    const graph = buildExecutionGraph(this.buildNodeOptions(this.mafwDir));
    const app = graph.compile({ checkpointer: cp });

    const initialState: Partial<LoopStateType> = {
      goalId: goalId as any,
      projectDir: this.projectDir as any,
      mafwDir: this.mafwDir as any,
      round: 1,
      maxRounds: 3,
      ...extraContext,
    };

    const stream = await app.stream(initialState, {
      configurable: { thread_id: goalId },
      signal: combinedSignal,
    });

    for await (const event of stream) {
      const nodeName = event.name;
      const nodeOutput = event.data?.output;
      if (nodeName && nodeOutput?.phase) {
        onState({ activeNodeId: nodeName.toUpperCase(), phase: nodeOutput.phase });
      }
    }

    return { status: 'completed' };
  }

  private buildNodeOptions(mafwDir: string) {
    return {
      plan: async (s: any) => ({ wavePlanPath: null, round: s.round }),
      execute: async (s: any) => ({ receiptPath: null }),
      review: async (s: any) => ({ reviewVerdict: 'PASS' as const, reviewReportPath: null, reviewFeedback: '' }),
      archiveSuccess: async (s: any) => { console.log(`[ChatGraph] ${s.goalId} PASSED`); return {}; },
      archiveFail: async (s: any) => { console.error(`[ChatGraph] ${s.goalId} FAILED: ${s.lastError}`); return {}; },
      archiveMaxRetries: async (s: any) => { console.error(`[ChatGraph] ${s.goalId} max retries`); return {}; },
    };
  }
}
