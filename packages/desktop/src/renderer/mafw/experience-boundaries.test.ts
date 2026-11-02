import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()

function scanSource(text: string, forbidden: string[]): string[] {
  return forbidden.filter((token) => text.includes(token))
}

function violations(file: string, forbidden: string[]): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  return scanSource(text, forbidden).map((token) => `${file}: ${token}`)
}

test('scanner catches a synthetic runtime-name branch', () => {
  expect(scanSource("if (runtimeName === 'pi') {}", ['runtimeName'])).toEqual(['runtimeName'])
})

test('experience helpers and checkpoint surface do not branch on runtime identity', () => {
  const files = [
    'src/renderer/mafw/components/checkpoint-revert.ts',
    'src/renderer/mafw/components/experience-copy.ts',
    'src/renderer/mafw/components/server-checkpoints.ts',
    'src/renderer/mafw/components/CheckpointOverlay.tsx',
    'src/renderer/mafw/background-capability.ts',
    'src/renderer/mafw/pages/mcp-experience.ts',
  ]
  const found = files.flatMap((file) => violations(file, ['runtimeName', 'active.name', 'runtimeCaps', 'props.caps']))
  expect(found).toEqual([])
})

test('checkpoint path in ChatPane no longer reads raw checkpoint/diff capabilities', () => {
  const chat = readFileSync(resolve(ROOT, 'src/renderer/mafw/components/ChatPane.tsx'), 'utf8')
  expect(chat).toContain('checkpointAction={experienceStore.action("checkpoint.restore")}')
  expect(chat).not.toContain('runtimeCaps?.checkpointApi')
  expect(chat).not.toContain('runtimeCaps?.sessionBranchApi')
  expect(chat).not.toContain('runtimeCaps?.revertUndoApi')
})

test('steer frontend path reads the Experience store and boundary', () => {
  const chat = readFileSync(resolve(ROOT, 'src/renderer/mafw/components/ChatPane.tsx'), 'utf8')
  expect(chat).toContain("experienceStore.isEnabled('prompt.steer')")
  expect(chat).toContain("experienceStore.action('prompt.steer')?.semantics?.boundary")
  expect(chat).not.toContain('runtimeCaps?.steerApi')
})
