import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()

function violations(file: string, forbidden: string[]): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  return forbidden.filter((token) => text.includes(token)).map((token) => `${file}: ${token}`)
}

test('experience helpers do not branch on runtime identity or raw capabilities', () => {
  const files = [
    'src/renderer/mafw/components/checkpoint-revert.ts',
    'src/renderer/mafw/components/experience-copy.ts',
    'src/renderer/mafw/components/server-checkpoints.ts',
    'src/renderer/mafw/background-capability.ts',
    'src/renderer/mafw/pages/mcp-experience.ts',
  ]
  const found = files.flatMap((file) => violations(file, ['runtimeName', 'active.name', 'runtimeCaps']))
  expect(found).toEqual([])
})

test('steer frontend path reads the Experience store', () => {
  const chat = readFileSync(resolve(ROOT, 'src/renderer/mafw/components/ChatPane.tsx'), 'utf8')
  expect(chat).toContain("experienceStore.isEnabled('prompt.steer')")
  expect(chat).not.toContain('runtimeCaps?.steerApi')
})
