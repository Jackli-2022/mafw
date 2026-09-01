import * as fs from 'fs';
import * as path from 'path';
import { log } from '../../src/core/utils/logger';

// Jest setupFiles points MAFW_LOG_DIR at a per-file temp dir — production
// ~/.mafw/logs/mafw.log must never receive test output.
describe('test log isolation', () => {
  it('writes logs into MAFW_LOG_DIR instead of the production log dir', () => {
    const dir = process.env.MAFW_LOG_DIR!;
    expect(dir).toBeTruthy();
    expect(dir).not.toContain(path.join('.mafw', 'logs'));
    log.info('logger-dir-test-marker');
    const content = fs.readFileSync(path.join(dir, 'mafw.log'), 'utf-8');
    expect(content).toContain('logger-dir-test-marker');
  });
});
