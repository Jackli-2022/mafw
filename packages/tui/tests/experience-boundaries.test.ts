// TUI 中立性守卫（spec 2026-11-02 §8 / §11）。
//
// TUI 与 desktop 同一套消费契约：Experience Action Descriptor + MAFW View DTO。
// 全域扫描 `src/`：不得读裸 capabilities / runtime 名称、不得读旧 wire 形状、
// 不得 import runtime SDK、不得回退 `session.history`（唯一历史出口是 messages）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// 共享注释剥离状态机（review C1：正则把 `// ... /*` 当块注释开头，整段失明）
import { stripCommentsText, longBlankRuns, stripComments as stripCommentsState } from '../../../packages/test-shim/comment-strip.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '..', 'src')
const PACKAGE_JSON = join(HERE, '..', 'package.json')

interface Rule {
  name: string
  pattern: RegExp
}

const RULES: Rule[] = [
  {
    name: 'runtime-caps',
    pattern: /\bruntimeCaps\b|\brtCaps\b|\bworktreeApi\b|\bdiffApi\b|\bsteerApi\b|\brunStateApi\b|\bcheckpointApi\b|\bsessionBranchApi\b|\bmcpConfigApi\b|\binstructionsApi\b|\bdiscoveryApi\b/,
  },
  { name: 'runtime-name', pattern: /\bruntimeName\b|\brtName\b|\bactive\.name\b/ },
  // 旧 wire 历史/事件形状：`item.info ?? item`、`msg.parts ?? []`、`properties.info`。
  { name: 'wire-shape', pattern: /\.info\s*\?\?|\bitem\.info\b|\b(?:m|msg|message|row|entry)\.parts\s*\?\?|properties\?*\.info\b/ },
  { name: 'sdk-import', pattern: /@opencode-ai\/sdk/ },
]

function stripComments(text: string): string {
  // 共享状态机（review C1）：正则版会把 `// ... /*` 当块注释开头整段吞掉。
  return stripCommentsText(text)
}

export function scanTuiSource(text: string, rules: Rule[] = RULES): string[] {
  const code = stripComments(text)
  return rules.filter((rule) => rule.pattern.test(code)).map((rule) => rule.name)
}

/** 反向 fixture 入口（spec §11）。 */
export function scanTuiFixture(text: string): string[] {
  return scanTuiSource(text)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const SOURCE_FILES = walk(SRC)

test('scanner catches synthetic capability/identity/wire reads (reverse fixtures)', () => {
  assert.deepEqual(scanTuiFixture('const caps = props.runtimeCaps;'), ['runtime-caps'])
  assert.deepEqual(scanTuiFixture('if (runtimeName === "pi") {}'), ['runtime-name'])
  assert.deepEqual(scanTuiFixture('item.info ?? item'), ['wire-shape'])
  assert.deepEqual(scanTuiFixture('const parts = msg.parts ?? [];'), ['wire-shape'])
  assert.deepEqual(scanTuiFixture('import { x } from "@opencode-ai/sdk";'), ['sdk-import'])
  // Experience / View DTO 面不误报；注释里的旧术语不误报。
  assert.deepEqual(scanTuiFixture('const ok = experience.supported("branch.fork")'), [])
  assert.deepEqual(scanTuiFixture('// 不再读 capabilities\nconst ok = 1;'), [])
})

test('scanner is a state machine, not a regex (C1 reverse fixture)', () => {
  // `/*` 出现在 `//` 行尾注释里时，旧正则吞到下一个 `*/`，中间的能力位读取失明。
  assert.deepEqual(scanTuiFixture([
    '// 说明里提到 /* 这个写法',
    'const caps = props.runtimeCaps;',
    '*/',
    'if (runtimeName === "pi") {}',
  ].join('\n')), ['runtime-caps', 'runtime-name'])
  assert.deepEqual(scanTuiFixture("const u = 'http://x/*y'; const c = props.runtimeCaps;"), ['runtime-caps'])
})

test('comment stripping preserves line count and never blanks a long run of real source', () => {
  const mismatched: string[] = []
  const runaway: string[] = []
  for (const file of SOURCE_FILES) {
    const rel = relative(SRC, file).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8')
    const stripped = stripCommentsState(source)
    if (stripped.code.split('\n').length !== source.split('\n').length) mismatched.push(rel)
    for (const run of longBlankRuns(source, stripped)) runaway.push(`${rel}: ${run.start}-${run.end} (${run.count})`)
  }
  assert.deepEqual(mismatched, [])
  assert.deepEqual(runaway, [])
})


test('tui-wide scan: no runtime identity, raw capabilities or wire shapes', () => {
  assert.ok(SOURCE_FILES.length > 20, 'expected TUI source files')
  const found: string[] = []
  for (const file of SOURCE_FILES) {
    const rel = relative(SRC, file).replace(/\\/g, '/')
    const text = readFileSync(file, 'utf8')
    for (const rule of scanTuiSource(text)) found.push(`${rel}: ${rule}`)
  }
  assert.deepEqual(found, [])
})

test('tui declares no runtime SDK dependency', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as Record<string, Record<string, string>>
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  assert.ok(!('@opencode-ai/sdk' in declared))
  assert.ok('@mafw/sdk' in declared)
})

test('history consumers use session.messages (no session.history fallback)', () => {
  for (const rel of ['store/chat-store.ts', 'ui/goals-tab.ts']) {
    const text = readFileSync(join(SRC, rel), 'utf8')
    assert.ok(!/session\.history/.test(text), `${rel} still calls session.history`)
    assert.ok(/session\.messages/.test(text), `${rel} must read session.messages`)
  }
})

test('capability-driven commands gate on Experience, not capability flags', () => {
  const store = readFileSync(join(SRC, 'store/experience-store.ts'), 'utf8')
  assert.ok(/supported\(/.test(store))
  assert.ok(/enabled\(/.test(store))
  const slash = readFileSync(join(SRC, 'ui/slash-commands.ts'), 'utf8')
  assert.ok(/COMMAND_EXPERIENCE_ACTIONS/.test(slash))
  // 破坏性/能力相关命令必须映射到 Experience action id（新增命令要显式登记）。
  for (const action of ['branch.fork', 'session.summarize', 'branch.revert', 'branch.unrevert', 'approval.permission']) {
    assert.ok(slash.includes(action), `slash commands must gate ${action} through Experience`)
  }
})
