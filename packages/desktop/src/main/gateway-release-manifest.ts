export interface GatewayReleaseManifest {
  schemaVersion: 1
  productVersion: string
  gatewayVersion: string
  desktopMinimumGatewayVersion: string
  experienceVersion: string
  minimumClientExperienceVersion: string
  schemaEpoch: number
  payloadManifestSha256: string
}

export interface GatewayPayloadFile {
  path: string
  size: number
  sha256: string
}

export interface GatewayPayloadManifest {
  schemaVersion: 1
  files: GatewayPayloadFile[]
}

export interface PayloadManifestDeps {
  walk(rel: string): Promise<string[]>
  read(rel: string): Promise<Buffer>
  stat(rel: string): Promise<{ size: number }>
  sha256(data: Buffer): string
}

export type VerifyDeps = Pick<PayloadManifestDeps, "read" | "stat" | "sha256">

const CONTROL_FILES = new Set([
  "release-manifest.json",
  "payload-manifest.json",
  ".install-complete.json",
])

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`release manifest field ${field} must be a non-empty string`)
  }
  return value.trim()
}

function sha256Text(value: unknown, field: string): string {
  const text = requiredText(value, field)
  if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error(`release manifest field ${field} must be a sha256 hex digest`)
  return text.toLowerCase()
}

function safeRelativePath(value: unknown): string {
  const path = requiredText(value, "files[].path").replaceAll("\\", "/")
  if (path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`payload manifest path is invalid: ${path}`)
  }
  return path
}

export function parseGatewayReleaseManifest(value: unknown): GatewayReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("gateway release manifest must be an object")
  }
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1) throw new Error("gateway release manifest schemaVersion must be 1")
  if (typeof raw.schemaEpoch !== "number" || !Number.isInteger(raw.schemaEpoch) || raw.schemaEpoch <= 0) {
    throw new Error("gateway release manifest schemaEpoch must be a positive integer")
  }
  return {
    schemaVersion: 1,
    productVersion: requiredText(raw.productVersion, "productVersion"),
    gatewayVersion: requiredText(raw.gatewayVersion, "gatewayVersion"),
    desktopMinimumGatewayVersion: requiredText(
      raw.desktopMinimumGatewayVersion,
      "desktopMinimumGatewayVersion",
    ),
    experienceVersion: requiredText(raw.experienceVersion, "experienceVersion"),
    minimumClientExperienceVersion: requiredText(
      raw.minimumClientExperienceVersion,
      "minimumClientExperienceVersion",
    ),
    schemaEpoch: raw.schemaEpoch,
    payloadManifestSha256: sha256Text(raw.payloadManifestSha256, "payloadManifestSha256"),
  }
}

export function parseGatewayPayloadManifest(value: unknown): GatewayPayloadManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("gateway payload manifest must be an object")
  }
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1) throw new Error("gateway payload manifest schemaVersion must be 1")
  if (!Array.isArray(raw.files)) throw new Error("gateway payload manifest files must be an array")
  const seen = new Set<string>()
  const files = raw.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("gateway payload file entry must be an object")
    }
    const file = entry as Record<string, unknown>
    const path = safeRelativePath(file.path)
    if (seen.has(path)) throw new Error(`gateway payload manifest contains duplicate path: ${path}`)
    seen.add(path)
    if (typeof file.size !== "number" || !Number.isInteger(file.size) || file.size < 0) {
      throw new Error(`gateway payload file ${path} has invalid size`)
    }
    return { path, size: file.size, sha256: sha256Text(file.sha256, `files[${path}].sha256`) }
  })
  return { schemaVersion: 1, files }
}

export async function createGatewayPayloadManifest(
  root: string,
  deps: PayloadManifestDeps,
): Promise<{ manifest: GatewayPayloadManifest; digest: string }> {
  void root
  const paths = [...new Set(await deps.walk(""))]
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !CONTROL_FILES.has(path))
    .sort((a, b) => a.localeCompare(b))
  const files: GatewayPayloadFile[] = []
  for (const path of paths) {
    const data = await deps.read(path)
    const { size } = await deps.stat(path)
    files.push({ path, size, sha256: deps.sha256(data) })
  }
  const manifest: GatewayPayloadManifest = { schemaVersion: 1, files }
  const digest = deps.sha256(Buffer.from(JSON.stringify(manifest), "utf8"))
  return { manifest, digest }
}

export async function verifyGatewayPayload(
  root: string,
  manifest: GatewayPayloadManifest,
  deps: VerifyDeps,
): Promise<void> {
  void root
  for (const file of manifest.files) {
    const { size } = await deps.stat(file.path)
    if (size !== file.size) throw new Error(`payload file size mismatch: ${file.path}`)
    const data = await deps.read(file.path)
    if (deps.sha256(data) !== file.sha256) throw new Error(`payload file hash mismatch: ${file.path}`)
  }
}
