export type GatewayState = 'stopped' | 'starting' | 'ready' | 'failed'

export interface GatewayStatus {
  state: GatewayState
  port: number | null
  url: string | null
  error: string | null
}
