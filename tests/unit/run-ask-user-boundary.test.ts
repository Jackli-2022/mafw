import { askUser } from '../../gateway/src/core/tools/run-ask-user';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('askUser boundary', () => {
  let origCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-bd-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles empty question string', async () => {
    const result = await askUser({ question: '', goalId: 'g1', loopNum: 1, priority: 'normal' });
    expect(result.success).toBe(true);
  });

  it('handles 16KB+ question string', async () => {
    const result = await askUser({ question: 'x'.repeat(17000), goalId: 'g1', loopNum: 1, priority: 'normal' });
    expect(result.success).toBe(true);
  });

  it('handles special characters including script injection', async () => {
    const result = await askUser({ question: '<script>alert(1)</script> && ../etc/passwd', goalId: 'g1', loopNum: 1, priority: 'normal' });
    expect(result.success).toBe(true);
  });

  it('handles emoji and non-ASCII', async () => {
    const result = await askUser({ question: '你好世界 🌍 اختبار', goalId: 'g1', loopNum: 1, priority: 'normal' });
    expect(result.success).toBe(true);
  });
});
