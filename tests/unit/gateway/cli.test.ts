import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI = path.join(__dirname, '../../../bin/mafw-gateway.js');

// ... existing tests ...

test('mafw-gateway logs prints the last 50 lines without tail', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-home-'));
  const logDir = path.join(tmpHome, '.config', 'mafw', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'gateway.log');
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  fs.writeFileSync(logFile, lines.join('\n'), 'utf-8');

  const result = spawnSync('node', [CLI, 'logs'], {
    encoding: 'utf-8',
    env: { ...process.env, USERPROFILE: tmpHome }
  });

  fs.rmSync(tmpHome, { recursive: true, force: true });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('line 11');
  expect(result.stdout).toContain('line 60');
  expect(result.stdout).not.toMatch(/^line 1$/m);
});

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
