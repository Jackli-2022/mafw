export interface GatewayAsset {
  from: string
  to: string
}

export interface GatewayAssetPlanInput {
  repoRoot: string
  gatewayRoot: string
  profile: "desktop" | "global"
}

export const GATEWAY_ASSET_PROFILES: {
  desktop: string[]
  global: string[]
}

export function gatewayAssetPlan(input: GatewayAssetPlanInput): GatewayAsset[]
