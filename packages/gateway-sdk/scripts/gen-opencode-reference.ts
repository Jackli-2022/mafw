#!/usr/bin/env node
/**
 * 用 opencode 的 OpenAPI 生成 runtime 插件参考产物：
 *
 *   types.gen.ts   openapi-typescript 全量类型（SDK 接口）
 *   events.gen.ts  V2Event 联合 + 事件 type 清单
 *   events.json    机器可读事件清单（type/schema/required/properties）
 *   events.schema.json  自包含 JSON Schema（oneOf + $defs 闭包）
 *   event-map.md   opencode → MAFW canonical 建议表
 *   README.md      来源 / 统计 / 重新生成命令
 *
 * 用法（从仓库根）：
 *   npm run gen:opencode-ref -- --spec <path-or-url> [--source-label <label>] [--out <dir>] [--check]
 *
 * 注意：运行中 serve 的 /openapi.json 可能是旧构建（无 V2Event/contentSchema）；
 * 优先用 opencode 仓库的 packages/protocol/openapi.json。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'
import {
  extractEventReference,
  renderEventMapMd,
  renderEventsJson,
  renderEventsSchemaJson,
  renderEventsTs,
  renderReadme,
  type OpenApiSpecLike,
} from '../src/opencode-reference.ts'
import { FLAT_EVENT_TYPES, RUNTIME_EVENT_TYPES } from '../src/events.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const specSource = arg('spec', process.env.OPENCODE_OPENAPI)
if (!specSource) {
  console.error('Usage: gen-opencode-reference --spec <path-or-url> [--out <dir>] [--check]')
  console.error('       (or set OPENCODE_OPENAPI)')
  process.exit(2)
}
const outDir = path.resolve(arg('out', path.join(here, '..', '..', '..', 'docs', 'reference', 'opencode'))!)
const schemaName = arg('schema', 'V2Event')!
const sourceLabel = arg('source-label')
const check = process.argv.includes('--check')

async function readSpec(source: string): Promise<{ text: string; label: string }> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`cannot fetch ${source}: HTTP ${res.status}`)
    return { text: await res.text(), label: source }
  }
  const abs = path.resolve(process.cwd(), source)
  return { text: await readFile(abs, 'utf8'), label: abs }
}

async function main(): Promise<void> {
  const { text, label } = await readSpec(specSource!)
  let spec: OpenApiSpecLike
  try {
    spec = JSON.parse(text) as OpenApiSpecLike
  } catch (err: any) {
    throw new Error(`${label} is not valid JSON: ${err?.message ?? err}`)
  }

  const ref = extractEventReference(spec, schemaName)
  const meta = {
    // 生成物会 check-in：来源用稳定 label（URL / 仓库路径），不写本机临时路径。
    source: sourceLabel ?? label,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
  }
  const canonical = [...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES]

  const ast = await openapiTS(spec as any)
  const types = astToString(ast)

  const files: Record<string, string> = {
    'types.gen.ts': types,
    'events.gen.ts': renderEventsTs(ref, meta),
    'events.json': renderEventsJson(ref, meta),
    'events.schema.json': renderEventsSchemaJson(spec, ref, meta),
    'event-map.md': renderEventMapMd(ref, canonical, meta),
    'README.md': renderReadme(ref, canonical, meta),
  }

  if (check) {
    const stale: string[] = []
    for (const [name, content] of Object.entries(files)) {
      let existing = ''
      try {
        existing = await readFile(path.join(outDir, name), 'utf8')
      } catch { /* missing = stale */ }
      if (existing !== content) stale.push(name)
    }
    if (stale.length > 0) {
      console.error(`[gen-opencode-ref] stale: ${stale.join(', ')} — run npm run gen:opencode-ref -- --spec ${label}`)
      process.exit(1)
    }
    console.log(`[gen-opencode-ref] up to date (${ref.variants.length} events)`)
    return
  }

  await mkdir(outDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(outDir, name), content, 'utf8')
  }
  console.log(
    `[gen-opencode-ref] ${label} → ${path.relative(process.cwd(), outDir)} ` +
    `(${ref.variants.length} events, ${(meta.bytes / 1024).toFixed(0)} KB spec)`,
  )
}

main().catch((err) => {
  console.error(`[gen-opencode-ref] ${err?.message ?? err}`)
  process.exit(1)
})
