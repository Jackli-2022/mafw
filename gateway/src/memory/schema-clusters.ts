// S2: embedding schema clusters. Existing semantic memories are grouped into
// low-overlap clusters (cortical schemas); at replay time the turn pipeline
// shows the worker the cluster representative so it integrates new information
// into the schema (UPDATE) rather than appending a new fragment.
export interface Cluster {
  id: string;
  centroid: number[];
  members: string[];
  /** Id of the highest energy×salience member (the schema representative). */
  representative?: string;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/**
 * Nearest cluster above `theta`, else a new cluster id derived from the unit id.
 * Pure decision (centroid updates are the caller's responsibility).
 */
export function assignCluster(
  id: string,
  vector: number[],
  clusters: Cluster[],
  theta: number,
): { clusterId: string; isNew: boolean } {
  let best: Cluster | null = null;
  let bestSim = -1;
  for (const c of clusters) {
    const s = cosine(vector, c.centroid);
    if (s > bestSim) {
      bestSim = s;
      best = c;
    }
  }
  if (best && bestSim >= theta) return { clusterId: best.id, isNew: false };
  return { clusterId: `c_${id}`, isNew: true };
}

/** Top-n clusters by cosine to the query vector (descending). */
export function topClusters(queryVec: number[], clusters: Cluster[], n: number): Cluster[] {
  return [...clusters]
    .map((c) => ({ c, s: cosine(queryVec, c.centroid) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.c);
}
