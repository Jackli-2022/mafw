import { recordFeedback } from '../../src/tools/run-record-feedback';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('recordFeedback boundary', () => {
  let origCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-bd-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles empty targetId', async () => {
    const result = await recordFeedback({ targetId: '', type: 'thumbs_up', goalId: 'g1', loopNum: 1 });
    expect(result.success).toBe(true);
  });

  it('handles 16KB+ comment', async () => {
    const result = await recordFeedback({ targetId: 'wave-1', type: 'correction', comment: 'x'.repeat(17000), goalId: 'g1', loopNum: 1 });
    expect(result.success).toBe(true);
  });

  it('handles concurrent rapid writes', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) promises.push(recordFeedback({ targetId: 'w-' + i, type: 'thumbs_up', goalId: 'g1', loopNum: 1 }));
    const results = await Promise.all(promises);
    results.forEach(r => expect(r.success).toBe(true));
  });
});
