import { handleRuntimeContract, handleRuntimeGet } from '../../../src/routes/runtime-switch';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (s: number) => { out.status = s; };
  out.end = (b: string) => { out.body = b; };
  return out;
}

const coverage = { runtime: 'fake', contractVersion: '2026.10.0', static: { declared: {}, effective: {}, presets: {}, obligations: {}, surfaces: {}, missing: [], unverified: [], notes: [] } };

describe('runtime contract routes', () => {
  it('GET /api/runtime includes active.coverage', async () => {
    const res = fakeRes();
    await handleRuntimeGet({} as any, res as any, {
      runtimeName: () => 'fake',
      runtimeCaps: () => ({ sessionApi: true }),
      envOverride: () => false,
      contractCoverage: () => coverage,
    } as any);
    expect(JSON.parse(res.body).active.coverage).toEqual(coverage);
  });

  it('GET /api/runtime/contract returns manifest + coverage', async () => {
    const res = fakeRes();
    await handleRuntimeContract({} as any, res as any, {
      contract: () => ({ manifest: buildRuntimeContractManifest(), coverage }),
    } as any);
    const body = JSON.parse(res.body);
    expect(body.manifest.schemaVersion).toBe(1);
    expect(body.coverage).toEqual(coverage);
  });
});
