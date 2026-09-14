import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { visibleWidth } from '@earendil-works/pi-tui'
import { isShellCommand, parseShellCommand, runShell, shellResultToLines } from '../src/shell-mode.ts'

chalk.level = 3

test('isShellCommand: only non-empty !-prefixed input', () => {
  assert.equal(isShellCommand('!ls -la'), true)
  assert.equal(isShellCommand('! ls'), true)
  assert.equal(isShellCommand('ls'), false)
  assert.equal(isShellCommand('!'), false)
  assert.equal(isShellCommand('!   '), false)
})

test('parseShellCommand strips bang and trims', () => {
  assert.equal(parseShellCommand('!  git status '), 'git status')
})

test('runShell executes and captures stdout/exitCode', async () => {
  const r = await runShell('node -e "console.log(42)"', { timeoutMs: 15000 })
  assert.equal(r.exitCode, 0)
  assert.ok(r.stdout.includes('42'))
  assert.equal(r.timedOut, false)
})

test('runShell captures non-zero exit and stderr', async () => {
  const r = await runShell('node -e "console.error(\'boom\'); process.exit(3)"', { timeoutMs: 15000 })
  assert.equal(r.exitCode, 3)
  assert.ok(r.stderr.includes('boom'))
})

test('runShell marks timeout via injected exec (killed=true)', async () => {
  const fakeExec = (_cmd: string, _opts: any, cb: any) => {
    cb({ killed: true, signal: 'SIGTERM' }, '', '')
  }
  const r = await runShell('anything', { execFn: fakeExec as any })
  assert.equal(r.timedOut, true)
  assert.equal(r.exitCode, null)
})

test('shellResultToLines renders command, exit code, output; fits width', () => {
  const lines = shellResultToLines({ command: 'echo hi', exitCode: 0, stdout: 'hi', stderr: '', timedOut: false }, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('echo hi'))
  assert.ok(clean.includes('exit 0'))
  assert.ok(clean.includes('hi'))
  for (const l of lines) assert.ok(visibleWidth(l) <= 80)
})

test('shellResultToLines caps long output and notes truncation', () => {
  const big = Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n')
  const lines = shellResultToLines({ command: 'big', exitCode: 0, stdout: big, stderr: '', timedOut: false }, 80)
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(lines.length <= 60, '输出行数有上限')
  assert.ok(clean.includes('…'), '截断提示')
  assert.ok(!clean.includes('line-199'), '尾部被截')
})

test('shellResultToLines renders timeout and stderr distinctly', () => {
  const lines = shellResultToLines({ command: 'slow', exitCode: null, stdout: '', stderr: 'err-out', timedOut: true }, 80)
  const raw = lines.join('\n')
  const clean = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')
  assert.ok(clean.includes('超时'))
  assert.ok(clean.includes('err-out'))
  assert.ok(raw.includes('\x1b[31m'), 'stderr 红色')
})
