import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 需要 dist 已构建（npm run build -w @mafw/tui）且本机 3000 无 gateway 时才准确。
// MAFW_TUI_SMOKE=1 时启用（默认 skip，避免 CI/本地有运行中 gateway 的误报）。
test('cli exits 1 with hint when gateway is down', { skip: !process.env.MAFW_TUI_SMOKE }, () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js')
  const r = spawnSync(process.execPath, [cli], {
    env: { ...process.env, MAFW_TUI_PORTS: '39998', MAFW_SERVER_API_PORT: '', MAFW_GATEWAY_PORT: '' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /mafw daemon/)
})
