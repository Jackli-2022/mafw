/**
 * event_log 旧帧迁移（Task 14，spec 2026-11-02-runtime-experience-full-migration §9.1）。
 *
 * 升级前 gateway 的 SSE egress 曾把 canonical `message.updated.properties.message`
 * 投影回旧 `properties.info` 载荷（已删除的 wire 兼容窗口）。这些帧已持久化在
 * `event_log` 里，重连客户端会经 replay 再次收到旧形状。本模块在 API/SSE
 * 开放前做**一次性幂等**存储迁移：
 *
 *   {type:'mafw_event', data:{type:'message.updated', properties:{info}}} →
 *   {type:'mafw_event', data:{type:'message.updated', properties:{message}}}
 *
 * 不变量：
 * - 只改 `message.updated` 且「有 info、无 message」的行；已 canonical /
 *   双键并存（防复活旧帧）/ 非 message 事件一律不动。
 * - 幂等：第二次运行 migrated = 0。
 * - 失败安全：先写 JSONL 备份（原始信封可还原）再改；备份失败 = 中止迁移
 *   （没有备份就不改写），异常一律不外抛——启动永不被迁移卡死。
 * - 坏 JSON 行保留原样 + warning（可人工抢救），其余行照常迁移。
 * - replay 出口不保留 info→message 兼容读取：本迁移是唯一通道。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'better-sqlite3';

export interface EventLogMigrationResult {
  /** 需要检查的候选行数（SQL 预筛：message.updated + 含 info 字样）。 */
  scanned: number;
  /** 实际改写的行数。 */
  migrated: number;
}

export interface EventLogMigrationOptions {
  /**
   * 备份目录。缺省 `~/.mafw/logs`；`null` = 不落盘备份（仅测试/无盘环境，
   * 生产接线必须保留缺省）。
   */
  backupDir?: string | null;
  /** 诊断输出（缺省静默；生产接 gateway logger）。 */
  log?: (message: string) => void;
}

/** 历史信封名：v2 起 `mafw_event`，更早的 `opencode_event` 同样兼容扫描。 */
const ENVELOPE_TYPES: ReadonlySet<string> = new Set(['mafw_event', 'opencode_event']);
const MESSAGE_UPDATED = 'message.updated';

interface CandidateRow {
  seq: number;
  ts: string;
  type: string;
  session_id: string | null;
  envelope: string;
}

interface RewriteTarget {
  properties: Record<string, unknown>;
  /** 用新 properties 重建整帧（浅拷贝，其余字段原样保留）。 */
  apply(properties: Record<string, unknown>): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 从信封（双层或扁平直发）定位 message.updated 的 properties 容器。 */
function messageUpdatedTarget(envelope: unknown): RewriteTarget | null {
  if (!isRecord(envelope)) return null;
  if (ENVELOPE_TYPES.has(envelope.type as string)) {
    const data = envelope.data;
    if (!isRecord(data) || data.type !== MESSAGE_UPDATED || !isRecord(data.properties)) return null;
    return {
      properties: data.properties,
      apply: (properties) => ({ ...envelope, data: { ...data, properties } }),
    };
  }
  if (envelope.type === MESSAGE_UPDATED && isRecord(envelope.properties)) {
    return {
      properties: envelope.properties,
      apply: (properties) => ({ ...envelope, properties }),
    };
  }
  return null;
}

/** canonical 形态：`message` 已在、或根本没有 `info`。 */
function isLegacyInfoPayload(properties: Record<string, unknown>): boolean {
  return 'info' in properties && !('message' in properties);
}

function defaultBackupDir(): string {
  return path.join(os.homedir(), '.mafw', 'logs');
}

/**
 * 写 JSONL 备份（每行 {seq, ts, type, sessionId, envelope} 原始信封）。
 * 返回备份文件路径；失败抛错由调用方 fail-safe 处理。
 */
function writeBackup(dir: string, rows: Array<CandidateRow & { nextEnvelope: string }>): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `event-log-message-migration-${stamp}.jsonl`);
  const body = rows
    .map((r) =>
      JSON.stringify({
        seq: r.seq,
        ts: r.ts,
        type: r.type,
        sessionId: r.session_id,
        // 原始信封以对象形态落盘（可直接回灌 UPDATE，便于人工还原）。
        envelope: JSON.parse(r.envelope),
      }),
    )
    .join('\n');
  fs.writeFileSync(file, body + '\n', 'utf-8');
  return file;
}

/**
 * 幂等迁移 event_log 中的旧 `message.updated.properties.info` 帧。
 * 永不抛：表缺失/读写异常 → 返回已扫描计数 + migrated 0。
 */
export function migrateEventLogInfoToMessage(
  db: Database,
  opts: EventLogMigrationOptions = {},
): EventLogMigrationResult {
  const log = opts.log ?? (() => {});
  let rows: CandidateRow[];
  try {
    rows = db
      .prepare(
        "SELECT seq, ts, type, session_id, envelope FROM event_log " +
          "WHERE envelope LIKE '%message.updated%' AND envelope LIKE '%\"info\"%' ORDER BY seq ASC",
      )
      .all() as CandidateRow[];
  } catch (err: any) {
    // 全新库（EventStore 尚未建表）或只读句柄：迁移无事可做。
    log(`[Events] event_log migration skipped: ${err?.message ?? err}`);
    return { scanned: 0, migrated: 0 };
  }

  const scanned = rows.length;
  const pending: Array<CandidateRow & { nextEnvelope: string }> = [];

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.envelope);
    } catch {
      log(`[Events] event_log row seq=${row.seq} has invalid JSON — left untouched (manual recovery required)`);
      continue;
    }
    const target = messageUpdatedTarget(parsed);
    if (!target || !isLegacyInfoPayload(target.properties)) continue;
    const properties: Record<string, unknown> = { ...target.properties, message: target.properties.info };
    delete properties.info;
    pending.push({ ...row, nextEnvelope: JSON.stringify(target.apply(properties)) });
  }

  if (pending.length === 0) return { scanned, migrated: 0 };

  if (opts.backupDir !== null) {
    const dir = opts.backupDir ?? defaultBackupDir();
    try {
      writeBackup(dir, pending);
    } catch (err: any) {
      // 失败安全：没有备份就不改写（旧帧继续可读，下次启动重试）。
      log(`[Events] event_log migration aborted: backup failed (${err?.message ?? err})`);
      return { scanned, migrated: 0 };
    }
  }

  try {
    const update = db.prepare('UPDATE event_log SET envelope = ? WHERE seq = ?');
    const run = db.transaction((list: typeof pending) => {
      for (const row of list) update.run(row.nextEnvelope, row.seq);
    });
    run(pending);
  } catch (err: any) {
    // 事务回滚：一行都不会处于半迁移状态。
    log(`[Events] event_log migration aborted: rewrite failed (${err?.message ?? err})`);
    return { scanned, migrated: 0 };
  }

  return { scanned, migrated: pending.length };
}
