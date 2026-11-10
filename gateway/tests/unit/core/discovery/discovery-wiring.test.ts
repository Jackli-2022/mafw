import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('discovery wiring', () => {
  it('broadcasts command changes, runtime switches, and forgets deleted sessions', () => {
    // D3 Task 8: 组合根（class MafwScheduler）在 kernel.ts。
    const index = read('../../../../src/kernel.ts');
    expect(index).toContain("broadcastKnown('commands_changed')");
    expect(index).toContain("broadcastKnown('runtime_switched')");
    // Phase D1 Task D1: DELETE /api/session/:id migrated into routes/sessions-core.ts.
    expect(read('../../../../src/routes/sessions-core.ts')).toContain('discovery()?.forget(sessionID)');
    expect(index).toContain('this.broadcast(mafwBroadcast(e as any))');
  });
});
