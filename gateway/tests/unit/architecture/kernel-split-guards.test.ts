/**
 * Phase D3 split guards — the acceptance surface of spec §7, restated by
 * ruling D3-R1 (the controller's authoritative reading of the spec):
 *
 *   1. `src/index.ts` < 1000 lines (the whole point of D3; entry only);
 *   2. the extracted modules exist: `src/boot.ts`, `src/kernel.ts`,
 *      `src/http-router.ts`, `src/subsystems/`;
 *   3. transport dispatch discipline (ruling D3-R2): `src/index.ts`,
 *      `src/http-router.ts` and everything under `src/http/` contain ZERO
 *      `req.url?.match(` / `req.url?.startsWith(` branches — transport uses
 *      explicit comparisons / prefix helpers, so route selection is the
 *      RouteRegistry's job and only the router owns URL parsing;
 *   4. the entry keeps its public shape: `import { MafwScheduler } from
 *      './kernel'` + `export { MafwScheduler }` (ruling D3-R7 — one test and
 *      several docs import `MafwScheduler` from `src/index`).
 *
 * RED at D3 start (2026-11-10, BASE 42c78685): index.ts was ~8120 lines, the
 * three modules were absent, and index.ts carried 7 `req.url?.…` dispatch
 * branches. Task 3 moved the transport chain (index.ts → 5 branches), Task 4
 * moved `handleDashboardAPI` (→ 0 branches), so the dispatch guard below is
 * GREEN. The guard's remaining REDs are the three D3 acceptance items that only
 * Task 5 (boot.ts) / Task 8 (kernel.ts + http-router.ts + entry shape) close:
 * `index.ts < 1000`, `boot.ts`/`kernel.ts`/`http-router.ts` exist, and the
 * `import { MafwScheduler } from './kernel'` + `export { MafwScheduler }` shape.
 *
 * The dashboard arms moved to `src/subsystems/dashboard-legacy.ts`, where their
 * shapes are pinned by `legacy-route-inventory.test.ts` — the ban stays on the
 * D3-owned files (entry + router + transport) only.
 *
 * D3-R2 allowlist note: three PRE-EXISTING `req.url?.…` dispatchers live
 * outside this guard's scope (`mobile/media-proxy.ts` ×2,
 * `mobile/tts-artifact.ts` ×1, `routes/session-mutations.ts` ×2). They are
 * out of D3 scope and are deliberately not scanned here — this guard forbids
 * NEW ones only in the files that D3 owns.
 *
 * Cycle safety (plan Review Focus 5): extracted HTTP/subsystem modules take
 * type-only deps and must never runtime-import the kernel/entry — a runtime
 * cycle kernel → http → kernel would hit the CJS TDZ hazard documented at
 * index.ts:302 (`CANONICAL_TYPE_SET` precedent). Enforced below; it is
 * vacuously green until the modules land.
 *
 * Files are absent today by design (RED). Every read here is therefore
 * absence-tolerant: a missing file yields `null`/`[]` and the dedicated
 * existence assertion reports the problem, rather than an ENOENT crash
 * hiding which guard failed.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const ENTRY = path.join(SRC, 'index.ts');

/** Transport URL-dispatch forms banned by D3-R2 inside the D3-owned files. */
const BANNED_DISPATCH = [/\breq\.url\?\.match\s*\(/g, /\breq\.url\?\.startsWith\s*\(/g];

function readSrc(relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(SRC, relPath), 'utf-8');
  } catch {
    return null;
  }
}

function existsSrc(relPath: string): boolean {
  return fs.existsSync(path.join(SRC, relPath));
}

/** Every `.ts` file under `src/http/` (recursive), as src-relative paths. */
function listHttpModules(): string[] {
  const dir = path.join(SRC, 'http');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.name.endsWith('.ts')) out.push(childRel);
    }
  };
  walk(dir, 'http');
  return out.sort();
}

/** Line-numbered hits, so a RED failure names the offending branch. */
function dispatchHits(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of BANNED_DISPATCH) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) hits.push(`L${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

/** `true` when a specifier resolves to the kernel or the entry module. */
function isKernelOrEntrySpecifier(spec: string): boolean {
  const base = spec.replace(/\.js$/, '');
  return base === './kernel' || base === '../kernel' || base === './index' || base === '../index';
}

/**
 * Runtime (value) imports/requires of the kernel/entry from an extracted
 * module. `import type { … }` and `import(…)` type positions are allowed —
 * D3's modules take type-only deps (Global Constraint: CJS TDZ rule).
 */
function runtimeCycleImports(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const typeOnly = /^\s*(?:import|export)\s+type\b/.test(line);
    if (typeOnly) return;
    const from = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
    const required = line.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    const spec = from?.[1] ?? required?.[1];
    if (spec && isKernelOrEntrySpecifier(spec)) hits.push(`L${index + 1}: ${line.trim()}`);
  });
  return hits;
}

describe('D3 acceptance: index.ts is an entry, not the kernel (spec §7 / D3-R1)', () => {
  it('index.ts stays under the 1000-line acceptance budget', () => {
    const source = readSrc('index.ts');
    expect(source).not.toBeNull();
    const lines = (source as string).split(/\r?\n/).length;
    expect(lines).toBeLessThan(1000);
  });

  it('the extracted modules exist at the src root', () => {
    // D3-R1 acceptance (spec §7): boot.ts / kernel.ts / http-router.ts.
    for (const file of ['boot.ts', 'kernel.ts', 'http-router.ts']) {
      expect({ file, exists: existsSrc(file) }).toEqual({ file, exists: true });
    }
    // …and the `subsystems/` directory (spec §7 lists it as a module home;
    // Tasks 4/6 populate it).
    expect({ file: 'subsystems/', exists: fs.existsSync(path.join(SRC, 'subsystems')) })
      .toEqual({ file: 'subsystems/', exists: true });
  });
});

describe('D3-R2: transport dispatch is confined and URL-parse free', () => {
  it('index.ts has zero `req.url?.match/startsWith` dispatch branches', () => {
    const source = readSrc('index.ts');
    expect(source).not.toBeNull();
    // D3 Task 4 closed the last 3 arms (handleDashboardAPI). Zero is the pin:
    // the entry must never select a route from the URL again.
    expect(dispatchHits(source as string)).toEqual([]);
  });

  it('http-router.ts has zero `req.url?.match/startsWith` dispatch branches', () => {
    const source = readSrc('http-router.ts');
    // Absent today (RED) — the existence test above owns that failure; here a
    // missing module is simply "no violations yet".
    if (source === null) {
      expect(readSrc('http-router.ts')).toBeNull();
      return;
    }
    expect(dispatchHits(source)).toEqual([]);
  });

  it('src/http/*.ts has zero `req.url?.match/startsWith` dispatch branches', () => {
    const violations: string[] = [];
    for (const rel of listHttpModules()) {
      const source = readSrc(rel);
      if (source === null) continue;
      for (const hit of dispatchHits(source)) violations.push(`${rel} ${hit}`);
    }
    expect(violations).toEqual([]);
  });
});

describe('D3-R7: index.ts keeps the public entry shape', () => {
  it("imports the kernel and re-exports `MafwScheduler`", () => {
    const source = readSrc('index.ts');
    expect(source).not.toBeNull();
    const text = source as string;
    // `import { MafwScheduler } from './kernel';`
    expect({ kernelImport: /from\s+['"]\.\/kernel['"]/.test(text) })
      .toEqual({ kernelImport: true });
    // `export { MafwScheduler };`
    expect({ mafwSchedulerExport: /export\s*\{\s*MafwScheduler\s*\}/.test(text) })
      .toEqual({ mafwSchedulerExport: true });
  });
});

describe('D3 cycle safety: http/ and subsystems/ never runtime-import kernel/index', () => {
  it('http modules and subsystems use type-only deps', () => {
    const modules = [...listHttpModules()];
    for (const file of ['http-router.ts', 'boot.ts']) {
      if (existsSrc(file)) modules.push(file);
    }
    const subsystemsDir = path.join(SRC, 'subsystems');
    if (fs.existsSync(subsystemsDir)) {
      for (const name of fs.readdirSync(subsystemsDir)) {
        if (name.endsWith('.ts')) modules.push(`subsystems/${name}`);
      }
    }
    const violations: string[] = [];
    for (const rel of modules) {
      const source = readSrc(rel);
      if (source === null) continue;
      for (const hit of runtimeCycleImports(source)) violations.push(`${rel} ${hit}`);
    }
    expect(violations).toEqual([]);
  });
});
