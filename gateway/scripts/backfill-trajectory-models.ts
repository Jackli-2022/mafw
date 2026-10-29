/**
 * One-off backfill: `trajectory_turns.model/provider` 为 NULL 的历史行。
 *
 * 背景（2026-10-29）：TrajectoryCollector 曾只读 v1 形状 `info.modelID/providerID`；
 * opencode 部分事件使用 `info.model = { id, providerID }`，导致新回合 model/provider
 * 写入 NULL，而 `/api/usage` 的「按模型」统计有 `WHERE model IS NOT NULL`，这些回合
 * 被排除 → 按模型命中率与项目/会话总计不一致。
 *
 * 回填来源（按优先级）：
 *   1. `session_message`（v2）中同 session 的 assistant 消息：`data.model = {id, providerID}`，
 *      取 `time_created >= turn_start_ms` 的最早一条；
 *   2. `session_v2.model`（会话级模型）；
 *   3. 旧版 `message` 表（v1 顶层 modelID/providerID）。
 *
 * 用法（gateway 运行中也可，只改 SQLite）：
 *   cd gateway && npx ts-node --project tsconfig.json scripts/backfill-trajectory-models.ts            # dry-run
 *   cd gateway && npx ts-node --project tsconfig.json scripts/backfill-trajectory-models.ts --apply    # apply
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';

const APPLY = process.argv.includes('--apply');
const opencodeDbPath = path.join(os.homedir(), '.local/share/opencode/opencode.db');
const gatewayDbPath = path.join(os.homedir(), '.mafw/memory/gateway.db');

interface ModelRef {
  modelID: string;
  providerID: string | null;
}
interface AssistantMsg extends ModelRef {
  time: number;
}

function parseModel(value: any): ModelRef | null {
  if (!value) return null;
  let m = value;
  if (typeof value === 'string') {
    try {
      m = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const modelID = m?.modelID ?? m?.id ?? m?.model?.id ?? m?.model?.modelID;
  if (!modelID) return null;
  const providerID = m?.providerID ?? m?.provider ?? m?.model?.providerID ?? m?.model?.provider ?? null;
  return { modelID: String(modelID), providerID: providerID ? String(providerID) : null };
}

function main(): void {
  const gw = new Database(gatewayDbPath);
  const oc = new Database(opencodeDbPath, { readonly: true });

  const nullRows = gw
    .prepare(
      `SELECT rowid, session_id, turn_id, turn_start_ms, turn_end_ms
       FROM trajectory_turns WHERE model IS NULL`,
    )
    .all() as Array<{ rowid: number; session_id: string; turn_id: number; turn_start_ms: number; turn_end_ms: number | null }>;
  console.log(`[backfill] NULL-model turns: ${nullRows.length}${APPLY ? '' : ' (dry-run)'}`);
  if (nullRows.length === 0) return;

  const sessions = [...new Set(nullRows.map((r) => r.session_id))];
  const ph = sessions.map(() => '?').join(',');

  const bySession = new Map<string, AssistantMsg[]>();
  const push = (sid: string, msg: AssistantMsg) => {
    const list = bySession.get(sid) ?? [];
    list.push(msg);
    bySession.set(sid, list);
  };

  // 1) v2 session_message assistant
  const v2Rows = oc
    .prepare(`SELECT session_id, time_created, data FROM session_message WHERE session_id IN (${ph}) AND type = 'assistant'`)
    .all(...sessions) as Array<{ session_id: string; time_created: number; data: string }>;
  for (const row of v2Rows) {
    let data: any;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    const m = parseModel(data?.model);
    if (!m) continue;
    const time = Number(data?.time?.created ?? row.time_created ?? 0);
    push(row.session_id, { time, ...m });
  }

  // 2) legacy message table (v1)
  const v1Rows = oc
    .prepare(`SELECT session_id, time_created, data FROM message WHERE session_id IN (${ph})`)
    .all(...sessions) as Array<{ session_id: string; time_created: number; data: string }>;
  for (const row of v1Rows) {
    let data: any;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (data?.role !== 'assistant') continue;
    const m = parseModel(data);
    if (!m) continue;
    const time = Number(data?.time?.created ?? row.time_created ?? 0);
    push(row.session_id, { time, ...m });
  }

  for (const list of bySession.values()) list.sort((a, b) => a.time - b.time);

  // 3) session-level model fallback
  const sessionModel = new Map<string, ModelRef>();
  const v2Sessions = oc.prepare(`SELECT id, model FROM session_v2 WHERE id IN (${ph})`).all(...sessions) as Array<{ id: string; model: any }>;
  for (const s of v2Sessions) {
    const m = parseModel(s.model);
    if (m) sessionModel.set(s.id, m);
  }

  const update = gw.prepare(`UPDATE trajectory_turns SET model = ?, provider = ? WHERE rowid = ?`);
  let filled = 0;
  let missing = 0;
  const summary = new Map<string, number>();

  gw.transaction(() => {
    for (const turn of nullRows) {
      const list = bySession.get(turn.session_id) ?? [];
      const start = Number(turn.turn_start_ms) || 0;
      const after = list.find((m) => m.time >= start);
      const pick = after ?? list[list.length - 1] ?? sessionModel.get(turn.session_id);
      if (!pick) {
        missing++;
        continue;
      }
      if (APPLY) update.run(pick.modelID, pick.providerID, turn.rowid);
      filled++;
      summary.set(pick.modelID, (summary.get(pick.modelID) ?? 0) + 1);
    }
  })();

  console.log(`[backfill] matched: ${filled}, no-model-source: ${missing}`);
  for (const [model, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model}: ${n}`);
  }
  console.log(APPLY ? '[backfill] applied' : '[backfill] dry-run only (pass --apply)');
}

main();
