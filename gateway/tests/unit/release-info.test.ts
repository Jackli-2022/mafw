import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  composeGatewayReleaseMetadata,
  createGatewayRuntimeIdentity,
  gatewayHealthFields,
  loadGatewayReleaseMetadata,
  parseGatewayReleaseMetadata,
} from '../../src/release-info';

describe('gateway release identity', () => {
  test('composeGatewayReleaseMetadata uses the product version for gatewayVersion', () => {
    expect(composeGatewayReleaseMetadata({
      productVersion: '5.2.0',
      experienceVersion: '2026.11.1',
      minimumClientExperienceVersion: '2026.11.0',
      schemaEpoch: 1,
    })).toEqual({
      productVersion: '5.2.0',
      gatewayVersion: '5.2.0',
      experienceVersion: '2026.11.1',
      minimumClientExperienceVersion: '2026.11.0',
      schemaEpoch: 1,
    });
  });

  test('parseGatewayReleaseMetadata rejects missing or non-positive schemaEpoch', () => {
    expect(() => parseGatewayReleaseMetadata({ productVersion: '5.2.0' })).toThrow();
    expect(() => parseGatewayReleaseMetadata({
      productVersion: '5.2.0',
      gatewayVersion: '5.2.0',
      experienceVersion: '2026.11.1',
      minimumClientExperienceVersion: '2026.11.0',
      schemaEpoch: 0,
    })).toThrow();
  });

  test('createGatewayRuntimeIdentity marks only the managed env', () => {
    let uuidCalls = 0;
    const newUuid = () => {
      uuidCalls += 1;
      return 'uuid-1';
    };

    expect(createGatewayRuntimeIdentity({
      MAFW_DESKTOP_MANAGED: '1',
      MAFW_DESKTOP_CHANNEL: 'beta',
      MAFW_DESKTOP_INSTANCE_ID: 'instance-from-desktop',
    }, newUuid)).toEqual({
      instanceId: 'instance-from-desktop',
      distribution: 'desktop-managed',
      channel: 'beta',
    });
    expect(uuidCalls).toBe(0);

    expect(createGatewayRuntimeIdentity({}, newUuid)).toEqual({
      instanceId: 'uuid-1',
      distribution: 'standalone',
      channel: 'standalone',
    });
    expect(uuidCalls).toBe(1);
  });

  test('gatewayHealthFields exposes only additive identity fields', () => {
    const metadata = composeGatewayReleaseMetadata({
      productVersion: '5.2.0',
      experienceVersion: '2026.11.1',
      minimumClientExperienceVersion: '2026.11.0',
      schemaEpoch: 1,
    });
    expect(gatewayHealthFields(metadata, {
      instanceId: 'uuid-1',
      distribution: 'desktop-managed',
      channel: 'prod',
    })).toEqual({
      gatewayVersion: '5.2.0',
      experienceVersion: '2026.11.1',
      minimumClientExperienceVersion: '2026.11.0',
      schemaEpoch: 1,
      instanceId: 'uuid-1',
      distribution: 'desktop-managed',
      channel: 'prod',
    });
  });

  test('loadGatewayReleaseMetadata derives dev metadata from root package when running from src', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-release-dev-'));
    try {
      fs.mkdirSync(path.join(root, 'gateway', 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '6.0.0' }));
      fs.writeFileSync(
        path.join(root, 'gateway', 'release-policy.json'),
        JSON.stringify({ schemaEpoch: 2 }),
      );
      expect(loadGatewayReleaseMetadata(path.join(root, 'gateway', 'src'))).toEqual({
        productVersion: '6.0.0',
        gatewayVersion: '6.0.0',
        experienceVersion: '2026.11.1',
        minimumClientExperienceVersion: '2026.11.0',
        schemaEpoch: 2,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('loadGatewayReleaseMetadata names a missing release file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-release-info-'));
    try {
      expect(() => loadGatewayReleaseMetadata(dir)).toThrow(path.join(dir, 'release.json'));
      fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({
        productVersion: '5.2.0',
        gatewayVersion: '5.2.0',
        experienceVersion: '2026.11.1',
        minimumClientExperienceVersion: '2026.11.0',
        schemaEpoch: 1,
      }));
      expect(loadGatewayReleaseMetadata(dir).gatewayVersion).toBe('5.2.0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
