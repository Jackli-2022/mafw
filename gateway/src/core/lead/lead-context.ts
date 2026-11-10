import type { LeadGoalStatus } from './goal-status';
import type { LeadTopicRow } from './lead-topic-store';
import { buildRecalledBlock, type RecallCandidate, type RecallTopicInput } from './topic-recall';
import { estimateTopicTokens, selectWorkingSet, type WorkingSetBudget } from './working-set';

export type LeadContextBlockKind = 'goal-status' | 'topic-index' | 'recalled-topic';

export interface LeadContextBlock {
  kind: LeadContextBlockKind;
  topicId?: string;
  title?: string;
  text: string;
  tokens: number;
}

export interface LeadContext {
  blocks: LeadContextBlock[];
  totalTokens: number;
  recalledTopicIds: string[];
  trimmed: string[];
}

function goalStatusText(goals: LeadGoalStatus[]): string {
  const lines = goals.map((goal) => {
    const progress = goal.progress ? ` ${goal.progress.done}/${goal.progress.total}` : '';
    const blockers = goal.blockers.length > 0 ? ` ! ${goal.blockers.join('; ')}` : '';
    return `- [${goal.stage}] ${goal.title} (${goal.goalId})${progress}${blockers}`;
  });
  return ['<goal-status>', ...lines, '</goal-status>'].join('\n');
}

/**
 * Pure assembly of the per-turn Lead context. IO (topic rows, recall
 * candidates) is supplied by the caller; budget trimming happens here so the
 * ordering is deterministic and testable.
 */
export function buildLeadContext(input: {
  goals: LeadGoalStatus[];
  topics: LeadTopicRow[];
  query: string;
  recalled?: Array<{ candidate: RecallCandidate; topic: RecallTopicInput }>;
  pinnedTopicIds?: string[];
  budget?: Partial<WorkingSetBudget>;
}): LeadContext {
  const blocks: LeadContextBlock[] = [];
  const trimmed: string[] = [];
  const budget = input.budget ?? {};

  if (input.goals.length > 0) {
    const text = goalStatusText(input.goals);
    blocks.push({ kind: 'goal-status', text, tokens: estimateTopicTokens(text) });
  }

  const workingSet = selectWorkingSet({
    topics: input.topics.map((topic) => ({
      id: topic.id,
      state: topic.state,
      summary: topic.summary,
      lastActiveAt: topic.lastActiveAt,
      goalId: topic.goalId,
      residentTokens: topic.residentTokens,
    })),
    pinnedTopicIds: input.pinnedTopicIds,
    budget,
  });
  const indexIds = [...workingSet.pinned, ...workingSet.warm];
  const indexTopics = indexIds
    .map((id) => input.topics.find((topic) => topic.id === id))
    .filter((topic): topic is LeadTopicRow => !!topic);
  if (indexTopics.length > 0) {
    const lines = indexTopics.map((topic) => {
      const summary = topic.summary?.trim();
      return `- ${topic.title}${summary ? ` — ${summary.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
    });
    const warmBudget = Math.max(1, (budget.warmTopicTokens ?? 300) * Math.max(1, budget.warmTopicLimit ?? 5));
    while (lines.length > 1 && estimateTopicTokens([...lines, '<topic-index>', '</topic-index>'].join('\n')) > warmBudget) {
      lines.pop();
      if (!trimmed.includes('topic-index')) trimmed.push('topic-index');
    }
    const text = ['<topic-index>', ...lines, '</topic-index>'].join('\n');
    blocks.push({ kind: 'topic-index', text, tokens: estimateTopicTokens(text) });
  }

  const recallMax = Math.max(0, budget.recallMaxTokens ?? 1200);
  let recallTokens = 0;
  for (const item of input.recalled ?? []) {
    const text = buildRecalledBlock(item.candidate, item.topic);
    const tokens = estimateTopicTokens(text);
    if (recallTokens + tokens > recallMax) {
      if (!trimmed.includes('recalled-topic')) trimmed.push('recalled-topic');
      continue;
    }
    recallTokens += tokens;
    blocks.push({
      kind: 'recalled-topic',
      topicId: item.candidate.topicId,
      title: item.candidate.title,
      text,
      tokens,
    });
  }

  // Global ceiling: recalled first, then topic-index lines, then the block.
  // Goal status is never trimmed (it is the minimum useful context).
  const cap = Math.max(0, budget.maxResidentTokens ?? 76_800);
  let total = blocks.reduce((sum, block) => sum + block.tokens, 0);
  const markTrimmed = (kind: string): void => {
    if (!trimmed.includes(kind)) trimmed.push(kind);
  };
  while (total > cap) {
    let recallIndex = -1;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i].kind === 'recalled-topic') { recallIndex = i; break; }
    }
    if (recallIndex >= 0) {
      total -= blocks[recallIndex].tokens;
      blocks.splice(recallIndex, 1);
      markTrimmed('recalled-topic');
      continue;
    }
    const indexIndex = blocks.findIndex((block) => block.kind === 'topic-index');
    if (indexIndex >= 0) {
      const block = blocks[indexIndex];
      const lines = block.text.split('\n');
      if (lines.length > 3) {
        lines.splice(lines.length - 2, 1);
        const text = lines.join('\n');
        const tokens = estimateTopicTokens(text);
        total += tokens - block.tokens;
        block.text = text;
        block.tokens = tokens;
        markTrimmed('topic-index');
        continue;
      }
      total -= block.tokens;
      blocks.splice(indexIndex, 1);
      markTrimmed('topic-index');
      continue;
    }
    break;
  }

  return {
    blocks,
    totalTokens: blocks.reduce((sum, block) => sum + block.tokens, 0),
    recalledTopicIds: blocks
      .filter((block) => block.kind === 'recalled-topic' && block.topicId)
      .map((block) => block.topicId!),
    trimmed,
  };
}
