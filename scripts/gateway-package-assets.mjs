import path from "node:path"

export const GATEWAY_ASSET_PROFILES = {
  desktop: ["dist", "voice_sidecars", "skills", "scripts"],
  global: ["dist", "bin", "voice_sidecars", "skills", "scripts"],
}

/**
 * Runtime assets that are not npm dependencies. Desktop targets are relative to
 * the staged gateway bundle; global targets are relative to the npm package root.
 */
export function gatewayAssetPlan(input) {
  const repoRoot = path.resolve(input.repoRoot)
  const gatewayRoot = path.resolve(input.gatewayRoot)
  const assets = [
    { from: path.join(gatewayRoot, "dist"), to: "dist" },
    { from: path.join(gatewayRoot, "voice_sidecars"), to: "voice_sidecars" },
    { from: path.join(repoRoot, "skills"), to: "skills" },
    { from: path.join(gatewayRoot, "scripts", "setup-pykernel.mjs"), to: "scripts/setup-pykernel.mjs" },
    { from: path.join(gatewayRoot, "scripts", "office"), to: "scripts/office" },
  ]

  if (input.profile === "global") {
    return [
      { from: path.join(gatewayRoot, "dist"), to: "gateway/dist" },
      { from: path.join(repoRoot, "bin", "mafw.js"), to: "bin/mafw.js" },
      { from: path.join(gatewayRoot, "voice_sidecars"), to: "gateway/voice_sidecars" },
      { from: path.join(repoRoot, "skills"), to: "skills" },
      { from: path.join(gatewayRoot, "scripts", "setup-pykernel.mjs"), to: "gateway/scripts/setup-pykernel.mjs" },
      { from: path.join(gatewayRoot, "scripts", "office"), to: "gateway/scripts/office" },
    ]
  }

  return assets
}
