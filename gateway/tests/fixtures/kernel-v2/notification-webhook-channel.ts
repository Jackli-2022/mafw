import type { NotificationChannel } from '../../../src/kernel-v2/providers/notifications';

/**
 * Test-package webhook channel. Registered at the package tier by the G2 test;
 * no gateway core file changes are involved.
 */
export function createNotificationWebhookChannel(): NotificationChannel {
  return {
    id: 'webhook',
    send: async () => {},
  };
}
