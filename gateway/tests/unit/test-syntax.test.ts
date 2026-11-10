/**
 * Test syntax gate.
 *
 * Why this file exists: `gateway/jest.config.js` runs ts-jest with
 * `diagnostics: false`. That option disables ts-jest's *reporting*, not
 * TypeScript's parsing — ts-jest still hands every file to the TypeScript
 * emitter, which recovers from syntax errors and emits whatever AST it managed
 * to build. A test file with an unbalanced brace therefore compiles to
 * something, joins the suite and can even pass, while `tsc` (and any editor)
 * flags it. Three such files had been sitting in `tests/` exactly like that.
 *
 * This gate is deliberately *syntax only*: it parses each test/helper file with
 * the TypeScript compiler API and fails on parse diagnostics. It is not a type
 * gate. A full `--noEmit` typecheck of the whole test tree still leaves a large
 * pre-existing error backlog and stays separate work; `tsconfig.test-types.json`
 * covers only the narrow slice that is already clean.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

/** `gateway/tests` — `__dirname` is `gateway/tests/unit` under Jest. */
const TESTS_ROOT = path.resolve(__dirname, '..');

type SourceWithParseDiagnostics = ts.SourceFile & {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
};

/**
 * Parse `text` the way `createSourceFile` does for the compiler and return only
 * the parse (syntax) diagnostics. `parseDiagnostics` is populated when
 * `reportDiagnostics` is true but is not part of the public `SourceFile` typing,
 * hence the narrow cast.
 */
function parseDiagnosticsOf(fileName: string, text: string): readonly ts.Diagnostic[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return (source as SourceWithParseDiagnostics).parseDiagnostics ?? [];
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `${diagnostic.file?.fileName ?? '<unknown>'}: TS${diagnostic.code}: ${message}`;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relative = path.relative(TESTS_ROOT, diagnostic.file.fileName).replace(/\\/g, '/');
  return `tests/${relative}:${line + 1}:${character + 1} TS${diagnostic.code}: ${message}`;
}

/** Recursively list files under `dir` (skips `node_modules`) that `accept` picks. */
function collectFiles(dir: string, accept: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectFiles(full, accept));
    } else if (accept(full)) {
      found.push(full);
    }
  }
  return found;
}

function isTestFile(file: string): boolean {
  return file.endsWith('.test.ts');
}

describe('gateway test syntax gate', () => {
  const testFiles = collectFiles(TESTS_ROOT, isTestFile);
  const helperFiles = collectFiles(path.join(TESTS_ROOT, 'helpers'), (file) => file.endsWith('.ts'));

  test('the gate actually reports parse diagnostics (self-check)', () => {
    // Guards the gate itself: if the compiler API stops surfacing
    // `parseDiagnostics`, the sweep below would go green for the wrong reason.
    const diagnostics = parseDiagnosticsOf('self-check.ts', 'export const broken = { a: 1;\n');
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('every gateway test and helper file parses without syntax errors', () => {
    const targets = [...testFiles, ...helperFiles];
    // Sanity check the sweep: an empty walk would make this test vacuous.
    expect(targets.length).toBeGreaterThan(100);

    const violations: string[] = [];
    for (const file of targets) {
      const diagnostics = parseDiagnosticsOf(file, fs.readFileSync(file, 'utf8'));
      violations.push(...diagnostics.map(formatDiagnostic));
    }

    expect(violations).toEqual([]);
  });
});
