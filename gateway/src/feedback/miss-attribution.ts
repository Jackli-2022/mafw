import { tokenize } from '../memory/derived-terms';

export interface MissInput {
  query: string;
  matchedCount: number;
  relatedMemoryExists: boolean;
  relatedMemoryAnchors: string[];
}

export interface MissResult {
  cause: 'anchor_poor' | 'irrelevant_memory';
  candidates: string[];
}

export function classifyMiss(input: MissInput): MissResult {
  const queryTokens = tokenize(input.query);
  const candidateAnchors: string[] = [];

  if (input.relatedMemoryExists && input.matchedCount === 0) {
    for (const qt of queryTokens) {
      if (qt.length > 1 && !input.relatedMemoryAnchors.some(a => a.includes(qt))) {
        candidateAnchors.push(qt);
      }
    }
    return { cause: 'anchor_poor', candidates: candidateAnchors.slice(0, 3) };
  }

  if (input.matchedCount > 3) {
    return { cause: 'irrelevant_memory', candidates: [] };
  }

  return { cause: 'anchor_poor', candidates: candidateAnchors.slice(0, 3) };
}
