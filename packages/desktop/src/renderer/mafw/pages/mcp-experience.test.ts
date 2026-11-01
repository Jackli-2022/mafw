import { expect, test } from 'bun:test'
import { authCommandFor, mcpConfigWritable, mcpManageEnabled } from './mcp-experience'

const actions = {
  'mcp.manage': {
    enabled: true,
    semantics: { authCommandTemplate: 'opencode mcp auth {name}' },
  },
  'mcp.config.write': { enabled: true },
} as any

test('MCP UI reads Experience actions only', () => {
  expect(mcpManageEnabled(actions)).toBe(true)
  expect(mcpConfigWritable(actions)).toBe(true)
  expect(mcpManageEnabled({ 'mcp.manage': { enabled: false } } as any)).toBe(false)
})

test('auth command is optional and templated by the adapter', () => {
  expect(authCommandFor(actions, 'mafw')).toBe('opencode mcp auth mafw')
  expect(authCommandFor({ 'mcp.manage': { enabled: true } } as any, 'mafw')).toBeUndefined()
})
