import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnitFileStore } from "../../memory/harmonic-file-store";

interface FrontierItem { id: string; weight: number; }
interface IterState { seen: string[]; frontier: FrontierItem[]; round: number; }

export function encodeState(s: IterState): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
}

export function decodeState(raw: string | undefined | null): IterState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(s?.seen) || !Array.isArray(s?.frontier) || typeof s?.round !== 'number') return null;
    return {
      seen: s.seen.filter((x: unknown) => typeof x === 'string'),
      frontier: s.frontier
        .filter((x: any) => typeof x?.id === 'string')
        .map((x: any) => ({ id: x.id, weight: Number(x.weight) || 1 })),
      round: s.round,
    };
  } catch {
    return null;
  }
}

// 兼容生产（MemoryService.harmonicIndex.*）与测试（裸 HarmonicIndexManager）两种访问路径
function getGraphStore(memory: any) {
  return memory?.harmonicIndex?.getAnchorGraphStore?.() ?? memory?.getAnchorGraphStore?.() ?? null;
}

function getIndexEntries(memory: any) {
  return memory?.harmonicIndex?.getIndex?.()?.entries ?? memory?.getIndex?.()?.entries ?? [];
}

export const handleSearchHybrid: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || config.search.defaultTopK;
    const retriever = (args.retriever as 'token' | 'bm25' | undefined) || config.search.defaultRetriever;
    const maxRounds = config.search.maxExpandRounds;
    const graphStore = getGraphStore(memory);
    const prev = decodeState(args.state as string | undefined);

    let scored: Array<{ entry: any; score: number; graphScore: number }>;
    let seen: string[];
    let frontier: FrontierItem[];
    let round: number;

    if (!prev) {
      // ── 首轮：现有行为原样（searchScored 已含图扩展+融合）+ 计算 frontier ──
      scored = memory.search(query, topK * 2, { retriever }).map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));
      seen = scored.map(s => s.entry.id);
      frontier = computeFrontier(graphStore, scored.map(s => s.entry.id), new Set(seen));
      round = 0;
    } else if (prev.round >= maxRounds) {
      // ── 轮次已满：不扩展、不消费 frontier，仅返回 bm25 新命中增量 ──
      const seenSet = new Set(prev.seen);
      scored = memory.search(query, topK * 2, { retriever })
        .filter((e: any) => !seenSet.has(e.id))
        .map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));
      seen = prev.seen;
      frontier = prev.frontier;
      round = prev.round;
    } else {
      // ── 迭代轮：frontier 条目(graph-only 评分) + bm25 新命中，统一归一化融合 ──
      round = prev.round + 1;
      const seenSet = new Set(prev.seen);
      const entries = getIndexEntries(memory);
      const frontierHits: Array<{ entry: any; score: number; graphScore: number }> = [];
      for (const f of prev.frontier) {
        if (seenSet.has(f.id)) continue;
        const entry = entries.find((e: any) => e.id === f.id);
        if (!entry || entry.superseded_by) continue;
        frontierHits.push({ entry, score: 0, graphScore: f.weight * (entry.energy ?? 0.8) * (entry.salience ?? 1) });
      }
      const freshHits = memory.search(query, topK * 2, { retriever })
        .filter((e: any) => !seenSet.has(e.id))
        .map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));

      const union = mergeById(frontierHits, freshHits);
      const norm = (vals: number[]) => {
        if (vals.length === 0) return [];
        const min = Math.min(...vals), max = Math.max(...vals);
        if (max === min) return vals.map(() => 0.5);
        return vals.map(v => (v - min) / (max - min));
      };
      const nb = norm(union.map(u => u.score));
      const ng = norm(union.map(u => u.graphScore));
      const gw = config.search.graph.rerankGraphWeight;
      scored = union.map((u, i) => ({ ...u, score: (1 - gw) * nb[i] + gw * ng[i] }))
        .sort((a, b) => b.score - a.score);

      seen = [...prev.seen];
      for (const s of scored) if (!seen.includes(s.entry.id)) seen.push(s.entry.id);
      // 新 frontier = 本次新结果邻居 + 剩余旧 frontier（未消费项，去重）
      const consumed = new Set(scored.map(s => s.entry.id));
      const remaining = prev.frontier.filter(f => !consumed.has(f.id) && !seen.includes(f.id));
      frontier = [...computeFrontier(graphStore, scored.map(s => s.entry.id), new Set(seen)), ...remaining];
    }

    // memoryType 后置过滤（首轮与迭代轮一致）
    const results = scored.filter((r: any) => !args.memoryType || r.entry.type === args.memoryType)
      .slice(0, topK)
      .map(r => r.entry);

    const canExpand = frontier.length > 0 && round < maxRounds;

    // Enrich with full memory_value from OKF store.
    const store = new HarmonicUnitFileStore(mafwDir || config.resolvePath());
    const enriched: any[] = [];
    for (const r of results) {
      let unit = null;
      try {
        unit = await store.read(r.id);
      } catch { /* keep entry-only */ }
      enriched.push({ ...r, memory_value: unit?.memory_value || (r as any).memory_value || '' });
    }

    const state = canExpand || round > 0 ? encodeState({ seen, frontier, round }) : null;
    const hint = canExpand
      ? '如需更多相关记忆，携带 state 再次调用本工具继续扩展检索。'
      : frontier.length === 0
        ? '已无更多可扩展的相关记忆。'
        : '已达最大扩展轮数。';

    return { content: [{ type: "text", text: JSON.stringify({ results: enriched, canExpand, state, round, count: enriched.length, hint }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};

function computeFrontier(graphStore: any, ids: string[], exclude: Set<string>): FrontierItem[] {
  if (!graphStore || ids.length === 0) return [];
  const result: FrontierItem[] = [];
  for (const id of ids) {
    const neighbors = graphStore.getNeighbors([id], 3, exclude);
    for (const [nbId, info] of neighbors) {
      if (!result.some(f => f.id === nbId)) result.push({ id: nbId, weight: info.weight });
    }
    if (result.length >= 30) break;
  }
  return result;
}

function mergeById(
  a: Array<{ entry: any; score: number; graphScore: number }>,
  b: Array<{ entry: any; score: number; graphScore: number }>,
): Array<{ entry: any; score: number; graphScore: number }> {
  const byId = new Map<string, { entry: any; score: number; graphScore: number }>();
  for (const item of [...a, ...b]) {
    const existing = byId.get(item.entry.id);
    if (!existing) byId.set(item.entry.id, item);
    else {
      existing.score = Math.max(existing.score, item.score);
      existing.graphScore = Math.max(existing.graphScore, item.graphScore);
    }
  }
  return [...byId.values()];
}
