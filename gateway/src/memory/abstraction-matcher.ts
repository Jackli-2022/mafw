import { tokenize } from './derived-terms';

export interface MatchResult {
  similarity: number;
  level: 'auto' | 'conflict' | 'none';
}

const AUTO_THRESHOLD = 0.5;
const CONFLICT_THRESHOLD = 0.2;

export function matchAbstraction(a: string, b: string): MatchResult {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { similarity: 0, level: 'none' };
  }

  const wordsA = tokensA.filter(t => t.length > 2);
  const wordsB = tokensB.filter(t => t.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) {
    return { similarity: 0, level: 'none' };
  }

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  const similarity = intersection.size / union.size;

  if (similarity >= AUTO_THRESHOLD) return { similarity, level: 'auto' };
  if (similarity >= CONFLICT_THRESHOLD) return { similarity, level: 'conflict' };
  return { similarity, level: 'none' };
}
