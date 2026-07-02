import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { RecoveryManager } from '../../gateway/src/recovery';

describe('RecoveryManager', () => {
  let tmpDir: string;
  let manager: RecoveryManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-test-'));
    manager = new RecoveryManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and finds a loop-level checkpoint', () => {
    manager.saveCheckpoint('goal-001', 1, { phase: 'EXECUTING' });
    const found = manager.findLastCheckpoint('goal-001');
    expect(found).not.toBeNull();
  });

  it('saves and loads a wave-level checkpoint', () => {
    manager.saveCheckpoint('goal-001', 1, { phase: 'EXECUTING', wave: 2 }, 2);
    const found = manager.findLastCheckpoint('goal-001');
    expect(found).not.toBeNull();
  });

  it('loads a checkpoint correctly', () => {
    manager.saveCheckpoint('goal-001', 1, { phase: 'PLANNING', data: 'test' });
    const cp = manager.findLastCheckpoint('goal-001');
    const loaded = manager.loadCheckpoint(cp!);
    expect(loaded.phase).toBe('PLANNING');
    expect(loaded.data).toBe('test');
  });

  it('restoreLoop returns false if no checkpoint exists', async () => {
    const ok = await manager.restoreLoop('nonexistent', 1);
    expect(ok).toBe(false);
  });

  it('restoreLoop restores state file from checkpoint', async () => {
    const mafwDir = path.join(tmpDir, '.opencode/mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'checkpoints', 'goal-001'), { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'state', 'goal-001.json'),
      JSON.stringify({ version: 1, phase: 'ERROR', currentWave: 3 }, null, 2)
    );
    fs.writeFileSync(
      path.join(mafwDir, 'checkpoints', 'goal-001', 'wave-1-2.json'),
      JSON.stringify({ goalId: 'goal-001', loop: 1, wave: 2, phase: 'EXECUTING' }, null, 2)
    );

    const ok = await manager.restoreLoop('goal-001', 1, 2);
    expect(ok).toBe(true);

    const restored = JSON.parse(fs.readFileSync(
      path.join(mafwDir, 'state', 'goal-001.json'), 'utf-8'
    ));
    expect(restored.phase).toBe('EXECUTING');
    expect(restored.currentWave).toBe(2);
  });
});
