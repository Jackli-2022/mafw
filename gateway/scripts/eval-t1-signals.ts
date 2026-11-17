/**
 * Read-only evaluation of the encode-time T1 signals against four labels.
 *
 * Run from gateway/:
 *   npx ts-node --transpile-only --project tsconfig.json scripts/eval-t1-signals.ts
 *
 * Labels (positive = the turn is "memorable"):
 *   A exact   — the turn's trace appears in an active unit's source_trace_ids
 *   B recall  — the turn's trace was retrieved at least once
 *   U union   — A ∪ B
 *   H hint    — the turn belongs to an episode referenced by episode_hint (weak)
 *   S session — the turn's session produced at least one unit (weakest)
 *
 * Metrics are stored scalars, so this never calls the embedder.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';

interface Row {
  trace_id: string;
  session_id: string;
  novelty: number | null;
  mismatch: number | null;
  surprise: number | null;
}

type Metric = 'novelty' | 'mismatch' | 'surprise';

const root = path.join(os.homedir(), '.mafw');
const db = new Database(path.join(root, 'memory', 'gateway.db'), { readonly: true });
const index = JSON.parse(
  fs.readFileSync(path.join(root, 'memory', '.harmonic_index.json'), 'utf8'),
) as { entries: any[] };

const rows = db
  .prepare('SELECT trace_id, session_id, novelty, mismatch, surprise FROM t1_turn_features WHERE novelty IS NOT NULL')
  .all() as Row[];
const scored = new Set(rows.map((row) => row.trace_id));

const exact = new Set<string>();
const hintEpisodes = new Set<string>();
const productiveSessions = new Set<string>();
for (const entry of index.entries) {
  for (const trace of entry.source_trace_ids ?? []) {
    if (scored.has(trace)) exact.add(trace);
  }
  if (entry.episode_hint?.episodeId) hintEpisodes.add(entry.episode_hint.episodeId);
  if (entry.source_session_id) productiveSessions.add(entry.source_session_id);
}

const hint = new Set<string>();
for (const episodeId of hintEpisodes) {
  const members = db
    .prepare('SELECT trace_id FROM t1_episode_members WHERE episode_id = ?')
    .all(episodeId) as Array<{ trace_id: string }>;
  for (const member of members) if (scored.has(member.trace_id)) hint.add(member.trace_id);
}

const recalled = new Set(
  (
    db
      .prepare("SELECT DISTINCT trace_id FROM t1_retrieval_events WHERE trace_id IS NOT NULL")
      .all() as Array<{ trace_id: string }>
  )
    .map((row) => row.trace_id)
    .filter((trace) => scored.has(trace)),
);

const union = new Set([...exact, ...recalled]);
const session = new Set(
  rows.filter((row) => productiveSessions.has(row.session_id)).map((row) => row.trace_id),
);

const labels: Array<{ name: string; positives: Set<string>; weak: boolean }> = [
  { name: 'A exact', positives: exact, weak: false },
  { name: 'B recall', positives: recalled, weak: false },
  { name: 'U union', positives: union, weak: false },
  { name: 'H hint', positives: hint, weak: true },
  { name: 'S session', positives: session, weak: true },
];

function auc(label: Set<string>, metric: Metric): { pos: number; neg: number; auc: number | null } {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const row of rows) {
    const value = row[metric];
    if (value == null) continue;
    (label.has(row.trace_id) ? pos : neg).push(value);
  }
  if (pos.length === 0 || neg.length === 0) return { pos: pos.length, neg: neg.length, auc: null };
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return { pos: pos.length, neg: neg.length, auc: +(wins / (pos.length * neg.length)).toFixed(3) };
}

const table = labels.map((label) => ({
  label: label.name,
  weak: label.weak,
  positives: label.positives.size,
  novelty: auc(label.positives, 'novelty'),
  mismatch: auc(label.positives, 'mismatch'),
  surprise: auc(label.positives, 'surprise'),
}));

console.log(JSON.stringify({ scored: rows.length, labels: table }, null, 2));
console.log(
  '\n| label | positives | novelty | mismatch | surprise |\n|---|---|---|---|---|',
);
for (const row of table) {
  const cell = (value: { pos: number; auc: number | null }) =>
    value.auc == null ? 'n/a' : `${value.auc} (${value.pos})`;
  console.log(
    `| ${row.label}${row.weak ? ' (weak)' : ''} | ${row.positives} | ${cell(row.novelty)} | ${cell(row.mismatch)} | ${cell(row.surprise)} |`,
  );
}

db.close();
