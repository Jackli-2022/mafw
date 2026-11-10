import type { LeadTopicRow } from './lead-topic-store';

export interface TopicMemory {
  content: string;
  cueAnchors: string[];
  memoryType: 'semantic';
}

const DROP_SECTIONS = new Set(['user words', 'tool output']);

/**
 * Topic summaries carry decisions, open loops, user words and tool output.
 * Memory promotion is semantic-only: keep decisions/open loops (and prose that
 * is not inside a dropped section), never transcript phrases or tool logs.
 */
export function promotableSummary(summary: string): string {
  const lines = summary.split(/\r?\n/);
  const kept: string[] = [];
  let section: 'keep' | 'drop' = 'keep';
  for (const line of lines) {
    const heading = /^([A-Za-z][A-Za-z ]*):\s*$/.exec(line.trim());
    if (heading) {
      section = DROP_SECTIONS.has(heading[1].toLowerCase()) ? 'drop' : 'keep';
      if (section === 'keep') kept.push(line.trim());
      continue;
    }
    if (section === 'keep' && line.trim()) kept.push(line.trim());
  }
  return kept.join('\n').trim();
}

/** Build the semantic memory for a completed Goal's source topic. */
export function buildTopicMemory(input: {
  topic: LeadTopicRow;
  summary: string;
  goalId: string;
  projectDir: string;
}): TopicMemory {
  const body = promotableSummary(input.summary) || '（无决策记录）';
  return {
    content: `[${input.topic.title}] ${body}`,
    cueAnchors: [input.topic.id, input.goalId, input.projectDir],
    memoryType: 'semantic',
  };
}
