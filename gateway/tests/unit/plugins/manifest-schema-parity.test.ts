/**
 * The published `plugin.json` JSON Schema must be exactly as strict as the
 * runtime parser:
 *
 *   parsePackageManifest(m).ok === validateWithSchema(m)   for every m
 *
 * Both directions matter. Too strict and an editor rejects the packages in
 * `examples/plugins` (and an agent writes something the parser would have
 * accepted); too loose and an agent ships a package the gateway refuses to
 * activate. So the schema is compared with a real Ajv compile, not eyeballed.
 *
 * The matrix below is the contract. The corpora after it pin the rules that are
 * easiest to over-tighten (name, main, host, permission tokens, tool shapes).
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import { MANIFEST_JSON_SCHEMA } from '../../../src/plugins/manifest-schema';
import { PACKAGE_NAME_PATTERN_SOURCE, parsePackageManifest } from '../../../src/plugins/package-manifest';

const EXAMPLES = path.join(__dirname, '..', '..', '..', '..', 'examples', 'plugins');

function readExample(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES, name, 'plugin.json'), 'utf8'));
}

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
const validate = ajv.compile(MANIFEST_JSON_SCHEMA);

function schemaOk(manifest: unknown): boolean {
  return validate(manifest) === true;
}

/** Both verdicts, side by side: a mismatch prints the manifest that caused it. */
function parity(manifest: unknown): { parser: boolean; schema: boolean } {
  return { parser: parsePackageManifest(manifest).ok, schema: schemaOk(manifest) };
}

const ACCEPTED: unknown[] = [
  { name: 'demo' },
  { name: 'demo', apiVersion: 2, permissions: ['actions'] },
  {
    name: 'demo',
    apiVersion: 2,
    contributes: { gateway: { actions: ['ping'], observers: ['audit'], http: true } },
  },
  { name: 'demo', standardVersion: 1 },
  { name: 'demo', unknownTopLevelKey: 1 },
  // apiVersion 1 downgrades a broken `contributes` block to a warning, so the
  // package still parses — the schema must not reject what the parser accepts.
  { name: 'demo', contributes: { gateway: { actions: 'ping' } } },
  readExample('hello-plugin'),
  readExample('kitchen-sink'),
];

const REJECTED: unknown[] = [
  { name: 'demo', apiVersion: 3 },
  { name: 'demo', kind: 'untrusted' },
  { name: 'demo', standardVersion: 'v1' },
  { name: 'demo', standardVersion: 0 },
  { name: 'demo', apiVersion: 2, contributes: { gateway: { actions: 'ping' } } },
  { name: 'demo', apiVersion: 2, contributes: { gateway: { observer: [] } } },
  { name: 'bad name' },
];

describe('plugin.json JSON Schema parity', () => {
  it('accepts every manifest the parser accepts', () => {
    for (const manifest of ACCEPTED) {
      expect({ manifest, ...parity(manifest) }).toEqual({ manifest, parser: true, schema: true });
    }
  });

  it('rejects every manifest the parser rejects', () => {
    for (const manifest of REJECTED) {
      expect({ manifest, ...parity(manifest) }).toEqual({ manifest, parser: false, schema: false });
    }
  });

  it('agrees on the package-name rule, including the trailing "." / " "', () => {
    const names: Array<[string, boolean]> = [
      ['demo', true],
      ['a', true],
      ['A1', true],
      ['my-plugin', true],
      ['my.plugin', true],
      ['my_plugin', true],
      ['0x', true],
      ['a.b-c_d9', true],
      // `init` has its own 100-char cap, but the manifest rule has none, so the
      // schema must publish no `maxLength`.
      ['x'.repeat(101), true],
      ['bad name', false],
      ['.hidden', false],
      ['-demo', false],
      ['demo.', false],
      ['demo ', false],
      ['a/b', false],
      ['a\\b', false],
      ['a:b', false],
      ['ä', false],
      ['', false],
      ['\n', false],
    ];
    for (const [name, expected] of names) {
      expect({ name, ...parity({ name }) }).toEqual({ name, parser: expected, schema: expected });
    }
  });

  it('agrees on the main path rule', () => {
    const mains: Array<[string, boolean]> = [
      ['index.js', true],
      ['./index.js', true],
      ['lib/a.js', true],
      ['lib\\a.js', true],
      // A ".." *segment* is unsafe; a name that merely contains ".." is not.
      ['a..b.js', true],
      ['a/../b.js', false],
      ['a/..', false],
      ['..', false],
      ['../x.js', false],
      ['/abs.js', false],
      ['\\abs.js', false],
      ['C:/abs.js', false],
      ['c:x', false],
      ['a\u0000b.js', false],
      ['', false],
    ];
    for (const [main, expected] of mains) {
      expect({ main, ...parity({ name: 'demo', main }) })
        .toEqual({ main, parser: expected, schema: expected });
    }
  });

  it('agrees on the host range rule', () => {
    const hosts: Array<[unknown, boolean]> = [
      ['*', true],
      ['  *  ', true],
      ['>=1.0.0', true],
      // The parser splits on whitespace before parsing a comparator, so a space
      // after the operator makes two tokens and is invalid.
      ['>= 5.1.0', false],
      ['>=5.1.0 <6.0.0', true],
      ['5.1.0', true],
      ['=5.1.0', true],
      ['1.0.0-rc.1', true],
      ['', false],
      ['   ', false],
      ['not a range', false],
      ['>=1.0', false],
      ['>=5.1.0,<6.0.0', false],
      [5, false],
    ];
    for (const [host, expected] of hosts) {
      expect({ host, ...parity({ name: 'demo', host }) })
        .toEqual({ host, parser: expected, schema: expected });
    }
  });

  it('agrees on permission tokens', () => {
    const permissions: Array<[unknown, boolean]> = [
      [[], true],
      [['actions', 'config.read', 'ui.web'], true],
      [['files.read:/x'], true],
      [['files.write:C:/x'], true],
      [['net.fetch:example.com'], true],
      [['root'], false],
      [['files.read:'], false],
      [[''], false],
      [['actions', 'nope'], false],
      ['actions', false],
      [[1], false],
    ];
    for (const [value, expected] of permissions) {
      expect({ value, ...parity({ name: 'demo', apiVersion: 2, permissions: value }) })
        .toEqual({ value, parser: expected, schema: expected });
    }
  });

  it('agrees on the `contributes` shape at apiVersion 2', () => {
    const blocks: Array<[string, unknown, boolean]> = [
      ['empty', {}, true],
      ['explicit empty planes', { gateway: { actions: [], tools: [], observers: [], http: false } }, true],
      ['desktop ui slots', { desktop: { ui: { panels: [{ id: 'p' }], messageWindows: [] } } }, true],
      ['desktop web surfaces', { desktop: { web: { webSurfaces: [{ id: 'w' }] } } }, true],
      ['desktop main legacy', { desktop: { main: { legacy: true } } }, true],
      ['desktop main not legacy', { desktop: { main: { legacy: false } } }, false],
      ['unknown plane', { gatewayx: {} }, false],
      ['unknown gateway plane', { gateway: { observer: [] } }, false],
      ['actions not an array', { gateway: { actions: 'ping' } }, false],
      ['http not boolean', { gateway: { http: 'yes' } }, false],
      ['ui not an array', { desktop: { ui: [] } }, false],
      ['unknown desktop key', { desktop: { unknown: {} } }, false],
    ];
    for (const [label, contributes, expected] of blocks) {
      expect({ label, ...parity({ name: 'demo', apiVersion: 2, contributes }) })
        .toEqual({ label, parser: expected, schema: expected });
    }
  });

  it('keeps a broken `contributes` block legal at apiVersion 1, as the parser does', () => {
    // Legacy packages must keep activating: the parser records a warning and
    // drops the block. A schema that rejected it would be stricter than the
    // runtime for every existing v1 package that carries a stale block.
    const blocks: unknown[] = [
      { gateway: { actions: 'ping' } },
      { gateway: { observer: [] } },
      { gatewayx: {} },
      { desktop: { ui: [] } },
      { desktop: { main: { legacy: false } } },
    ];
    for (const contributes of blocks) {
      expect({ contributes, ...parity({ name: 'demo', contributes }) })
        .toEqual({ contributes, parser: true, schema: true });
    }
  });

  it('agrees on tool descriptors', () => {
    const tools: Array<[unknown, boolean]> = [
      [[{ name: 'lookup', description: 'd', inputSchema: { type: 'object' } }], true],
      [[{
        name: 'lookup',
        title: 'Lookup',
        description: 'd',
        inputSchema: {},
        outputSchema: {},
        timeoutMs: 60_000,
        scope: 'global',
      }], true],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, timeoutMs: 60_001 }], false],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, timeoutMs: 0 }], false],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, scope: 'session' }], true],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, scope: 'weird' }], false],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, title: '  ' }], false],
      [[{ name: 'lookup', description: 'd' }], false],
      [[{ name: 'lookup' }], false],
      [[{ description: 'd', inputSchema: {} }], false],
      [[{ name: 'a b', description: 'd', inputSchema: {} }], false],
      [[{ name: 'lookup', description: 'd', inputSchema: {}, extra: 1 }], false],
      [[{ name: 'lookup', description: 'x'.repeat(513), inputSchema: {} }], false],
      [['lookup'], false],
      [{ name: 'lookup' }, false],
    ];
    for (const [value, expected] of tools) {
      const contributes = { gateway: { tools: value } };
      expect({ value, ...parity({ name: 'demo', apiVersion: 2, contributes }) })
        .toEqual({ value, parser: expected, schema: expected });
    }
  });

  it('agrees on the remaining scalar fields', () => {
    const cases: Array<[string, unknown, boolean]> = [
      ['version', '', false],
      ['version', '1.2.3', true],
      ['deprecated', '', false],
      ['deprecated', 'use demo-next', true],
      ['integrity', { algorithm: 'sha256', files: { 'index.js': 'abc' } }, true],
      ['integrity', { algorithm: 'sha256', files: {} }, true],
      ['integrity', { algorithm: 'md5', files: {} }, false],
      ['integrity', { algorithm: 'sha256', files: { 'index.js': '' } }, false],
      ['integrity', { algorithm: 'sha256' }, false],
      ['integrity', 'sha256', false],
      ['standardVersion', 1, true],
      ['standardVersion', 2, true],
      ['standardVersion', 1.5, false],
      ['standardVersion', null, false],
      ['apiVersion', '2', false],
      ['kind', 'robot', false],
    ];
    for (const [field, value, expected] of cases) {
      const manifest = { name: 'demo', [field]: value };
      expect({ field, value, ...parity(manifest) })
        .toEqual({ field, value, parser: expected, schema: expected });
    }
  });

  it('never closes the top level and never caps the name', () => {
    const schema = MANIFEST_JSON_SCHEMA as unknown as Record<string, any>;
    // The parser lets vendors add their own top-level metadata; closing the
    // object here would reject those packages in every editor.
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.properties.name.maxLength).toBeUndefined();
    // One source of truth: the schema reuses the parser's name pattern.
    expect(schema.properties.name.pattern).toBe(PACKAGE_NAME_PATTERN_SOURCE);
  });
});
