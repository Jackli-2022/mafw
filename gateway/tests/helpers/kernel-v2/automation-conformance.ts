/**
 * Automation action conformance kit.
 *
 * The factory supplies echo/failing/unhealthy actions; the kit asserts exact
 * resolution, fail-closed missing/unhealthy behavior and handler isolation.
 */

import type { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createAutomationCapability,
  registerAutomationAction,
  type AutomationActionProvider,
} from '../../../src/kernel-v2/providers/automation';

export interface AutomationConformanceFactory {
  create(): {
    registry: CapabilityRegistry<AutomationActionProvider>;
    echo: AutomationActionProvider;
    failing: AutomationActionProvider;
    unhealthy: AutomationActionProvider;
  };
}

export function runAutomationConformance(
  name: string,
  factory: AutomationConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    test('resolves an exact action and returns its value', async () => {
      const fixture = factory.create();
      registerAutomationAction(fixture.registry, fixture.echo);
      await expect(
        createAutomationCapability(fixture.registry).run(fixture.echo.id, { ruleId: 'r1' }),
      ).resolves.toMatchObject({ ok: true });
    });

    test('missing action fails closed', async () => {
      const fixture = factory.create();
      registerAutomationAction(fixture.registry, fixture.echo);
      await expect(
        createAutomationCapability(fixture.registry).run('missing', { ruleId: 'r1' }),
      ).resolves.toMatchObject({ ok: false, error: 'missing' });
    });

    test('throwing handler is isolated', async () => {
      const fixture = factory.create();
      registerAutomationAction(fixture.registry, fixture.failing, 'package');
      await expect(
        createAutomationCapability(fixture.registry).run(fixture.failing.id, { ruleId: 'r1' }),
      ).resolves.toMatchObject({ ok: false, error: 'failed', message: 'boom' });
    });

    test('unhealthy action fails closed', async () => {
      const fixture = factory.create();
      registerAutomationAction(fixture.registry, fixture.unhealthy, 'package');
      await expect(
        createAutomationCapability(fixture.registry).run(fixture.unhealthy.id, {
          ruleId: 'r1',
        }),
      ).resolves.toMatchObject({ ok: false, error: 'failed' });
    });
  });
}
