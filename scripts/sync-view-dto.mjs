#!/usr/bin/env node
/**
 * View DTO 镜像生成器。
 *
 * 单一事实源：packages/gateway-sdk/src/view-dto.ts
 * 生成镜像：  gateway/src/runtime/view-dto.generated.ts
 *
 * gateway 不跨包 import（tsconfig rootDir=src），因此保留一份逐字镜像；
 * 首部注释替换为 AUTO-GENERATED 标记，正文必须逐字一致
 * （钉扎：gateway/tests/unit/runtime/view-dto-sync.test.ts）。
 *
 * 用法：
 *   node scripts/sync-view-dto.mjs           # 写入镜像
 *   node scripts/sync-view-dto.mjs --check   # 只校验，不写盘（CI / 本地自查）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'packages', 'gateway-sdk', 'src', 'view-dto.ts');
const mirrorPath = join(root, 'gateway', 'src', 'runtime', 'view-dto.generated.ts');

const HEADER = '/** AUTO-GENERATED from packages/gateway-sdk/src/view-dto.ts — run npm run sync:view-dto. */\n';
const SOURCE_HEADER = /^\/\*\*[\s\S]*?\*\/\r?\n/;

/** 剥掉源文件首部注释块（只剥第一个块注释）。 */
function bodyOf(text) {
  return text.replace(/\r\n/g, '\n').replace(SOURCE_HEADER, '');
}

const sourceText = readFileSync(sourcePath, 'utf-8');
const body = bodyOf(sourceText);
if (!body.trim()) {
  console.error(`[sync-view-dto] source is empty after stripping its header: ${sourcePath}`);
  process.exit(1);
}

// 行尾跟随源文件（Windows autocrlf 检出为 CRLF）：镜像与源文件逐字一致，
// 避免镜像生成器把工作区行尾风格改写导致 sync 测试抖动。
const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
const expected = (HEADER + body).replace(/\n/g, eol);

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  let actual = '';
  try {
    actual = readFileSync(mirrorPath, 'utf-8');
  } catch {
    console.error(`[sync-view-dto] mirror missing: ${mirrorPath}`);
    process.exit(1);
  }
  if (actual !== expected) {
    console.error('[sync-view-dto] mirror is stale — run npm run sync:view-dto');
    process.exit(1);
  }
  console.log('[sync-view-dto] mirror is up to date');
  process.exit(0);
}

mkdirSync(dirname(mirrorPath), { recursive: true });
writeFileSync(mirrorPath, expected, 'utf-8');
console.log(`[sync-view-dto] wrote ${mirrorPath}`);
