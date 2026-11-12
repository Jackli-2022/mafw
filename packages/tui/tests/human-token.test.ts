// E5a-4: TUI reads the same human token file as the desktop main process
// (spec §5.3) and injects it into its gateway client. Failure is not an error:
// human-only actions then surface the gateway's 403 instead of crashing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTuiClient, humanTokenPath, readHumanToken } from '../src/store/human-token.ts'

const TOKEN = '0123456789abcdef'.repeat(4)
const ENV_KEY = 'MAFW_HUMAN_TOKEN_FILE'
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
  delete process.env[ENV_KEY]
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
  delete process.env[ENV_KEY]
  assert.equal(humanTokenPath(), join(homedir(), '.mafw', 'human.token'))
})

test('MAFW_HUMAN_TOKEN_FILE overrides the path (test/dev seam)', () => {
  process.env[ENV_KEY] = join(tempRoot(), 'custom.token')
  assert.equal(humanTokenPath(), process.env[ENV_KEY])
})

// ── createTuiClient: real SDK client + fake transport ──

interface Captured {
  url: string
  init?: RequestInit
}

function fakeFetch(calls: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({ project: { id: 'p1', worktree: '/proj' } }),
    } as unknown as Response
  }) as typeof fetch
}

function headersOf(call: Captured): Headers {
  return new Headers(call.init?.headers)
}

test('createTuiClient sends the human token read from the data-root file', async () => {
  process.env[ENV_KEY] = writeTokenFile(`${TOKEN}\n`)
  const calls: Captured[] = []
  await createTuiClient('http://127.0.0.1:4321', fakeFetch(calls)).project.current()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:4321/api/projects/current')
  assert.equal(headersOf(calls[0]).get('x-mafw-human-token'), TOKEN)
})

test('createTuiClient sends no header when the token is missing or malformed', async () => {
  process.env[ENV_KEY] = join(tempRoot(), 'absent.token')
  const missing: Captured[] = []
  await createTuiClient('http://gw:3000', fakeFetch(missing)).project.current()
  assert.equal(headersOf(missing[0]).get('x-mafw-human-token'), null)

  process.env[ENV_KEY] = writeTokenFile('not-a-token')
  const malformed: Captured[] = []
  await createTuiClient('http://gw:3000', fakeFetch(malformed)).project.current()
  assert.equal(headersOf(malformed[0]).get('x-mafw-human-token'), null)
})
