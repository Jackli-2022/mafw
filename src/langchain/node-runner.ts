import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from "../langgraph/loop-state";
import * as path from "path";
import * as fs from "fs";

export interface AgentServices {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export interface NodeConfig {
  skillCommand: string;
  interruptLabel: string;
  phaseName: string;
  phaseCompleteName: string;
  getResultFile: (state: LoopStateType) => string;
  parseResult: (filePath: string, state: LoopStateType) => Partial<LoopStateType>;
  errorMessage: string;
}

export function parseReviewVerdict(content: string): { verdict: 'PASS' | 'FAIL' | 'ERROR'; feedback: string } {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }

  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) {
      return { verdict: 'PASS', feedback: content.slice(0, 200) };
    }
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

const NODE_CONFIGS: Record<string, NodeConfig> = {
  plan: {
    skillCommand: '/skill mafw-plan',
    interruptLabel: 'awaiting_plan',
    phaseName: 'PLANNING',
    phaseCompleteName: 'PLANNING_COMPLETE',
    getResultFile: (state) => path.join(state.mafwDir!, 'waves.json'),
    parseResult: (filePath, state) => {
      JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { wavePlanPath: filePath, round: state.round };
    },
    errorMessage: 'waves.json not found after plan',
  },
  execute: {
    skillCommand: '/skill mafw-execute',
    interruptLabel: 'awaiting_execution',
    phaseName: 'EXECUTING',
    phaseCompleteName: 'EXECUTING_COMPLETE',
    getResultFile: (state) => path.join(state.mafwDir!, 'receipts', state.goalId!, 'loop-receipt.json'),
    parseResult: (filePath) => {
      JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { receiptPath: filePath };
    },
    errorMessage: 'receipts not found after execute',
  },
  review: {
    skillCommand: '/skill mafw-review',
    interruptLabel: 'awaiting_review',
    phaseName: 'REVIEWING',
    phaseCompleteName: 'REVIEWING_COMPLETE',
    getResultFile: (state) => path.join(state.mafwDir!, 'reviews', `${state.goalId!}-loop${state.round}.md`),
    parseResult: (filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const verdict = parseReviewVerdict(content);
      return {
        reviewVerdict: verdict.verdict,
        reviewReportPath: filePath,
        reviewFeedback: verdict.feedback,
      };
    },
    errorMessage: 'review report not found',
  },
};

export function createAgentNode(type: 'plan' | 'execute' | 'review') {
  const config = NODE_CONFIGS[type];

  return async function agentNode(
    state: LoopStateType,
    options: AgentServices,
  ): Promise<Partial<LoopStateType>> {
    const { createSession, sendPrompt, destroySession, syncToFile } = options;
    const { goalId, projectDir } = state;

    syncToFile({ ...state, phase: config.phaseName });

    const sessionId = await createSession(projectDir!);
    await sendPrompt(sessionId, `${config.skillCommand} ${goalId}`);

    interrupt(config.interruptLabel);

    const filePath = config.getResultFile(state);
    if (!fs.existsSync(filePath)) {
      return { lastError: config.errorMessage, reviewVerdict: 'ERROR' as const };
    }

    let result: Partial<LoopStateType>;
    try {
      result = config.parseResult(filePath, state);
    } catch (err: any) {
      return { lastError: `Invalid result: ${err.message}`, reviewVerdict: 'ERROR' as const };
    }

    await destroySession(sessionId);

    syncToFile({ ...result, phase: config.phaseCompleteName });

    return result;
  };
}
