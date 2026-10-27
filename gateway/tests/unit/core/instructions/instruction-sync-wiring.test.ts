import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('instruction sync wiring', () => {
  it('DELETE /api/session/:id forgets the per-session sync state', () => {
    const index = read('../../../../src/index.ts');
    const at = index.indexOf('await this.sdkSession.delete(sessionID);');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(index.slice(at, at + 300)).toContain('this.instructionSync?.forget(sessionID);');
  });
});
