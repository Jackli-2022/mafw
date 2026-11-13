// First-party LLM GoalEval provider.
//
// It is an independent verifier, not an executor: the runtime completion
// channel receives the GoalEval conditions, plan and reviewer task evidence,
// and returns structured condition results. Core validation still decides the
// verdict; any failure leaves the reviewer rubric untouched.
import type { CompletionChannel } from '../../runtime/contract';
import type { GoalEval } from './goal-eval';
import type {
  GoalEvalConditionResult,
  GoalEvalProvider,
  GoalEvalProviderInput,
} from './goal-eval-provider';

export interface LlmGoalEvalProviderOptions {
  id?: string;
  /** Live completion channel thunk (runtime hot-swap safe). */
  channel: () => CompletionChannel | undefined;
  model: { providerID: string; modelID: string };
  timeoutMs?: number;
  maxTokens?: number;
}

const SYSTEM = [
  'You are an independent Goal acceptance verifier.',
  'Evaluate every Goal condition using only the supplied plan, reviewer task results and evidence.',
  'Do not accept a condition without verifiable evidence. Do not invent tests or files.',
  'Return ONLY a JSON array; each item must be { "conditionId": string, "result": "pass"|"fail"|"skipped", "evidence": string }.',
  'Use skipped only when the condition is not applicable; required conditions that are not verifiably passing must be fail or skipped.',
].join(' ');

export function buildGoalEvalPrompt(input: GoalEvalProviderInput): string {
  return [
    'GoalEval:',
    JSON.stringify({
      outcome: input.goalEval.outcome,
      conditions: input.goalEval.conditions,
      failureConditions: input.goalEval.failureConditions,
      constraints: input.goalEval.constraints,
      nonGoals: input.goalEval.nonGoals,
      mapping: input.goalEval.mapping,
    }, null, 2),
    '',
    'Plan:',
    JSON.stringify(input.plan ?? null, null, 2),
    '',
    'Reviewer task results:',
    JSON.stringify(input.taskResults ?? [], null, 2),
    '',
    'Reviewer feedback:',
    typeof input.reviewFeedback === 'string' ? input.reviewFeedback : '',
  ].join('\n');
}

function extractJsonArray(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('GoalEval provider returned no JSON array');
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err: any) {
    throw new Error(`GoalEval provider returned invalid JSON: ${err?.message || err}`);
  }
}

export function parseGoalEvalProviderResults(text: string): GoalEvalConditionResult[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) throw new Error('GoalEval provider result must be a JSON array');
  return parsed as GoalEvalConditionResult[];
}

export function createLlmGoalEvalProvider(
  options: LlmGoalEvalProviderOptions,
): GoalEvalProvider | null {
  if (!options.model?.providerID || !options.model.modelID) return null;
  return {
    id: options.id ?? 'llm-goal-eval',
    async evaluate(input: GoalEvalProviderInput): Promise<GoalEvalConditionResult[]> {
      const channel = options.channel();
      if (!channel) throw new Error('runtime completion channel unavailable');
      const result = await channel.complete({
        model: options.model,
        system: [{ text: SYSTEM }],
        user: [{ type: 'text', text: buildGoalEvalPrompt(input) }],
        maxTokens: options.maxTokens ?? 2048,
        temperature: 0,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
      return parseGoalEvalProviderResults(result.text);
    },
  };
}
