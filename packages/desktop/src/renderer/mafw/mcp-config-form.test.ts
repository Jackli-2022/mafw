// packages/desktop/src/renderer/mafw/mcp-config-form.test.ts
import { describe, expect, test } from 'bun:test'
import { splitCommandLine, validateMcpServerForm } from './mcp-config-form'

describe('splitCommandLine', () => {
  test('空白分隔 + 双引号 + 单引号', () => {
    expect(splitCommandLine('npx -y  "@scope/pkg" \'a b\'')).toEqual(['npx', '-y', '@scope/pkg', 'a b'])
  })

  test('空串 / 空白 → []', () => {
    expect(splitCommandLine('')).toEqual([])
    expect(splitCommandLine('   ')).toEqual([])
  })
})

describe('validateMcpServerForm', () => {
  test('remote 合法（trim）', () => {
    const r = validateMcpServerForm({ name: '  sentry ', type: 'remote', url: ' https://x.example/mcp ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toEqual({ name: 'sentry', type: 'remote', url: 'https://x.example/mcp' })
  })

  test('local 合法：命令解析为数组', () => {
    const r = validateMcpServerForm({ name: 'fs', type: 'local', command: 'npx -y server-filesystem "C:/My Docs"' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toEqual({ name: 'fs', type: 'local', command: ['npx', '-y', 'server-filesystem', 'C:/My Docs'] })
  })

  test('非法 name / url / 空命令 → errors', () => {
    expect(validateMcpServerForm({ name: '../x', type: 'remote', url: 'https://x' }).ok).toBe(false)
    expect(validateMcpServerForm({ name: 'x', type: 'remote', url: 'ftp://x' }).ok).toBe(false)
    expect(validateMcpServerForm({ name: 'x', type: 'local', command: '   ' }).ok).toBe(false)
  })

  test('overwrite/replace 透传', () => {
    const r = validateMcpServerForm({ name: 'x', type: 'remote', url: 'https://x', overwrite: true, replace: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toMatchObject({ overwrite: true, replace: true })
  })
})
