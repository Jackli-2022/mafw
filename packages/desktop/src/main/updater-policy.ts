export type UpdateChannel = "latest" | "beta"
export type UpdateSupport =
  | { enabled: true; channel: UpdateChannel }
  | { enabled: false; reason: "dev" | "not-packaged" | "linux-package" }

export function resolveUpdateSupport(input: {
  packaged: boolean
  channel: "dev" | "beta" | "prod"
  platform: NodeJS.Platform
  appImagePath: string | null
}): UpdateSupport {
  if (input.channel === "dev") return { enabled: false, reason: "dev" }
  if (!input.packaged) return { enabled: false, reason: "not-packaged" }
  if (input.platform === "linux" && !input.appImagePath) {
    return { enabled: false, reason: "linux-package" }
  }
  return { enabled: true, channel: input.channel === "beta" ? "beta" : "latest" }
}
