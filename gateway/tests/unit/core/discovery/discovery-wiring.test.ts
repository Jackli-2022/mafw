import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('discovery wiring', () => {
  it('broadcasts command changes, runtime switches, and forgets deleted sessions', () => {
    const index = read('../../../../src/index.ts');
    expect(index).toContain("broadcastKnown('commands_changed')");
    expect(index).toContain("broadcastKnown('runtime_switched')");
    expect(index).toContain('discovery?.forget(sessionID)');
    expect(index).toContain('this.broadcast(mafwBroadcast(e as any))');
  });
});
