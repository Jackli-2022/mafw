import { CONTRACT_EVENTS } from '../../../src/runtime/contract-events';
import { checkEventFields } from '../../../src/runtime/event-field-contract';

describe('contract event required fields', () => {
  it('every event with requiredFields produces a field-contract warning when they are absent', () => {
    for (const event of CONTRACT_EVENTS) {
      if (event.requiredFields.length === 0) continue;
      const warnings = checkEventFields({ type: event.type, properties: {} });
      if (warnings.length === 0) throw new Error(`${event.type} lists requiredFields but checkEventFields does not warn`);
      expect(warnings.length).toBeGreaterThan(0);
    }
  });
});
