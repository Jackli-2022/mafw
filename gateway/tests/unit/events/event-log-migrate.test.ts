// Task 14：event_log 旧帧一次性迁移（message.updated.properties.info →
// properties.message）。
//
// 迁移契约（spec 2026-11-02-runtime-experience-full-migration §9.1）：
// - 幂等：第二次运行 migrated = 0；
// - 只改 message.updated 且「有 info、无 message」的行；
// - 坏 JSON 保留原行 + warning，不阻断启动；
// - 备份失败 = fail-safe 中止（没有备份就不改写）；
// - replay 出口不保留 info→message 兼容读取（迁移是唯一通道）。
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventStore } from '../../../src/events/event-store';
import { migrateEventLogInfoToMessage } from '../../../src/events/event-log-migrate';

function makeDb() {
  const db = new Database(':memory:');
  const store = new EventStore(db); // 建表（生产同款时序：EventStore → migration）
  return { db, store };
}

function envelopeOf(db: Database.Database, seq: number): any {
  const row = db.prepare('SELECT envelope FROM event_log WHERE seq = ?').get(seq) as { envelope: string };
  return JSON.parse(row.envelope);
}

function insertRaw(db: Database.Database, envelope: string, type = 'mafw_event'): number {
  const row = db
    .prepare('INSERT INTO event_log (ts, type, session_id, envelope) VALUES (?, ?, ?, ?) RETURNING seq')
    .get('2026-11-01T00:00:00.000Z', type, 's1', envelope) as { seq: number };
  return row.seq;
}

describe('migrateEventLogInfoToMessage（Task 14：event_log 旧帧迁移）', () => {
  it('重写 legacy properties.info → properties.message（信封形状与 seq 不变）', () => {
    const { db, store } = makeDb();
    const legacy = store.append({
      type: 'mafw_event',
      data: {
        type: 'message.updated',
        properties: { sessionID: 's1', info: { id: 'm1', role: 'user' } },
        sessionID: 's1',
      },
    })!;

    const res = migrateEventLogInfoToMessage(db, { backupDir: null });

    expect(res).toEqual({ scanned: 1, migrated: 1 });
    const env = envelopeOf(db, legacy);
    expect(env.type).toBe('mafw_event');
    expect(env.data.type).toBe('message.updated');
    expect(env.data.properties.message).toEqual({ id: 'm1', role: 'user' });
    expect('info' in env.data.properties).toBe(false);
    expect(env.data.properties.sessionID).toBe('s1'); // 其余载荷字段原样保留
  });

  it('幂等：第二次运行 migrated = 0（不重复改写、不重复备份）', () => {
    const { db, store } = makeDb();
    const dir = mkdtempSync(join(tmpdir(), 'mafw-eventlog-'));
    try {
      store.append({ type: 'mafw_event', data: { type: 'message.updated', properties: { info: { id: 'a' } } } });
      store.append({ type: 'mafw_event', data: { type: 'message.updated', properties: { info: { id: 'b' } } } });

      const first = migrateEventLogInfoToMessage(db, { backupDir: dir });
      expect(first.migrated).toBe(2);
      expect(readdirSync(dir)).toHaveLength(1);

      const second = migrateEventLogInfoToMessage(db, { backupDir: dir });
      expect(second.migrated).toBe(0);
      expect(readdirSync(dir)).toHaveLength(1); // 无候选 → 不产生第二个备份
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('已 canonical（有 message）与非 message.updated 行一律不动', () => {
    const { db, store } = makeDb();
    const canonical = store.append({
      type: 'mafw_event',
      data: { type: 'message.updated', properties: { message: { id: 'm1', role: 'user' } } },
    })!;
    const sessionCreated = store.append({
      type: 'mafw_event',
      data: { type: 'session.created', properties: { info: { id: 's1', title: 't' } } },
    })!;

    const res = migrateEventLogInfoToMessage(db, { backupDir: null });

    expect(res.migrated).toBe(0);
    expect(envelopeOf(db, canonical).data.properties).toEqual({ message: { id: 'm1', role: 'user' } });
    expect(envelopeOf(db, sessionCreated).data.properties.info).toEqual({ id: 's1', title: 't' });
  });

  it('同时带 info 与 message 的行不改写（以 message 为准，防复活旧帧）', () => {
    const { db, store } = makeDb();
    const seq = store.append({
      type: 'mafw_event',
      data: { type: 'message.updated', properties: { info: { id: 'old' }, message: { id: 'new' } } },
    })!;

    expect(migrateEventLogInfoToMessage(db, { backupDir: null }).migrated).toBe(0);
    expect(envelopeOf(db, seq).data.properties.info).toEqual({ id: 'old' });
  });

  it('扁平直发（type=message.updated 无 data 信封）的行同样迁移', () => {
    const { db } = makeDb();
    const seq = insertRaw(db, JSON.stringify({ type: 'message.updated', properties: { info: { id: 'flat1' } } }), 'message.updated');

    expect(migrateEventLogInfoToMessage(db, { backupDir: null }).migrated).toBe(1);
    const env = envelopeOf(db, seq);
    expect(env.type).toBe('message.updated');
    expect(env.properties.message).toEqual({ id: 'flat1' });
    expect('info' in env.properties).toBe(false);
  });

  it('坏 JSON 行保留 + warning，其他行照常迁移（不阻断启动）', () => {
    const { db, store } = makeDb();
    const bad = insertRaw(
      db,
      '{"type":"mafw_event","data":{"type":"message.updated","properties":{"info":',
    );
    const good = store.append({
      type: 'mafw_event',
      data: { type: 'message.updated', properties: { info: { id: 'ok' } } },
    })!;
    const warnings: string[] = [];

    const res = migrateEventLogInfoToMessage(db, {
      backupDir: null,
      log: (m) => warnings.push(m),
    });

    expect(res.migrated).toBe(1);
    expect(warnings.some((w) => w.includes('invalid JSON') && w.includes(String(bad)))).toBe(true);
    // 坏行原样保留（可人工抢救），好行已迁移
    const badRow = db.prepare('SELECT envelope FROM event_log WHERE seq = ?').get(bad) as { envelope: string };
    expect(badRow.envelope).toBe('{"type":"mafw_event","data":{"type":"message.updated","properties":{"info":');
    expect(envelopeOf(db, good).data.properties.message).toEqual({ id: 'ok' });
  });

  it('改写前写 JSONL 备份（原始信封可还原）', () => {
    const { db, store } = makeDb();
    const dir = mkdtempSync(join(tmpdir(), 'mafw-eventlog-'));
    try {
      store.append({
        type: 'mafw_event',
        data: { type: 'message.updated', properties: { info: { id: 'bak1', role: 'assistant' } } },
      });

      expect(migrateEventLogInfoToMessage(db, { backupDir: dir }).migrated).toBe(1);

      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0].seq).toBe(1);
      expect(lines[0].envelope.data.properties.info).toEqual({ id: 'bak1', role: 'assistant' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('备份失败 = fail-safe 中止：不改写任何行（scanned 仍报告）', () => {
    const { db, store } = makeDb();
    const seq = store.append({
      type: 'mafw_event',
      data: { type: 'message.updated', properties: { info: { id: 'keep' } } },
    })!;
    const dir = mkdtempSync(join(tmpdir(), 'mafw-eventlog-'));
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x');
    const warnings: string[] = [];
    try {
      const res = migrateEventLogInfoToMessage(db, { backupDir: filePath, log: (m) => warnings.push(m) });
      expect(res.scanned).toBe(1);
      expect(res.migrated).toBe(0);
      expect(warnings.some((w) => w.includes('backup'))).toBe(true);
      expect(envelopeOf(db, seq).data.properties.info).toEqual({ id: 'keep' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('event_log 表不存在（全新库）= 静默跳过，永不抛', () => {
    const db = new Database(':memory:');
    expect(migrateEventLogInfoToMessage(db, { backupDir: null })).toEqual({ scanned: 0, migrated: 0 });
  });
});

// 接线守卫：迁移必须在 API/SSE 开放前执行（spec §9.1「在 replay 服务开放前完成」）。
describe('index.ts wiring（迁移先于 API/SSE ready）', () => {
  const idxSrc = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

  it('getGatewayDb 构造 EventStore 后调用迁移', () => {
    expect(idxSrc).toContain('migrateEventLogInfoToMessage(');
    const storeIdx = idxSrc.indexOf('this.eventStore = new EventStore(');
    const migrateIdx = idxSrc.indexOf('migrateEventLogInfoToMessage(');
    expect(storeIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeGreaterThan(storeIdx);
  });

  it('迁移调用出现在 startApiServer 之前', () => {
    const migrateIdx = idxSrc.indexOf('migrateEventLogInfoToMessage(');
    const apiIdx = idxSrc.indexOf('await this.startApiServer()');
    expect(apiIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeLessThan(apiIdx);
  });
});
