import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();

function scanSource(text: string, forbidden: string[]): string[] {
  return forbidden.filter((token) => text.includes(token));
}

function violations(file: string, forbidden: string[]): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return scanSource(text, forbidden).map((token) => `${file}: ${token}`);
}

describe('runtime isolation architecture boundaries', () => {
  it('scan itself catches a synthetic raw bypass fixture', () => {
    const fixture = "const rt = deps.runtime(); if (rt.name === 'pi') { rt.global.event(); }";
    expect(scanSource(fixture, ['rt.name', 'global.event'])).toEqual(['rt.name', 'global.event']);
  });

  it('business routes do not interpret runtime names or raw capabilities', () => {
    const root = path.join(ROOT, 'src', 'routes');
    const exceptions = new Set(['runtime-switch.ts', 'conformance.ts', 'wave1-handlers.ts']);
    const files = fs.readdirSync(root)
      .filter((f) => f.endsWith('.ts') && !exceptions.has(f))
      .map((f) => `src/routes/${f}`);
    const bad = ['runtime.name', 'rt.name', 'capabilities?.', 'runtimeCaps', 'runtimeName'];
    expect(files.flatMap((file) => violations(file, bad))).toEqual([]);
  });

  it('first-party run/checkpoint core uses RuntimeAccess, not runtime identity branches', () => {
    const files = [
      'src/core/run/run-coordinator.ts',
      'src/core/checkpoint/auto-hook.ts',
    ];
    const bad = ['rt.name', "=== 'pi'", 'capabilities?.', 'runtimeName', 'runtimeCaps'];
    expect(files.flatMap((file) => violations(file, bad))).toEqual([]);
  });
});
