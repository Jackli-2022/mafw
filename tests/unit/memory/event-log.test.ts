import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventLog } from '../../../gateway/src/memory/event-log';

describe('EventLog', () => {
  let tmpDir: string;
  let log: EventLog;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'el-'));
    log = new EventLog(tmpDir);
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('appendWrite and readAll', () => {
    log.appendWrite('mem_001', { primary: 'test', anchors: ['a'], terms: ['b'] });
    const all = log.readAll();
    expect(all.length).toBe(1);
    expect(all[0].op).toBe('write');
    expect(all[0].id).toBe('mem_001');
  });

  test('appendMiss stores cause', () => {
    log.appendMiss('payment timeout', 'anchor_poor');
    const all = log.readAll();
    expect(all[0].miss_cause).toBe('anchor_poor');
  });

  test('appendArchive', () => {
    log.appendArchive('mem_001');
    const all = log.readAll();
    expect(all[0].op).toBe('archive');
  });

  test('tolerates corrupt lines', () => {
    const dir = path.join(tmpDir, 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.memory-events.log'), 'not json\n{"op":"write","id":"m1"}\n', 'utf-8');
    const all = log.readAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('m1');
  });
});
