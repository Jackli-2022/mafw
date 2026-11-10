import type { LeadTopicState } from './lead-topic-store';

export interface WorkingSetBudget {
  maxResidentTokens: number;
  warmTopicLimit: number;
  warmTopicTokens: number;
  recallMaxTopics: number;
  recallMaxTokens: number;
}

export interface WorkingSetTopic {
  id: string;
  state: LeadTopicState;
  summary: string | null;
  lastActiveAt: string;
  goalId: string;
  residentTokens: number;
}

export interface WorkingSet {
  resident: string[];
  warm: string[];
  cold: string[];
  pinned: string[];
  evicted: string[];
}

export const DEFAULT_WORKING_SET_BUDGET: WorkingSetBudget = {
  // 60% of a 128k window; callers can override per runtime.
  maxResidentTokens: 76_800,
  warmTopicLimit: 5,
  warmTopicTokens: 300,
  recallMaxTopics: 2,
  recallMaxTokens: 1200,
};

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN_RE = /[A-Za-z0-9_]+/g;

/** Rough deterministic token estimate: latin words + CJK bigrams. */
export function estimateTopicTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const latin = text.replace(CJK_RE, ' ').match(LATIN_RE)?.length ?? 0;
  return latin + Math.ceil(cjk / 2);
}

function budgetOf(partial?: Partial<WorkingSetBudget>): WorkingSetBudget {
  return { ...DEFAULT_WORKING_SET_BUDGET, ...(partial ?? {}) };
}

function byRecent(a: WorkingSetTopic, b: WorkingSetTopic): number {
  return b.lastActiveAt.localeCompare(a.lastActiveAt) || a.id.localeCompare(b.id);
}

function byOldest(a: WorkingSetTopic, b: WorkingSetTopic): number {
  return a.lastActiveAt.localeCompare(b.lastActiveAt) || a.id.localeCompare(b.id);
}

/**
 * Classify topics into the resident/warm/cold pages. State is a hint; recency
 * wins for warm/cold, and resident pages are evicted oldest-first when the
 * token budget is exceeded (always keeping at least one resident).
 */
export function selectWorkingSet(input: {
  topics: WorkingSetTopic[];
  pinnedTopicIds?: string[];
  budget?: Partial<WorkingSetBudget>;
}): WorkingSet {
  const budget = budgetOf(input.budget);
  const pinnedIds = new Set(input.pinnedTopicIds ?? []);
  const pinned = input.topics.filter((topic) => pinnedIds.has(topic.id)).sort(byRecent);

  const residents = input.topics
    .filter((topic) => !pinnedIds.has(topic.id) && topic.state === 'resident')
    .sort(byRecent);
  const others = input.topics
    .filter((topic) => !pinnedIds.has(topic.id) && topic.state !== 'resident')
    .sort(byRecent);

  const warmCandidates = others.filter((topic) => topic.state !== 'archived');
  const archived = others.filter((topic) => topic.state === 'archived');
  const warm = warmCandidates.slice(0, Math.max(0, budget.warmTopicLimit));
  const cold = [...warmCandidates.slice(Math.max(0, budget.warmTopicLimit)), ...archived];

  const evicted: string[] = [];
  const kept = residents.slice();
  let residentTokens = kept.reduce((sum, topic) => sum + Math.max(0, topic.residentTokens), 0);
  const oldestFirst = kept.slice().sort(byOldest);
  while (residentTokens > budget.maxResidentTokens && kept.length > 1) {
    const victim = oldestFirst.find((topic) => kept.includes(topic));
    if (!victim) break;
    kept.splice(kept.indexOf(victim), 1);
    evicted.push(victim.id);
    residentTokens -= Math.max(0, victim.residentTokens);
  }

  return {
    resident: kept.map((topic) => topic.id),
    warm: warm.map((topic) => topic.id),
    cold: cold.map((topic) => topic.id),
    pinned: pinned.map((topic) => topic.id),
    evicted,
  };
}
