import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('resolveServePassword persistence', () => {
  const keys = [
    'MAFW_RUNTIME_PASSWORD',
    'MAFW_OPENCODE_PASSWORD',
    'OPENCODE_SERVER_PASSWORD',
    'MAFW_SERVE_PASSWORD_FILE',
  ] as const;
  const saved = new Map<string, string | undefined>();
  let dir: string;
  let file: string;

  beforeEach(() => {
    for (const key of keys) saved.set(key, process.env[key]);
    for (const key of keys) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-serve-password-'));
    file = path.join(dir, 'serve-password');
    process.env.MAFW_SERVE_PASSWORD_FILE = file;
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function resolve(): string {
    return require('../../../../adapters/opencode/src/serve-sidecar').resolveServePassword();
  }

  test('persists a generated password so a restarted gateway can adopt the same serve', () => {
    const first = resolve();
    expect(first).toMatch(/^mafw-/);
    expect(fs.readFileSync(file, 'utf-8').trim()).toBe(first);

    // Simulate a new gateway process: fresh module, same file.
    jest.resetModules();
    expect(resolve()).toBe(first);
  });

  test('an explicit env password wins and is never written to disk', () => {
    process.env.MAFW_RUNTIME_PASSWORD = 'env-serve-pw';
    expect(resolve()).toBe('env-serve-pw');
    expect(fs.existsSync(file)).toBe(false);
  });

  test('a corrupt/empty file is replaced by a generated password', () => {
    fs.writeFileSync(file, '   \n', 'utf-8');
    const password = resolve();
    expect(password).toMatch(/^mafw-/);
    expect(fs.readFileSync(file, 'utf-8').trim()).toBe(password);
  });
});
