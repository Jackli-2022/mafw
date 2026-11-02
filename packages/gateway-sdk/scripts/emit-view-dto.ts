/**
 * View DTO 契约发射器 —— `packages/gateway-sdk/contract/view-dto.json` 的唯一写入入口。
 *
 * 数据源：`src/view-dto.ts` 的 `VIEW_DTO_FIELD_INVENTORY`（字段与接口的对应关系
 * 由 `src/view-dto.pin.ts` 在编译期钉扎）。禁止手改生成的 JSON。
 *
 * 运行：
 *   npm run emit:view-dto -w @mafw/sdk      # 写入
 *   npm run emit:view-dto -w @mafw/sdk -- --check   # 只校验（CI 用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { viewDtoContract } from '../src/view-dto'

const target = join(dirname(__dirname), 'contract', 'view-dto.json')
const expected = JSON.stringify(viewDtoContract(), null, 2) + '\n'

if (process.argv.includes('--check')) {
  let actual = ''
  try {
    actual = readFileSync(target, 'utf-8')
  } catch {
    console.error(`[emit:view-dto] contract missing: ${target}`)
    process.exit(1)
  }
  if (actual !== expected) {
    console.error('[emit:view-dto] contract is stale — run npm run emit:view-dto -w @mafw/sdk')
    process.exit(1)
  }
  console.log('[emit:view-dto] contract is up to date')
  process.exit(0)
}

writeFileSync(target, expected, 'utf-8')
console.log(`[emit:view-dto] wrote ${target}`)
