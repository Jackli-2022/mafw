export interface DiffusionOptions {
  alpha: number;
  iterations: number;
  candidateCap: number;
  /** D5 Hebbian plasticity (EngramRAG U-PPR): 7-day retrieval-hit count per
   *  node — transitions into frequently-walked traces get upweighted by
   *  (1 + ln(1+need)). Absent → flat legacy behavior. */
  needFor?: (id: string) => number;
  /** D5 Macro-Hub suppression: nodes whose out-degree exceeds this floor get
   *  incoming edge weights scaled by 1/(1+ln(deg/floor)) — hubs are pathways,
   *  not destinations. Absent/0 → no suppression. */
  hubFloor?: number;
}

/**
 * Bounded Personalized PageRank over a lazily-expanded subgraph.
 * - seeds get uniform teleport mass; mass spreads along row-normalized edges
 * - subgraph grows from seeds up to candidateCap nodes
 * - returns scores normalized to 0–1 (divide by max) for downstream fusion
 * Pure: no IO, no config access. Callers bound latency via candidateCap/iterations.
 */
export function personalizedPageRank(
  seeds: string[],
  neighborsOf: (id: string) => Map<string, number>,
  opts: DiffusionOptions,
): Map<string, number> {
  const nodes = new Set<string>();
  const adj = new Map<string, Map<string, number>>();
  const queue: string[] = [];
  for (const s of seeds) {
    if (!nodes.has(s) && nodes.size < opts.candidateCap) {
      nodes.add(s);
      queue.push(s);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (adj.has(id)) continue;
    const nb = neighborsOf(id);
    const out = new Map<string, number>();
    let sum = 0;
    const needW = new Map<string, number>();
    for (const [n, w] of nb) {
      if (w <= 0) continue;
      const mod = opts.needFor ? w * (1 + Math.log1p(Math.max(0, opts.needFor(n)))) : w;
      needW.set(n, mod);
      sum += mod;
    }
    if (sum > 0) for (const [n, w] of needW) out.set(n, w / sum);
    adj.set(id, out);
    for (const n of out.keys()) {
      if (!nodes.has(n) && nodes.size < opts.candidateCap) {
        nodes.add(n);
        queue.push(n);
      }
    }
  }

  if (nodes.size === 0) return new Map();

  // D5 Macro-Hub suppression (post-build pass): edges INTO a high-degree node
  // are scaled down so mass flows through hubs rather than pooling in them.
  if (opts.hubFloor && opts.hubFloor > 0) {
    const deg = new Map<string, number>();
    for (const [id, out] of adj) deg.set(id, out.size);
    for (const [, out] of adj) {
      for (const [n, w] of out) {
        const d = deg.get(n) ?? 0;
        if (d > opts.hubFloor) out.set(n, w / (1 + Math.log(d / opts.hubFloor)));
      }
    }
  }

  const seedSet = [...new Set(seeds)].filter((s) => nodes.has(s));
  const teleport = seedSet.length > 0 ? 1 / seedSet.length : 0;

  let p = new Map<string, number>();
  for (const s of seedSet) p.set(s, teleport);

  for (let it = 0; it < opts.iterations; it++) {
    const next = new Map<string, number>();
    for (const s of seedSet) next.set(s, (next.get(s) ?? 0) + (1 - opts.alpha) * teleport);
    for (const [id, out] of adj) {
      const val = (p.get(id) ?? 0) * opts.alpha;
      if (val <= 0) continue;
      for (const [n, w] of out) next.set(n, (next.get(n) ?? 0) + val * w);
    }
    let l1 = 0;
    for (const n of nodes) l1 += Math.abs((next.get(n) ?? 0) - (p.get(n) ?? 0));
    p = next;
    if (l1 < 1e-6) break;
  }

  let max = 0;
  for (const v of p.values()) if (v > max) max = v;
  const out = new Map<string, number>();
  for (const [k, v] of p) out.set(k, max > 0 ? v / max : 0);
  return out;
}
