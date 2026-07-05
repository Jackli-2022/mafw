import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { RecoveryManager } from '../../gateway/src/recovery';

describe('RecoveryManager boundary', () => {
  let tmpDir: string;
  let manager: RecoveryManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-bd-'));
    manager = new RecoveryManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('findLastCheckpoint returns null for non-existent goal', () => {
    expect(manager.findLastCheckpoint('nonexistent')).toBeNull();
  });

  it('restoreLoop returns false for non-existent goal', async () => {
    const ok = await manager.restoreLoop('nonexistent', 1);
    expect(ok).toBe(false);
  });

  it('handles corrupted checkpoint JSON', () => {
    const dir = path.join(tmpDir, '.opencode/mafw/checkpoints', 'g1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'loop-1.json'), 'not json', 'utf-8');
    const found = manager.findLastCheckpoint('g1');
    expect(found).not.toBeNull();
    // loadCheckpoint throws on invalid JSON
    expect(() => manager.loadCheckpoint(found!)).toThrow();
  });

  it('handles concurrent saveCheckpoint calls', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) promises.push(Promise.resolve(manager.saveCheckpoint('g1', 1, { data: i }, i)));
    await Promise.all(promises);
    expect(manager.findLastCheckpoint('g1')).not.toBeNull();
  });
});
