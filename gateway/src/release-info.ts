import * as fs from 'fs';
import * as path from 'path';

export interface GatewayReleaseMetadata {
  productVersion: string;
  gatewayVersion: string;
  experienceVersion: string;
  minimumClientExperienceVersion: string;
  schemaEpoch: number;
}

export interface GatewayRuntimeIdentity {
  instanceId: string;
  distribution: 'desktop-managed' | 'standalone';
  channel: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`release metadata field ${field} must be a non-empty string`);
  }
  return value.trim();
}

function requiredSchemaEpoch(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('release metadata field schemaEpoch must be a positive integer');
  }
  return value;
}

export function composeGatewayReleaseMetadata(input: {
  productVersion: string;
  experienceVersion: string;
  minimumClientExperienceVersion: string;
  schemaEpoch: number;
}): GatewayReleaseMetadata {
  const productVersion = requiredString(input.productVersion, 'productVersion');
  return {
    productVersion,
    gatewayVersion: productVersion,
    experienceVersion: requiredString(input.experienceVersion, 'experienceVersion'),
    minimumClientExperienceVersion: requiredString(
      input.minimumClientExperienceVersion,
      'minimumClientExperienceVersion',
    ),
    schemaEpoch: requiredSchemaEpoch(input.schemaEpoch),
  };
}

export function parseGatewayReleaseMetadata(value: unknown): GatewayReleaseMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('release metadata must be an object');
  }
  const raw = value as Record<string, unknown>;
  return {
    productVersion: requiredString(raw.productVersion, 'productVersion'),
    gatewayVersion: requiredString(raw.gatewayVersion, 'gatewayVersion'),
    experienceVersion: requiredString(raw.experienceVersion, 'experienceVersion'),
    minimumClientExperienceVersion: requiredString(
      raw.minimumClientExperienceVersion,
      'minimumClientExperienceVersion',
    ),
    schemaEpoch: requiredSchemaEpoch(raw.schemaEpoch),
  };
}

export function loadGatewayReleaseMetadata(distDir: string): GatewayReleaseMetadata {
  const file = path.join(distDir, 'release.json');
  try {
    return parseGatewayReleaseMetadata(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (err: any) {
    throw new Error(`failed to load gateway release metadata from ${file}: ${err?.message ?? err}`);
  }
}

export function createGatewayRuntimeIdentity(
  env: Record<string, string | undefined>,
  newUuid: () => string,
): GatewayRuntimeIdentity {
  const managed = env.MAFW_DESKTOP_MANAGED === '1';
  const suppliedId = env.MAFW_DESKTOP_INSTANCE_ID?.trim();
  return {
    instanceId: suppliedId || newUuid(),
    distribution: managed ? 'desktop-managed' : 'standalone',
    channel: env.MAFW_DESKTOP_CHANNEL?.trim() || (managed ? 'managed' : 'standalone'),
  };
}

export function gatewayHealthFields(
  metadata: GatewayReleaseMetadata,
  identity: GatewayRuntimeIdentity,
): Record<string, unknown> {
  return {
    gatewayVersion: metadata.gatewayVersion,
    experienceVersion: metadata.experienceVersion,
    minimumClientExperienceVersion: metadata.minimumClientExperienceVersion,
    schemaEpoch: metadata.schemaEpoch,
    instanceId: identity.instanceId,
    distribution: identity.distribution,
    channel: identity.channel,
  };
}
