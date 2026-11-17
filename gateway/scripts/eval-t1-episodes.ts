/**
 * Episode-level evaluation of the T1 signals (aligned with the batch write
 * granularity of reflection).
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/eval-t1-episodes.ts
 *
 * Positive = the episode is referenced by an active unit, either through the
 * exact `episode_id` or through a `source_trace_ids` member.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

interface EpisodeRow {
  episode_id: string;
  session_id: string;
  turns: number;
  nov_mean: number | null;
  nov_max: number | null;
  mis_mean: number | null;
  mis_max: number | null;
  sur_mean: number | null;
  sur_max: number | null;
  text_len: number;
}

const root = path.join(os.homedir(), '.mafw');
const db = new Database(path.join(root, 'memory', 'gateway.db'), { readonly: true });
const index = JSON.parse(
  fs.readFileSync(path.join(root, 'memory', '.harmonic_index.json'), 'utf8'),
) as { entries: any[] };

const episodes = db
  .prepare(
    `SELECT m.episode_id,
            MAX(e.session_id) AS session_id,
            COUNT(*) AS turns,
            AVG(f.novelty) AS nov_mean,
            MAX(f.novelty) AS nov_max,
            AVG(f.mismatch) AS mis_mean,
            MAX(f.mismatch) AS mis_max,
            AVG(f.surprise) AS sur_mean,
            MAX(f.surprise) AS sur_max,
            SUM(COALESCE(o.len, 0) + COALESCE(a.len, 0)) AS text_len
       FROM t1_episode_members m
       JOIN t1_turn_features f ON f.trace_id = m.trace_id
       LEFT JOIN t1_episodes e ON e.episode_id = m.episode_id
       LEFT JOIN (SELECT trace_id, SUM(length(content)) len FROM t1_observations GROUP BY trace_id) o
              ON o.trace_id = m.trace_id
       LEFT JOIN (SELECT trace_id, SUM(length(content)) len FROM t1_archive GROUP BY trace_id) a
              ON a.trace_id = m.trace_id
      GROUP BY m.episode_id`,
  )
  .all() as EpisodeRow[];

const byId = new Map(episodes.map((row) => [row.episode_id, row]));
const traceToEpisode = new Map<string, string>();
for (const row of db
  .prepare('SELECT episode_id, trace_id FROM t1_episode_members')
  .all() as Array<{ episode_id: string; trace_id: string }>) {
  traceToEpisode.set(row.trace_id, row.episode_id);
}

const positive = new Set<string>();
let viaEpisodeId = 0;
let viaTrace = 0;
for (const entry of index.entries) {
  if (entry.superseded_by) continue;
  if (entry.episode_id && byId.has(entry.episode_id)) {
    positive.add(entry.episode_id);
    viaEpisodeId++;
  }
  for (const trace of entry.source_trace_ids ?? []) {
    const episodeId = traceToEpisode.get(trace);
    if (episodeId && byId.has(episodeId)) {
      positive.add(episodeId);
      viaTrace++;
    }
  }
}

const auc = (score: (row: EpisodeRow) => number | null): { pos: number; neg: number; auc: number | null } => {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const row of episodes) {
    const value = score(row);
    if (value == null || !Number.isFinite(value)) continue;
    (positive.has(row.episode_id) ? pos : neg).push(value);
  }
  if (pos.length === 0 || neg.length === 0) return { pos: pos.length, neg: neg.length, auc: null };
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return { pos: pos.length, neg: neg.length, auc: +(wins / (pos.length * neg.length)).toFixed(3) };
};

const metrics: Array<[string, (row: EpisodeRow) => number | null]> = [
  ['turns', (row) => row.turns],
  ['text_len', (row) => row.text_len],
  ['novelty mean', (row) => row.nov_mean],
  ['novelty max', (row) => row.nov_max],
  ['mismatch mean', (row) => row.mis_mean],
  ['mismatch max', (row) => row.mis_max],
  ['surprise mean', (row) => row.sur_mean],
  ['surprise max', (row) => row.sur_max],
];

const table = metrics.map(([name, score]) => ({ metric: name, ...auc(score) }));

// Within-session: remove the "which session" confound.
const sessions = new Map<string, EpisodeRow[]>();
for (const row of episodes) {
  const list = sessions.get(row.session_id) ?? [];
  list.push(row);
  sessions.set(row.session_id, list);
}
const mixed = [...sessions.values()].filter(
  (list) =>
    list.some((row) => positive.has(row.episode_id)) &&
    list.some((row) => !positive.has(row.episode_id)),
);
const within = (score: (row: EpisodeRow) => number | null): number | null => {
  let wins = 0;
  let total = 0;
  for (const list of mixed) {
    for (const a of list.filter((row) => positive.has(row.episode_id))) {
      for (const b of list.filter((row) => !positive.has(row.episode_id))) {
        const av = score(a);
        const bv = score(b);
        if (av == null || bv == null) continue;
        total++;
        wins += av > bv ? 1 : av === bv ? 0.5 : 0;
      }
    }
  }
  return total > 0 ? +(wins / total).toFixed(3) : null;
};

console.log(
  JSON.stringify(
    {
      episodes: episodes.length,
      positives: positive.size,
      positiveViaEpisodeId: viaEpisodeId,
      positiveViaTrace: viaTrace,
      mixedSessions: mixed.length,
      table,
      withinSession: Object.fromEntries(metrics.map(([name, score]) => [name, within(score)])),
    },
    null,
    2,
  ),
);

console.log('\n| metric | positives | negatives | AUC | within-session |');
console.log('|---|---|---|---|---|');
for (const row of table) {
  console.log(
    `| ${row.metric} | ${row.pos} | ${row.neg} | ${row.auc ?? 'n/a'} | ${within(metrics.find(([name]) => name === row.metric)![1]) ?? 'n/a'} |`,
  );
}

db.close();
