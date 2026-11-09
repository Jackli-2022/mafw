import * as fs from 'fs';
import * as path from 'path';

// Repo root: gateway/tests/unit → ../../..
const root = path.resolve(__dirname, '../../..');

describe('voice sidecar packaging', () => {
  it('keeps the sidecar sources in the repo tree', () => {
    expect(fs.existsSync(path.join(root, 'gateway/voice_sidecars/qwen3_asr_server.py'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'gateway/voice_sidecars/requirements.txt'))).toBe(true);
  });

  it('ships the sidecar directory in the published npm package', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(rootPkg.files).toContain('gateway/voice_sidecars/');
  });

  it('copies the sidecar directory during local deploy through the shared asset plan', () => {
    const deploy = fs.readFileSync(path.join(root, 'gateway/scripts/deploy-local.mjs'), 'utf8');
    const assets = fs.readFileSync(path.join(root, 'scripts/gateway-package-assets.mjs'), 'utf8');
    expect(deploy).toContain('gatewayAssetPlan');
    expect(deploy).toMatch(/profile:\s*"global"/);
    expect(assets).toContain('voice_sidecars');
    expect(assets).toMatch(/path\.join\(gatewayRoot,\s*"voice_sidecars"\)/);
  });

  it('copies the sidecar directory into the desktop gateway bundle through the shared plan', () => {
    const stage = fs.readFileSync(path.join(root, 'packages/desktop/scripts/stage-gateway.ts'), 'utf8');
    const assets = fs.readFileSync(path.join(root, 'scripts/gateway-package-assets.mjs'), 'utf8');
    expect(stage).toContain('gatewayAssetPlan');
    expect(stage).toMatch(/profile:\s*"desktop"/);
    expect(assets).toContain('voice_sidecars');
  });
});
