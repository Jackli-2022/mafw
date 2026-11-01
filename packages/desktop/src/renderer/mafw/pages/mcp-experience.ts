import type { ActionDescriptor } from '@mafw/sdk'

type ActionMap = Partial<Record<'mcp.manage' | 'mcp.config.write', ActionDescriptor>>

export function mcpManageEnabled(actions: ActionMap): boolean {
  return actions['mcp.manage']?.enabled === true
}

export function mcpConfigWritable(actions: ActionMap): boolean {
  return actions['mcp.config.write']?.enabled === true
}

export function authCommandFor(actions: ActionMap, name: string): string | undefined {
  const template = actions['mcp.manage']?.semantics?.authCommandTemplate
  return typeof template === 'string' ? template.replaceAll('{name}', name) : undefined
}
