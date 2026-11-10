/**
 * Regression cover for the shared boundary-guard scanner (Plan 6 Task 7 fix).
 *
 * Review finding: the guards only inspected lines that *started* with `import`
 * (or contained `require(`), and required the specifier on that same line. A
 * multi-line import or an `export * from '...'` therefore slipped through both
 * the `adapters/opencode` allowlist and the business-dir guard. These cases
 * pin the scanner (and the real guard predicate) so the hole cannot reopen.
 */
import {
  disallowedSpecifiers,
  isAllowedAdapterSpecifier,
  scanModuleSpecifiers,
} from './import-scan';

/** The exact shapes Prettier emits for a long named import. */
const MULTI_LINE = [
  "import {",
  '  alpha,',
  '  beta,',
  "} from '@mafw/adapter-pi';",
  "export * from '@mafw/adapter-opencode';",
  "export { gamma } from 'gateway-internal';",
  "const legacy = require('@mafw/runtime-contract');",
  "const lazy = await import('@opencode-ai/sdk/v2');",
  "import type { Local } from './local';",
].join('\n');

describe('scanModuleSpecifiers', () => {
  it('finds multi-line imports and re-exports (not just single-line imports)', () => {
    const specifiers = scanModuleSpecifiers(MULTI_LINE).map((entry) => entry.specifier);
    expect(specifiers).toEqual([
      '@mafw/adapter-pi',
      '@mafw/adapter-opencode',
      'gateway-internal',
      '@mafw/runtime-contract',
      '@opencode-ai/sdk/v2',
      './local',
    ]);
  });

  it('ignores commented-out imports and re-exports', () => {
    const source = [
      "// import { a } from '@mafw/adapter-pi';",
      "/* export * from '@mafw/adapter-pi'; */",
      '/*',
      "} from '@mafw/adapter-opencode';",
      '*/',
      "import { real } from './real';",
    ].join('\n');
    expect(scanModuleSpecifiers(source).map((entry) => entry.specifier)).toEqual(['./real']);
  });

  it('reports the line that carries the specifier', () => {
    const [, first] = scanModuleSpecifiers(MULTI_LINE);
    expect(first).toMatchObject({
      specifier: '@mafw/adapter-opencode',
      line: 5,
      snippet: "export * from '@mafw/adapter-opencode';",
    });
  });
});

describe('boundary guard predicate over the scanner', () => {
  it('flags a multi-line import of a forbidden package (old line scan missed it)', () => {
    const source = [
      'import {',
      '  piRuntime,',
      "} from '@earendil-works/pi-coding-agent';",
    ].join('\n');
    // The old guard required the specifier on the `import` line, so this file
    // produced zero violations; the shared scanner must reject it.
    expect(disallowedSpecifiers(source, isAllowedAdapterSpecifier).map((entry) => entry.specifier))
      .toEqual(['@earendil-works/pi-coding-agent']);
  });

  it('flags `export * from` a gateway path inside the adapter package', () => {
    const source = "export * from '../../gateway/src/runtime/contract';";
    expect(disallowedSpecifiers(source, isAllowedAdapterSpecifier).map((entry) => entry.specifier))
      .toEqual(['../../gateway/src/runtime/contract']);
  });

  it('keeps the allowlist semantics: contract/core/native deps/builtins/local pass', () => {
    const source = [
      "import { defineRuntime } from '@mafw/runtime-contract';",
      "import { applyEventMappings } from '@mafw/runtime-core';",
      "const crossSpawn = require('cross-spawn');",
      "import * as path from 'node:path';",
      "import { editServer } from 'jsonc-parser';",
      "export * from './canonical';",
    ].join('\n');
    expect(disallowedSpecifiers(source, isAllowedAdapterSpecifier)).toEqual([]);
  });
});
