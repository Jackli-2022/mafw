import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { computeCoverage } from '../../../src/runtime/coverage';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('claude adapter static coverage', () => {
  it('lists the documented missing surfaces', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-coverage-'));
    await build({
      entryPoints: [join(REPO_ROOT, 'adapters/claude/src/index.ts')],
      bundle: true, platform: 'node', target: 'node22', format: 'cjs',
      define: { 'import.meta.url': '__filename' },
      outfile: join(dir, 'claude.js'), logLevel: 'silent',
    });
    const loader = new RuntimePluginLoader(dir);
    loader.setCanonicalTypes(new Set(Object.keys(EVENT_FLOW_MATRIX)));
    await loader.scan();
    const entry = loader.get('claude')!;
    const rt = await entry.createRuntime({} as any);
    const coverage = computeCoverage({
      rt, source: 'file',
      declaration: { eventSource: entry.eventSource, eventMappings: entry.eventMappings, transformEvent: entry.transformEvent },
      plugin: { name: 'claude', createRuntime: entry.createRuntime, external: entry.external, capabilities: entry.capabilities },
    }, buildRuntimeContractManifest());
    const missing = coverage.static.missing.map((m) => m.id);
    expect(missing).toEqual(expect.arrayContaining([
      'session.update', 'branch.fork', 'branch.diff',
      'approval.permissionReply', 'discovery.list', 'mcp.list', 'identity.agents.install',
    ]));
    expect(coverage.static.surfaces['session.create'].status).toBe('present');
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
