#!/usr/bin/env node
// Node 的全局 EventSource（v22.3+ 实验特性）在 24.x 仍未默认启用——
// SDK SSEConnection 依赖它，入口处先垫 polyfill（须先于任何 app import 执行）。
import { EventSource as EventSourcePolyfill } from 'eventsource'
if (typeof (globalThis as any).EventSource === 'undefined') {
  ;(globalThis as any).EventSource = EventSourcePolyfill
}

import { pathToFileURL } from 'node:url'
import { probeGateway } from './probe.ts'

export interface CliArgs {
  retriever: 'bm25' | 'hybrid'
  sessionID?: string
}

/** 解析 mafw tui 命令行参数（--hybrid / --session <id>）。 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { retriever: 'bm25' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hybrid') args.retriever = 'hybrid'
    else if (argv[i] === '--session' && argv[i + 1]) { args.sessionID = argv[i + 1]; i++ }
  }
  return args
}

async function main() {
  const baseUrl = await probeGateway()
  if (!baseUrl) {
    console.error('[mafw tui] gateway 未运行（/health 探测失败）。请先启动：mafw daemon')
    process.exit(1)
  }
  const args = parseArgs(process.argv.slice(2))
  const { runApp } = await import('./ui/app.ts')
  await runApp({ baseUrl, retriever: args.retriever, ...(args.sessionID ? { sessionID: args.sessionID } : {}) })
}

// 仅作为入口执行时启动（测试 import 本模块解析参数不触发网络探测）
const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  main().catch((err) => {
    console.error(`[mafw tui] ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
