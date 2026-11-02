import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * desktop 中立性守卫（spec 2026-11-02 §8 / §11）。
 *
 * 覆盖范围：`src/` 全域（renderer + preload + shared，排除测试/故事文件）。
 * 业务面只能消费 Experience Action Descriptor 与 MAFW View DTO：
 *   - 不读裸 capabilities / runtime 名称
 *   - 不读旧 wire 历史形状（`info ??` / `item.info` / `message.parts ??`）
 *   - `properties.info` 只允许 session 生命周期（Task 14 只翻转了 message 载荷）
 *   - 不 import runtime SDK
 *
 * 例外是**逐文件 + 逐规则**的：Diagnostics（Config 页）可以显示 runtime 名称；
 * session 生命周期读取 `properties.info` 的 3 个文件单独登记。
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

interface Rule {
  name: string
  pattern: RegExp
}

/** 业务组件不得读 runtime 身份/裸能力（Diagnostics/Admin 文件单列豁免）。 */
const BUSINESS_RULES: Rule[] = [
  {
    name: 'runtime-caps',
    pattern: /\bruntimeCaps\b|\brtCaps\b|\bworktreeApi\b|\bdiffApi\b|\bsteerApi\b|\brunStateApi\b|\bcheckpointApi\b|\bsessionBranchApi\b|\bmcpConfigApi\b|\binstructionsApi\b|\bdiscoveryApi\b|\bbackgroundApi\b|\bterminalApi\b/,
  },
  { name: 'runtime-name', pattern: /\bruntimeName\b|\brtName\b|\bactive\.name\b/ },
  // 历史 wire 双形状：只匹配「消息级」回退（tauri 队列的 `item.parts` 是 prompt parts，
  // 不是 wire 历史，故必须限定接收者名）。
  { name: 'history-wire-shape', pattern: /\.info\s*\?\?|\bitem\.info\b|\b(?:m|msg|message|row|entry)\.parts\s*\?\?/ },
  // 事件载荷的 wire 形状：只允许 session 生命周期（见 EVENT_INFO_FILES）。
  { name: 'event-info', pattern: /properties\?*\.info\b/ },
  { name: 'sdk-import', pattern: /@opencode-ai\/sdk/ },
]

/** 去掉注释再匹配：文档里解释被删除的能力位不算违规。 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*$/gm, '')
}

export function scanSource(text: string, rules: Rule[] = BUSINESS_RULES): string[] {
  const code = stripComments(text)
  return rules.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name)
}

/** 反向 fixture 入口（spec §11）。 */
export function scanDesktopFixture(text: string): string[] {
  return scanSource(text)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SOURCE_FILES = walk(SRC).filter((file) => !/\.(test|stories)\.(ts|tsx)$/.test(file))

/** Diagnostics/Admin 白名单（spec §11「逐文件列出」）：Config 页可显示 runtime 名称。 */
const DIAGNOSTICS_FILES = new Set(['src/renderer/mafw/pages/Config.tsx'])
/** session 生命周期仍读 wire `properties.info`（Task 14 只翻转 message 载荷）。 */
const EVENT_INFO_FILES = new Set([
  'src/renderer/mafw/session-events.ts',
  'src/renderer/mafw/sse/dispatcher.ts',
  'src/renderer/mafw/sse/handlers/subagents.ts',
])

function violations(file: string, rules: Rule[] = BUSINESS_RULES): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  return scanSource(text, rules)
    .filter((token) => !(token === 'runtime-name' && DIAGNOSTICS_FILES.has(rel)))
    .filter((token) => !(token === 'event-info' && EVENT_INFO_FILES.has(rel)))
    .map((token) => `${rel}: ${token}`)
}

const BUSINESS_FILES = [
  'src/renderer/mafw/MafwShell.tsx',
  'src/renderer/mafw/components/ChatPane.tsx',
  'src/renderer/mafw/components/CheckpointOverlay.tsx',
  'src/renderer/mafw/components/checkpoint-revert.ts',
  'src/renderer/mafw/components/experience-copy.ts',
  'src/renderer/mafw/components/server-checkpoints.ts',
  'src/renderer/mafw/experience-store.ts',
  'src/renderer/mafw/session-turn-diffs.ts',
  'src/renderer/mafw/components/turn-diffs.ts',
  'src/renderer/mafw/background-capability.ts',
]

/** Diagnostics/Admin 白名单（spec §11）：这些文件可以显示 runtime 名称。 */
const DIAGNOSTIC_RULES: Rule[] = [
  { name: 'runtime-caps', pattern: BUSINESS_RULES[0].pattern },
  { name: 'runtime-name', pattern: BUSINESS_RULES[1].pattern },
]

test('scanner catches synthetic capability, identity and wire reads', () => {
  expect(scanDesktopFixture('const x = props.runtimeCaps.diffApi;')).toContain('runtime-caps')
  expect(scanDesktopFixture('if (runtimeName === "pi") {}')).toContain('runtime-name')
  expect(scanDesktopFixture('const y = item.info ?? item;')).toContain('history-wire-shape')
  expect(scanDesktopFixture('const z = msg.parts ?? [];')).toContain('history-wire-shape')
  expect(scanDesktopFixture('const sid = event.properties.info.sessionID;')).toContain('event-info')
  expect(scanDesktopFixture('import { x } from "@opencode-ai/sdk";')).toContain('sdk-import')
  // Experience / View DTO 面不得误报。
  expect(scanDesktopFixture('const y = experienceStore.supported("branch.fork")')).toEqual([])
  expect(scanDesktopFixture('const m = data.messages.map((row) => row.content)')).toEqual([])
  // 注释里的术语解释不算违规（文档需要说明被删除的形状）。
  expect(scanDesktopFixture('// 旧 properties.info 已迁移\nconst ok = 1;')).toEqual([])
})

test('desktop-wide scan: no business file reads runtime identity/capabilities or wire shapes', () => {
  expect(SOURCE_FILES.length).toBeGreaterThan(150)
  const found = SOURCE_FILES.flatMap((file) => violations(file))
  expect(found).toEqual([])
})

test('exception whitelists stay narrow and pinned', () => {
  // Diagnostics 白名单逐文件：只有 Config 页可以显示 runtime 名称。
  const diagnostics = SOURCE_FILES
    .map((file) => relative(ROOT, file).replace(/\\/g, '/'))
    .filter((file) => scanSource(readFileSync(join(ROOT, file), 'utf8')).includes('runtime-name'))
    .filter((file) => !EVENT_INFO_FILES.has(file))
  expect(new Set(diagnostics)).toEqual(DIAGNOSTICS_FILES)
  // session 生命周期的 info 读取文件集合被钉死（新增必须显式评审）。
  const infoReaders = SOURCE_FILES
    .map((file) => relative(ROOT, file).replace(/\\/g, '/'))
    .filter((file) => scanSource(readFileSync(join(ROOT, file), 'utf8')).includes('event-info'))
  expect(new Set(infoReaders)).toEqual(EVENT_INFO_FILES)
  // 已翻转的 message 消费者不得残留 info 读取。
  for (const file of ['src/renderer/mafw/sse/handlers/chat-stream.ts', 'src/renderer/mafw/sse/chat-reducers.ts']) {
    expect(scanSource(readFileSync(join(ROOT, file), 'utf8'))).not.toContain('event-info')
  }
})

test('business components read Experience, not runtime identity/capabilities', () => {
  const found = BUSINESS_FILES.flatMap((file) => violations(file))
  expect(found).toEqual([])
})

test('Config keeps diagnostics but does not receive the capability prop', () => {
  const config = readFileSync(resolve(ROOT, 'src/renderer/mafw/pages/Config.tsx'), 'utf8')
  // 名称可以显示（Diagnostics 例外），裸能力位不行。
  expect(scanSource(config, [DIAGNOSTIC_RULES[0]])).toEqual([])
  expect(scanSource(config, [DIAGNOSTIC_RULES[1]])).toEqual(['runtime-name'])
  expect(config).not.toContain('runtimeCaps?:')
  // 技能页走 discovery DTO，不再直连 legacy skill namespace。
  expect(config).not.toContain('window.api.mafw.skill.list')
})

test('desktop package declares no runtime SDK dependency', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>> & {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  expect(Object.keys(declared)).not.toContain('@opencode-ai/sdk')
  expect(Object.keys(declared)).toContain('@mafw/sdk')
})

test('chat pane drives checkpoints, branch, diff and run from Experience', () => {
  const chat = readFileSync(resolve(ROOT, 'src/renderer/mafw/components/ChatPane.tsx'), 'utf8')
  expect(chat).toContain('checkpointAction={experienceStore.action("checkpoint.restore")}')
  expect(chat).toContain("experienceStore.enabled('prompt.steer')")
  expect(chat).toContain("experienceStore.action('prompt.steer')?.semantics?.boundary")
  expect(chat).toContain('experienceStore.supported("branch.diff")')
  expect(chat).toContain('experienceStore.supported("run.control")')
  expect(chat).toContain('experienceStore.supported("branch.fork")')
  expect(chat).not.toContain('branchActionsVisible')
})

test('shell no longer forwards runtime props to chat/config', () => {
  const shell = readFileSync(resolve(ROOT, 'src/renderer/mafw/MafwShell.tsx'), 'utf8')
  expect(shell).not.toContain('runtimeCaps={')
  expect(shell).not.toContain('runtimeName={')
  expect(shell).toContain('experienceStore.supported("branch.fork")')
  expect(shell).toContain('sessions.messages(')
})

test('desktop history ingestion accepts flat messages and canonical errors', () => {
  const ingest = readFileSync(resolve(ROOT, 'src/renderer/mafw/ingest/messages.ts'), 'utf8')
  expect(ingest).toContain('canonicalMessageError')
  expect(ingest).toContain('ingestHistoryPage')
  const errors = readFileSync(resolve(ROOT, 'src/renderer/mafw/ingest/errors.ts'), 'utf8')
  expect(errors).toContain('kind')
  expect(errors).toContain('message')
})
