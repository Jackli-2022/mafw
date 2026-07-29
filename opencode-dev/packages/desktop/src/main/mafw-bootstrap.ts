import { startGateway, stopGateway, getGatewayStatus } from "./mafw-sidecar"

export async function startMafwGw(opts: { opencodeServerUrl: string; opencodeServerPassword?: string }): Promise<string | null> {
  await startGateway({ opencodeServerUrl: opts.opencodeServerUrl, opencodeServerPassword: opts.opencodeServerPassword })
  for (let i = 0; i < 30; i++) {
    const status = getGatewayStatus()
    if (status.state === "ready" && status.url) return status.url
    if (status.state === "failed") return null
    await new Promise(r => setTimeout(r, 1000))
  }
  return null
}

export { stopGateway as stopMafwGw }
export { getGatewayStatus as getMafwGwStatus }
