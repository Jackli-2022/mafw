export interface PackagedGatewayPaths {
  executable: string
  resourcesRoot: string
  entry: string
  releaseFile: string
}

export interface SmokeHealth {
  status?: string
  gatewayVersion?: string
  experienceVersion?: string
  minimumClientExperienceVersion?: string
  schemaEpoch?: number
  instanceId?: string
  distribution?: string
}

export function resolvePackagedGatewayPaths(input: {
  appRoot?: string | null
  appExecutable?: string | null
  resourcesRoot?: string | null
  platform?: NodeJS.Platform
}): PackagedGatewayPaths

export function assertSmokeHealth(
  health: SmokeHealth,
  expected?: { gatewayVersion?: string; experienceVersion?: string; schemaEpoch?: number },
): void

export function parseSmokeArgs(
  args: string[],
  platform?: NodeJS.Platform,
): {
  appRoot: string | null
  appExecutable: string | null
  resourcesRoot: string | null
  payloadOnly: boolean
  timeoutMs: number
}

export function findFreePort(host?: string): Promise<number>
