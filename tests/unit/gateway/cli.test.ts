import { execSync } from 'child_process';
import * as path from 'path';

test('mafw-gateway --help prints usage', () => {
  const out = execSync(`node ${path.join(__dirname, '../../../bin/mafw-gateway.js')} --help`, { encoding: 'utf-8' });
  expect(out).toContain('Usage:');
});
