// E5a-4: TUI reads the same human token file as the desktop main process
// (spec §5.3). Failure is not an error: human-only actions then surface the
// gateway's 403 instead of crashing the TUI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { humanTokenPath, readHumanToken } from '../src/store/human-token.ts'

const TOKEN = '0123456789abcdef'.repeat(4)
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mafw-tui-human-token-'))
  roots.push(root)
  return root
}

function writeTokenFile(content: string): string {
  const file = join(tempRoot(), 'human.token')
  writeFileSync(file, content, 'utf-8')
  return file
}

test.afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

test('readHumanToken reads and trims a well-formed token', () => {
  assert.equal(readHumanToken(writeTokenFile(`${TOKEN}\n`)), TOKEN)
  assert.equal(readHumanToken(writeTokenFile(` ${TOKEN}\r\n`)), TOKEN)
})

test('readHumanToken returns empty for a missing file', () => {
  assert.equal(readHumanToken(join(tempRoot(), 'absent.token')), '')
})

test('readHumanToken returns empty for an unreadable path', () => {
  const dir = tempRoot()
  mkdirSync(join(dir, 'human.token'))
  assert.equal(readHumanToken(join(dir, 'human.token')), '')
})

test('readHumanToken rejects malformed tokens', () => {
  for (const bad of ['', 'short', TOKEN.slice(0, 63), `${TOKEN}0`, TOKEN.toUpperCase(), 'z'.repeat(64)]) {
    assert.equal(readHumanToken(writeTokenFile(bad)), '')
  }
})

test('humanTokenPath points at the fixed data root file', () => {
  assert.equal(humanTokenPath(), join(homedir(), '.mafw', 'human.token'))
})
