#!/usr/bin/env node
// Node 的全局 EventSource（v22.3+ 实验特性）在 24.x 仍未默认启用——
// SDK SSEConnection 依赖它，入口处先垫 polyfill（须先于任何 app import 执行）。
import { EventSource as EventSourcePolyfill } from 'eventsource'
if (typeof (globalThis as any).EventSource === 'undefined') {
  ;(globalThis as any).EventSource = EventSourcePolyfill
}

import { probeGateway } from './probe.ts'

async function main() {
  const baseUrl = await probeGateway()
  if (!baseUrl) {
    console.error('[mafw tui] gateway 未运行（/health 探测失败）。请先启动：mafw daemon')
    process.exit(1)
  }
  const { runApp } = await import('./ui/app.ts')
  await runApp({ baseUrl, retriever: process.argv.includes('--hybrid') ? 'hybrid' : 'bm25' })
}

main().catch((err) => {
  console.error(`[mafw tui] ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
