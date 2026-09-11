/** 探测 gateway /health，按候选顺序返回第一个可用 baseUrl；全失败返回 null。 */
export async function probeGateway(
  fetchFn: typeof fetch = fetch,
  candidates: string[] = defaultCandidates(),
  timeoutMs = 2000,
): Promise<string | null> {
  for (const base of candidates) {
    try {
      const res = await fetchFn(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return base
    } catch {
      /* try next */
    }
  }
  return null
}

export function defaultCandidates(): string[] {
  const override = process.env.MAFW_TUI_PORTS
  if (override) return override.split(',').map((p) => `http://localhost:${p.trim()}`).filter(Boolean)
  const port = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT
  const urls: string[] = []
  if (port) urls.push(`http://localhost:${port}`)
  urls.push('http://localhost:3000')
  return [...new Set(urls)]
}
