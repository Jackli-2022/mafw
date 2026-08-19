import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { OptimisticStateSync } from '../../gateway/src/core/engine/optimistic-sync';

describe('OptimisticStateSync', () => {
  let tmpDir: string;
  let sync: OptimisticStateSync;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-sync-'));
    sync = new OptimisticStateSync(tmpDir);
    const mafwDir = path.join(tmpDir, '.mafw', 'state');
    fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'goal-001.json'),
      JSON.stringify({ version: 1, phase: 'PLANNING', goalId: 'goal-001' }, null, 2)
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads initial version', async () => {
    const v = await sync.readCurrentVersion('goal-001');
    expect(v).toBe(1);
  });

  it('updates state with correct version', async () => {
    const ok = await sync.updateState('goal-001', { phase: 'EXECUTING' }, 1);
    expect(ok).toBe(true);
    const v = await sync.readCurrentVersion('goal-001');
    expect(v).toBe(2);
  });

  it('fails update with wrong version', async () => {
    const ok = await sync.updateState('goal-001', { phase: 'EXECUTING' }, 99);
    expect(ok).toBe(false);
  });

  it('maintains causal context events', async () => {
    await sync.updateState('goal-001', { phase: 'EXECUTING' }, 1, 'execute');
    await sync.updateState('goal-001', { phase: 'REVIEWING' }, 2, 'gateway');

    const context = sync.getCausalContext('goal-001');
    expect(context.version).toBe(3);
    expect(context.events).toHaveLength(2);
    expect(context.events[0].agent).toBe('execute');
    expect(context.events[1].agent).toBe('gateway');
  });

  it('limits events to maxEvents', async () => {
    sync = new OptimisticStateSync(tmpDir, 3);
    await sync.updateState('goal-001', { phase: 'A' }, 1, 'a1');
    await sync.updateState('goal-001', { phase: 'B' }, 2, 'b2');
    await sync.updateState('goal-001', { phase: 'C' }, 3, 'c3');
    await sync.updateState('goal-001', { phase: 'D' }, 4, 'd4');
    const context = sync.getCausalContext('goal-001');
    expect(context.events).toHaveLength(3);
    expect(context.events[0].agent).toBe('b2');
  });
});
