import type { AutomationActionProvider } from '../../../src/kernel-v2/providers/automation';

/**
 * Test-package automation action. Registered at the package tier by the G2
 * test; no gateway core file changes are involved.
 */
export function createAutomationEchoAction(): AutomationActionProvider {
  return {
    id: 'echo-action',
    handler: async (input) => ({ echoed: input.ruleId }),
  };
}
