#!/usr/bin/env node
import { probeGateway } from './probe.js'

async function main() {
  const baseUrl = await probeGateway()
  if (!baseUrl) {
    console.error('[mafw tui] gateway 未运行（/health 探测失败）。请先启动：mafw daemon')
    process.exit(1)
  }
  const { runApp } = await import('./ui/app.js')
  await runApp({ baseUrl, retriever: process.argv.includes('--hybrid') ? 'hybrid' : 'bm25' })
}

main().catch((err) => {
  console.error(`[mafw tui] ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
