/**
 * The agent-facing standard (`docs/guides/plugin-standard.md`) is part of the
 * contract: a fresh session is told to write a package from that page alone.
 *
 * These assertions pin three different things:
 *
 * 1. every bound error string the doc quotes is still byte-identical to the
 *    source that produces it (doc drift and code drift both fail here);
 * 2. every command, flag and install flag the doc promises exists;
 * 3. the two facts a first-time author gets wrong — observers only receive
 *    canonical runtime events, and `untrusted` is limited to
 *    actions / events / config — are stated explicitly.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..', '..', '..', '..');
const DOC_PATH = path.join(REPO, 'docs', 'guides', 'plugin-standard.md');
const DOC = () => fs.readFileSync(DOC_PATH, 'utf8');
const source = (...segments: string[]): string =>
  fs.readFileSync(path.join(REPO, ...segments), 'utf8');

const VALIDATOR = (...segments: string[]): string =>
  source('gateway', 'src', 'plugins', 'package-validator.ts', ...segments);
const HOST = (...segments: string[]): string =>
  source('gateway', 'src', 'plugins', 'package-host.ts', ...segments);

const DECLARATION_ERRORS = [
  'action "<name>" is not declared in plugin.json contributes.gateway.actions',
  'event "<type>" is not declared in plugin.json contributes.gateway.events',
  'tool "<name>" is not declared in plugin.json contributes.gateway.tools',
  'observer "<id>" is not declared in plugin.json contributes.gateway.observers',
];

/** The four legacy singleton planes plus `media`'s modality bound. */
const LEGACY_PLANE_ERRORS = [
  'invalid contributions: runtime "x" is not declared in plugin.json contributes.gateway.runtime',
  'invalid contributions: media "x" is not declared in plugin.json contributes.gateway.media',
  'invalid contributions: media modality "video" is not declared in plugin.json contributes.gateway.media.modalities',
  'invalid contributions: tts "x" is not declared in plugin.json contributes.gateway.tts',
  'invalid contributions: usage "x" is not declared in plugin.json contributes.gateway.usage',
];

/** Contract-level rejects: an empty list would be ambiguous, a typo unsatisfiable. */
const MEDIA_DECLARATION_ERRORS = [
  'manifest contributes.gateway.media.modalities must not be empty',
  'manifest contributes.gateway.media.modalities[0] must be one of image, video, audio',
];

it('documents every bound error string verbatim', () => {
  const doc = DOC();
  for (const text of [
    ...DECLARATION_ERRORS,
    'http routes are not declared (contributes.gateway.http is false)',
    'packages without plugin.json cannot contribute',
  ]) {
    expect(doc).toContain(text);
  }
});

it('quotes strings that the producing source still contains', () => {
  const validator = VALIDATOR();
  for (const text of DECLARATION_ERRORS) {
    // The doc writes the placeholder form; the source interpolates the same
    // sentence around `${...}`. Compare the fixed middle of the sentence.
    const tail = text.split('"').pop() as string;
    expect(validator).toContain(tail);
  }
  const host = HOST();
  expect(host).toContain('http routes are not declared (contributes.gateway.http is false)');
  expect(host).toContain('packages without plugin.json cannot contribute ');
});

it('documents every legacy plane bound error verbatim', () => {
  const doc = DOC();
  for (const text of [...LEGACY_PLANE_ERRORS, ...MEDIA_DECLARATION_ERRORS]) {
    expect(doc).toContain(text);
  }

  // The host wraps each sentence over two template literals and interpolates
  // the offending value, so compare after collapsing both.
  const host = HOST()
    .replace(/\$\{[^}]*\}/g, '…')
    .replace(/`\s*\+\s*'/g, '')
    .replace(/\s+/g, ' ');
  for (const text of LEGACY_PLANE_ERRORS) {
    expect(host).toContain(text.replace(/"[^"]*"/, '"…"'));
  }

  // The emptiness / material-set rules live in the shared contract, not the host.
  const contract = source('packages', 'plugin-contract', 'src', 'validate.ts');
  expect(contract).toContain('${label}.modalities must not be empty');
  expect(contract).toContain('must be one of ${MEDIA_MODALITIES.join(", ")}');
});

it('names the three CLI entry points and the strict/json flags', () => {
  const doc = DOC();
  for (const cmd of ['mafw plugin init', 'mafw plugin check', 'mafw plugin schema', '--strict', '--json']) {
    expect(doc).toContain(cmd);
  }
});

it('states that installation is performed by a human with consent flags', () => {
  const doc = DOC();
  expect(doc).toContain('mafw plugins install');
  expect(doc).toContain('--trust');
  expect(doc).toContain('--permission');
  expect(doc).toMatch(/由人执行|human/);
});

it('states the observer and untrusted limits', () => {
  const doc = DOC();
  expect(doc).toContain('canonical');
  expect(doc).toContain('plugin:*');
  expect(doc).toMatch(/untrusted/i);
});

it('keeps the standard structure (sections 0-11, in order)', () => {
  const numbers = DOC()
    .split(/\r?\n/)
    .filter((line) => /^## \d+\./.test(line))
    .map((line) => Number(/^## (\d+)\./.exec(line)![1]));
  expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

it('states the worker permission and contribution limits verbatim', () => {
  const doc = DOC();
  for (const text of [
    'not allowed in untrusted worker:',
    'permission denied: actions',
    'permission denied: events',
    'config.read',
    'config.write',
  ]) {
    expect(doc).toContain(text);
  }
  // Both of these live in the worker bootstrap, not in the gateway host.
  const bootstrap = source('gateway', 'src', 'plugins', 'worker', 'worker-bootstrap.cjs');
  expect(bootstrap).toContain('not allowed in untrusted worker: ');
  expect(bootstrap).toContain('permission denied: config.read');
});

it('states the check verdict contract and the human credential source', () => {
  const doc = DOC();
  // `--json` is one parseable line whose `ok` is the command verdict.
  for (const text of ['verdict', 'strictFailed', 'registered', 'declared']) {
    expect(doc).toContain(text);
  }
  // Warnings are the only thing `--strict` turns into a failure.
  expect(doc).toMatch(/声明了没注册|declared but not registered/);
  // The install credential may never be handed to an agent.
  expect(doc).toContain('MAFW_HUMAN_TOKEN');
  expect(doc).toContain('human.token');
});
