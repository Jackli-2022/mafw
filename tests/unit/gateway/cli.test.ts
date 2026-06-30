import { execSync, spawnSync } from 'child_process';
import * as path from 'path';

const CLI = path.join(__dirname, '../../../bin/mafw-gateway.js');

test('mafw-gateway --help prints usage', () => {
  const out = execSync(`node ${CLI} --help`, { encoding: 'utf-8' });
  expect(out).toContain('Usage:');
});

test('mafw-gateway with no command prints usage and exits 0', () => {
  const result = spawnSync('node', [CLI], { encoding: 'utf-8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Usage:');
});

test('mafw-gateway rejects unknown command and exits 1', () => {
  const result = spawnSync('node', [CLI, 'not-a-command'], { encoding: 'utf-8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown command');
  expect(result.stdout).toContain('Usage:');
});

test('mafw-gateway handles very long unknown command', () => {
  const longCmd = 'a'.repeat(1000);
  const result = spawnSync('node', [CLI, longCmd], { encoding: 'utf-8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown command');
});

test('mafw-gateway handles special characters in command argument', () => {
  const result = spawnSync('node', [CLI, '<script>alert(1)</script>'], { encoding: 'utf-8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown command');
});
