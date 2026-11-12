import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry';
import {
  createNotificationCapability,
  createPushNotificationChannel,
  registerNotificationChannel,
  type NotificationChannel,
} from '../../../src/kernel-v2/providers/notifications';

const channel = (
  id: string,
  over: Partial<NotificationChannel> = {},
): NotificationChannel => ({ id, send: async () => {}, ...over });

function registry() {
  return new CapabilityRegistry<NotificationChannel>({
    defaultId: 'push',
    capability: 'notifications',
    version: '1.0.0',
    revision: 'test',
    plane: 'gateway',
  });
}

describe('Notification capability adapter', () => {
  test('fans out to every healthy channel', async () => {
    const seen: string[] = [];
    const reg = registry();
    registerNotificationChannel(
      reg,
      channel('push', {
        send: (event) => {
          seen.push(`push:${event.type}`);
        },
      }),
    );
    registerNotificationChannel(
      reg,
      channel('webhook', {
        send: (event) => {
          seen.push(`webhook:${event.type}`);
        },
      }),
      'package',
    );
    const result = await createNotificationCapability(reg).notify({ type: 'goal.updated' });
    expect(seen.sort()).toEqual(['push:goal.updated', 'webhook:goal.updated']);
    expect(result.delivered.sort()).toEqual(['push', 'webhook']);
  });

  test('one channel failure does not block the others and is reported', async () => {
    const seen: string[] = [];
    const reg = registry();
    registerNotificationChannel(
      reg,
      channel('push', {
        send: () => {
          throw new Error('socket down');
        },
      }),
    );
    registerNotificationChannel(
      reg,
      channel('webhook', {
        send: () => {
          seen.push('webhook');
        },
      }),
      'package',
    );
    const result = await createNotificationCapability(reg).notify({ type: 'x' });
    expect(seen).toEqual(['webhook']);
    expect(result.failed).toEqual([{ id: 'push', error: 'socket down' }]);
    expect(result.delivered).toEqual(['webhook']);
  });

  test('unhealthy channels are skipped, not failed', async () => {
    const reg = registry();
    registerNotificationChannel(reg, channel('push', { health: () => 'failed' }));
    registerNotificationChannel(reg, channel('webhook'), 'package');
    const result = await createNotificationCapability(reg).notify({ type: 'x' });
    expect(result.skipped).toEqual(['push']);
    expect(result.failed).toEqual([]);
    expect(result.delivered).toEqual(['webhook']);
  });

  test('no channels returns an empty result and never throws', async () => {
    const reg = registry();
    await expect(createNotificationCapability(reg).notify({ type: 'x' })).resolves.toEqual({
      delivered: [],
      failed: [],
      skipped: [],
    });
  });

  test('push channel adapter forwards the event without mutating it', async () => {
    const seen: unknown[] = [];
    const push = createPushNotificationChannel('mobile', {
      onBroadcast: async (event) => {
        seen.push(event);
      },
    });
    const event = { type: 'goal.updated', goalId: 'g1' };
    await push.send(event);
    expect(seen).toEqual([event]);
    expect(event).toEqual({ type: 'goal.updated', goalId: 'g1' });
  });

  test('channels() lists visible channels and tiers', () => {
    const reg = registry();
    registerNotificationChannel(reg, channel('push'));
    registerNotificationChannel(reg, channel('webhook'), 'package');
    expect(createNotificationCapability(reg).channels()).toEqual([
      { id: 'push', tier: 'builtin' },
      { id: 'webhook', tier: 'package' },
    ]);
  });
});
