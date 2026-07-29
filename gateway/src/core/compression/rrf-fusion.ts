export interface RRFResult {
  id: string;
  score: number;
  text?: string;
  metadata?: any;
  loopNum?: number;
}

export function reciprocalRankFusion(...resultLists: RRFResult[][]): RRFResult[];
export function reciprocalRankFusion(k: number, ...resultLists: RRFResult[][]): RRFResult[];
export function reciprocalRankFusion(
  first: number | RRFResult[],
  ...rest: RRFResult[][]
): RRFResult[] {
  let k = 60;
  let resultLists: RRFResult[][];

  if (first === undefined) {
    return [];
  }
  if (typeof first === 'number') {
    k = first;
    resultLists = rest;
  } else {
    resultLists = [first, ...rest];
  }

  const fused = new Map<string, { score: number; text?: string; metadata?: any; loopNum?: number }>();

  for (const list of resultLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const contribution = 1 / (k + rank);

      if (fused.has(item.id)) {
        const existing = fused.get(item.id)!;
        existing.score += contribution;
        if (item.text !== undefined) existing.text = item.text;
        if (item.metadata !== undefined) existing.metadata = item.metadata;
        if (item.loopNum !== undefined) existing.loopNum = item.loopNum;
      } else {
        fused.set(item.id, {
          score: contribution,
          text: item.text,
          metadata: item.metadata,
          loopNum: item.loopNum
        });
      }
    }
  }

  return Array.from(fused.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.score - a.score);
}

export function diversifyByLoop(
  results: RRFResult[],
  maxPerLoop = 3
): RRFResult[] {
  const counts = new Map<number, number>();
  const output: RRFResult[] = [];

  for (const item of results) {
    if (item.loopNum === undefined) {
      output.push(item);
    } else {
      const count = counts.get(item.loopNum) ?? 0;
      if (count < maxPerLoop) {
        counts.set(item.loopNum, count + 1);
        output.push(item);
      }
    }
  }

  return output;
}
