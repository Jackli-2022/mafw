import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('instruction sync wiring', () => {
  it('DELETE /api/session/:id forgets the per-session sync state', () => {
    // Phase D1 Task D1: the branch migrated verbatim into routes/sessions-core.ts.
    const route = read('../../../../src/routes/sessions-core.ts');
    const at = route.lastIndexOf('await deps.sdkSession().delete(sessionID);');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(route.slice(at, at + 300)).toContain('deps.instructionSync()?.forget(sessionID);');
  });
});
