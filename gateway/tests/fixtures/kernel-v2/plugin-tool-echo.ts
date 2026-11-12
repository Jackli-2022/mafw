import type { ToolContribution } from '../../../src/kernel-v2/tools';

/**
 * Test-package agent tool. Registered through the kernel-v2 tool registry by
 * the G3 harness; no gateway core file changes are involved.
 */
export function createPluginToolEcho(): ToolContribution {
  return {
    packageName: 'demo',
    name: 'echo',
    title: 'Echo',
    description: 'Echo the input text',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    execute: async (input: any) => ({
      text: `echo:${String(input?.text ?? '')}`,
    }),
  };
}
