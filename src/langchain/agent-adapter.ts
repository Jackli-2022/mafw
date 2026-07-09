import { AgentAction, AgentFinish } from "@langchain/core/agents";
import { Callbacks } from "@langchain/core/callbacks/manager";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentServices } from './node-runner';

export interface IntermediateStep {
  action: AgentAction;
  observation: string;
}

export abstract class BaseSingleActionAgent {
  abstract get inputKeys(): string[];
  abstract get outputKeys(): string[];
  lc_namespace!: string[];

  abstract plan(
    steps: IntermediateStep[],
    callbacks?: Callbacks,
    config?: RunnableConfig,
  ): Promise<AgentAction | AgentFinish>;
}

export class CodeAgentAdapter extends BaseSingleActionAgent {
  lc_namespace = ["mafw", "agent"];

  constructor(
    private services: AgentServices,
    private instruction: string,
    private goalId: string,
  ) {
    super();
  }

  get inputKeys(): string[] {
    return ["input"];
  }

  get outputKeys(): string[] {
    return ["output"];
  }

  async plan(
    _steps: IntermediateStep[],
    _callbacks: Callbacks | undefined,
    _config: RunnableConfig | undefined,
  ): Promise<AgentAction | AgentFinish> {
    const sessionId = await this.services.createSession(this.goalId);
    await this.services.sendPrompt(sessionId, this.instruction);
    return {
      returnValues: { output: 'delegated_to_opencode' },
      log: `Delegated to OpenCode SDK: ${this.instruction}`,
    };
  }
}
