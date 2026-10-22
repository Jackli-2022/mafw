/**
 * EventStore — 持久事件日志（spec：docs/superpowers/specs/2026-10-22-persistent-event-replay-design.md §5.1）。
 *
 * Mode A 全局事件流的持久层：broadcast 单点同步 append 分配单调 seq，
 * SSE `id:` 字段 + Last-Event-ID/?since 断点续传的回放源。
 *
 * 关键正确性细节：
 * - AUTOINCREMENT 必须显式——普通 rowid 表在全删后从 1 重用 seq，与客户端
 *   陈旧 lastEventId 碰撞会静默漏帧（spec §7 裁决 3）。
 * - part.delta 不入库不占 seq——seq 空间只由持久事件消耗，连续无跳号是
 *   firstReplayedSeq 截断检测的可靠性前提（spec §7 裁决 10）。
 * - 全路径 fail-open：append/prune 异常吞掉返回 null（C5）——启动与广播
 *   永不被事件日志阻塞。
 */
import type { Database } from 'better-sqlite3';

/** 不入库也不消耗 seq 的事件类型（可从快照重建的高频流；spec v2 Q3）。 */
export const NON_PERSISTED_EVENT_TYPES: ReadonlySet<string> = new Set(['part.delta']);

export interface StoredEnvelope {
  seq: number;
  ts: string;
  type: string;
  sessionId: string | null;
  envelope: unknown;
}

export class EventStore {
  private appendCount = 0;

  constructor(private db: Database) {
    // AUTOINCREMENT：跨 DELETE 单调（prune 后 seq 不重用）
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        session_id TEXT,
        envelope TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_log_session ON event_log(session_id, seq);
    `);
  }

  /** 同步插入，返回分配的 seq；非持久类型或异常 → null（fail-open）。 */
  append(envelope: { type: string; [k: string]: any }): number | null {
    if (NON_PERSISTED_EVENT_TYPES.has(envelope.type)) return null;
    try {
      const row = this.db
        .prepare('INSERT INTO event_log (ts, type, session_id, envelope) VALUES (?, ?, ?, ?) RETURNING seq')
        .get(
          new Date().toISOString(),
          String(envelope.type),
          typeof envelope.sessionID === 'string' ? envelope.sessionID : null,
          JSON.stringify(envelope),
        ) as { seq: number } | undefined;
      this.appendCount++;
      return row?.seq ?? null;
    } catch {
      return null;
    }
  }

  /** 当前最大 seq（空表 0；异常 fail-open 0）。 */
  headSeq(): number {
    try {
      const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS h FROM event_log').get() as { h: number };
      return row.h;
    } catch {
      return 0;
    }
  }

  /** newest-window 回放（spec §7 裁决 8）：范围 (since, headSeq] 内最新 limit 行升序返回。
   *  回放尾行恒 = headSeq（与直播无缝）；洞在起点一侧，由 firstReplayedSeq 显式暴露。 */
  replaySince(since: number, limit: number): { rows: StoredEnvelope[]; firstReplayedSeq: number | null } {
    try {
      const raw = this.db
        .prepare('SELECT seq, ts, type, session_id, envelope FROM event_log WHERE seq > ? ORDER BY seq DESC LIMIT ?')
        .all(since, limit) as Array<{ seq: number; ts: string; type: string; session_id: string | null; envelope: string }>;
      const rows = raw.reverse().map(r => ({
        seq: r.seq,
        ts: r.ts,
        type: r.type,
        sessionId: r.session_id,
        envelope: JSON.parse(r.envelope),
      }));
      return { rows, firstReplayedSeq: rows.length > 0 ? rows[0].seq : null };
    } catch {
      return { rows: [], firstReplayedSeq: null };
    }
  }

  /** 摊销裁剪：每 everyN 次 append 检查一次，保留最新 retention 行。异常吞掉（C5）。 */
  maybePrune(retention: number, everyN = 1000): void {
    if (this.appendCount < everyN) return;
    this.appendCount = 0;
    try {
      this.db
        .prepare('DELETE FROM event_log WHERE seq <= (SELECT COALESCE(MAX(seq), 0) FROM event_log) - ?')
        .run(retention);
    } catch {
      /* fail-open */
    }
  }
}
