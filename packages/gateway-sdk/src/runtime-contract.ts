/**
 * Runtime contract JSON DTOs（GET /api/runtime/contract）。
 *
 * 完整 surface/capability 细节以 JSON 产物为准；这里只固定顶层形状，
 * 避免 SDK 与 gateway 的类型双写漂移扩大。
 */
export interface RuntimeContractManifest {
  schemaVersion: number
  contractVersion: string
  generatedFrom: string
  domains: Array<{ id: string; title: string; description: string }>
  surfaces: Array<Record<string, unknown>>
  capabilities: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  cognition: Array<Record<string, unknown>>
  presets: Array<Record<string, unknown>>
}

export interface RuntimeCoverage {
  runtime: string
  contractVersion: string
  static: Record<string, unknown>
  behavioral?: Record<string, unknown>
}

export interface RuntimeContractResponse {
  manifest: RuntimeContractManifest
  coverage: RuntimeCoverage | null
}
