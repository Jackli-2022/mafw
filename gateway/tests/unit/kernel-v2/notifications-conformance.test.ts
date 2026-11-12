import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createNotificationCapability,
  registerNotificationChannel,
  type NotificationChannel,
} from '../../../src/kernel-v2/providers/notifications';
import { createNotificationWebhookChannel } from '../../fixtures/kernel-v2/notification-webhook-channel';
import { runNotificationsConformance } from '../../helpers/kernel-v2/notifications-conformance';

const channel = (
  id: string,
  over: Partial<NotificationChannel> = {},
): NotificationChannel => ({ id, send: async () => {}, ...over });

function registry(): CapabilityRegistry<NotificationChannel> {
  return new CapabilityRegistry<NotificationChannel>({
    defaultId: 'push',
    capability: 'notifications',
    version: '1.0.0',
    revision: 'kit',
    plane: 'gateway',
  });
}

runNotificationsConformance('notification channel', {
  create() {
    return {
      registry: registry(),
      push: channel('push'),
      webhook: channel('webhook'),
      failing: channel('failing', {
        send: () => {
          throw new Error('boom');
        },
      }),
      unhealthy: channel('unhealthy', { health: () => 'failed' }),
    };
  },
});

test('test package webhook is additive without core edits', async () => {
  const reg = registry();
  registerNotificationChannel(reg, channel('push'));
  registerNotificationChannel(reg, createNotificationWebhookChannel(), 'package');
  const result = await createNotificationCapability(reg).notify({ type: 'goal.updated' });
  expect(result.delivered).toEqual(['push', 'webhook']);
});
