// Pure retrieval metrics for the T1 baseline. No I/O.
export function recallAtK(expected: string[], actual: string[], k: number): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const top = new Set(actual.slice(0, Math.max(0, k)));
  return expected.filter((id) => top.has(id)).length / expected.length;
}

export function mrr(expected: string[], actual: string[]): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const wanted = new Set(expected);
  for (let i = 0; i < actual.length; i++) {
    if (wanted.has(actual[i])) return 1 / (i + 1);
  }
  return 0;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarize(
  rows: Array<{ expected: string[]; actual: string[] }>,
  k: number,
): { recall: number; mrr: number; noAnswer: number; cases: number } {
  return {
    recall: mean(rows.map((row) => recallAtK(row.expected, row.actual, k))),
    mrr: mean(rows.map((row) => mrr(row.expected, row.actual))),
    noAnswer: mean(rows.filter((row) => row.expected.length === 0).map((row) => (row.actual.length === 0 ? 1 : 0))),
    cases: rows.length,
  };
}
