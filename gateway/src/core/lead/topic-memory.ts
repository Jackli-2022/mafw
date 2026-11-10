import type { LeadTopicRow } from './lead-topic-store';

export interface TopicMemory {
  content: string;
  cueAnchors: string[];
  memoryType: 'semantic';
}

/** Build the semantic memory for a completed Goal's source topic. */
export function buildTopicMemory(input: {
  topic: LeadTopicRow;
  summary: string;
  goalId: string;
  projectDir: string;
}): TopicMemory {
  return {
    content: `[${input.topic.title}] ${input.summary.trim()}`,
    cueAnchors: [input.topic.id, input.goalId, input.projectDir],
    memoryType: 'semantic',
  };
}
