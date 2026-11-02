import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()

interface Rule {
  name: string
  pattern: RegExp
}

/** 业务组件不得读 runtime 身份/裸能力（Diagnostics/Admin 文件单列豁免）。 */
const BUSINESS_RULES: Rule[] = [
  { name: 'runtime-caps', pattern: /\bruntimeCaps\b|\brtCaps\b|\bworktreeApi\b|\bdiffApi\b|\bsteerApi\b|\brunStateApi\b|\bcheckpointApi\b|\bsessionBranchApi\b/ },
  { name: 'runtime-name', pattern: /\bruntimeName\b|\brtName\b|\bactive\.name\b/ },
]

export function scanSource(text: string, rules: Rule[] = BUSINESS_RULES): string[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name)
}

function violations(file: string, rules: Rule[] = BUSINESS_RULES): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  return scanSource(text, rules).map((token) => `${file}: ${token}`)
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
]

test('scanner catches synthetic capability and runtime-name reads', () => {
  expect(scanSource('const x = props.runtimeCaps.diffApi;')).toContain('runtime-caps')
  expect(scanSource('if (runtimeName === "pi") {}')).toContain('runtime-name')
  expect(scanSource('const y = experienceStore.supported("branch.fork")')).toEqual([])
})

test('business components read Experience, not runtime identity/capabilities', () => {
  const found = BUSINESS_FILES.flatMap((file) => violations(file))
  expect(found).toEqual([])
})

test('Config keeps diagnostics but does not receive the capability prop', () => {
  const config = readFileSync(resolve(ROOT, 'src/renderer/mafw/pages/Config.tsx'), 'utf8')
  expect(scanSource(config, DIAGNOSTIC_RULES)).toEqual([])
  expect(config).not.toContain('runtimeCaps?:')
  // 技能页走 discovery DTO，不再直连 legacy skill namespace。
  expect(config).not.toContain('window.api.mafw.skill.list')
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
