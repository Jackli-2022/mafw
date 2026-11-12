/**
 * Notification channel conformance kit.
 *
 * The factory supplies the standard channel set; the kit asserts fan-out,
 * failure isolation, unhealthy skipping and the empty case.
 */

import type { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createNotificationCapability,
  registerNotificationChannel,
  type NotificationChannel,
} from '../../../src/kernel-v2/providers/notifications';

export interface NotificationsConformanceFactory {
  create(): {
    registry: CapabilityRegistry<NotificationChannel>;
    push: NotificationChannel;
    webhook: NotificationChannel;
    failing: NotificationChannel;
    unhealthy: NotificationChannel;
  };
}

export function runNotificationsConformance(
  name: string,
  factory: NotificationsConformanceFactory,
): void {
  describe(`${name} conformance`, () => {
    test('fans out, isolates failures and skips unhealthy channels', async () => {
      const fixture = factory.create();
      registerNotificationChannel(fixture.registry, fixture.push);
      registerNotificationChannel(fixture.registry, fixture.webhook, 'package');
      registerNotificationChannel(fixture.registry, fixture.failing, 'package');
      registerNotificationChannel(fixture.registry, fixture.unhealthy, 'package');

      const result = await createNotificationCapability(fixture.registry).notify({
        type: 'goal.updated',
      });
      expect(result.delivered).toEqual(['push', 'webhook']);
      expect(result.failed).toEqual([{ id: 'failing', error: 'boom' }]);
      expect(result.skipped).toEqual(['unhealthy']);
    });

    test('an empty channel set is a no-op, not an error', async () => {
      const fixture = factory.create();
      await expect(
        createNotificationCapability(fixture.registry).notify({ type: 'x' }),
      ).resolves.toEqual({ delivered: [], failed: [], skipped: [] });
    });
  });
}
