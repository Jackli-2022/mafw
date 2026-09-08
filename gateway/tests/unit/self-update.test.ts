import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildGatewayAt } from '../../src/self-update';

describe('buildGatewayAt (global-install degradation)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-selfupdate-'));
  });

  test('no src/ (global install) → skipped, ok, runner never called', () => {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'entry');
    let called = 0;
    const res = buildGatewayAt(dir, () => { called++; return { ok: true }; });
    expect(res).toEqual({ ok: true, skipped: true });
    expect(called).toBe(0);
  });

  test('src/ present (source checkout) → delegates to runner, ok', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'entry');
    const seen: string[] = [];
    const res = buildGatewayAt(dir, (pkgRoot) => { seen.push(pkgRoot); return { ok: true }; });
    expect(res).toEqual({ ok: true });
    expect(seen).toEqual([dir]);
  });

  test('src/ present + runner failure → ok:false with error', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const res = buildGatewayAt(dir, () => ({ ok: false, error: 'tsc exploded' }));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('tsc exploded');
  });

  test('src/ present + runner ok but dist/index.js missing → ok:false', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const res = buildGatewayAt(dir, () => ({ ok: true }));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('dist/index.js missing after build');
  });
});
