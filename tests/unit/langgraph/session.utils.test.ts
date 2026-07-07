import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { waitForFile } from '../../../src/langgraph/nodes/session.utils';

describe('waitForFile', () => {
  it('resolves when file appears within timeout', async () => {
    const tmp = path.join(os.tmpdir(), `test-waitforfile-${Date.now()}`);
    setTimeout(() => fs.writeFileSync(tmp, 'ok'), 50);
    const result = await waitForFile(tmp, 1000);
    expect(result).toBe(true);
    fs.unlinkSync(tmp);
  });

  it('returns false when file does not appear within timeout', async () => {
    const result = await waitForFile('/nonexistent-file-XXXX.json', 100);
    expect(result).toBe(false);
  });
});
