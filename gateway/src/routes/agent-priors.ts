// W1: <agent-priors> 聚合——L5 公理/启发式 + L2 失败模式谱（cat:failure/correction）。
// 纯 deps 注入，可单测；index.ts 接线 /api/recall/priors，fail-open。
import { formatAgentPriors } from '../recall/inject-format';

export interface AgentPriorsDeps {
  l5: { getTop(k?: number): { axioms: Array<{ content: string }>; heuristics: Array<{ pattern: string }> } };
  getIndex(): { entries: any[] };
  needFor?: (id: string) => number;
  topK?: number;
}

export async function handleAgentPriors(deps: AgentPriorsDeps): Promise<{
  block: string | null;
  used: number;
  budget: { maxChars: number };
}> {
  const topK = deps.topK ?? 5;
  const { axioms, heuristics } = deps.l5.getTop(topK);
  const patterns = deps.getIndex().entries
    .filter(
      (e: any) =>
        !e.superseded_by &&
        (e.cue_anchors ?? []).some((a: string) => a === 'cat:failure' || a === 'cat:correction'),
    )
    .map((e: any) => ({
      text: e.primary_abstraction as string,
      authority: (e.authority as string | undefined) ?? 'pipeline',
      // G1: pipeline-inferred patterns get a soft penalty (×0.7) — soft, not
      // filtered (E.4 trap), so verified-by-use inference can still surface.
      score:
        (e.energy ?? 0) *
        (e.salience ?? 1) *
        (1 + (deps.needFor?.(e.id) ?? 0)) *
        ((e.authority ?? 'pipeline') === 'pipeline' ? 0.7 : 1),
    }))
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ text: p.text, authority: p.authority }));

  const { block, used } = formatAgentPriors({
    axioms: (axioms ?? []).map((a) => a.content),
    heuristics: (heuristics ?? []).map((h) => h.pattern),
    failurePatterns: patterns,
  });
  return { block, used, budget: { maxChars: 800 } };
}
