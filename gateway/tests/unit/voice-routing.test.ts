import { routingForConfig } from '../../src/voice/routing';
import { DEFAULT_VOICE_CONFIG } from '../../src/voice/config';

test('dgpu reports local_accelerated and igpu reports local_cpu', () => {
  expect(routingForConfig({ localTier: 'dgpu' })).toEqual({ status: 'local_accelerated' });
  expect(routingForConfig({ localTier: 'igpu' })).toEqual({ status: 'local_cpu' });
});

test('the default config reports accelerated local routing', () => {
  expect(routingForConfig(DEFAULT_VOICE_CONFIG)).toEqual({ status: 'local_accelerated' });
});

test('v1 routing never claims cloud', () => {
  expect(routingForConfig({ localTier: 'dgpu' }).status).not.toBe('cloud');
  expect(routingForConfig({ localTier: 'igpu' }).status).not.toBe('cloud');
});
