import { eventLayerEnabled } from '../../../src/core/events/event-flags';

describe('event layer flag', () => {
  const saved = process.env.MAFW_EVENT_LAYER;
  afterEach(() => {
    if (saved === undefined) delete process.env.MAFW_EVENT_LAYER;
    else process.env.MAFW_EVENT_LAYER = saved;
  });

  test('defaults on when the flag is absent', () => {
    delete process.env.MAFW_EVENT_LAYER;
    expect(eventLayerEnabled()).toBe(true);
  });

  test('explicit zero disables the layer', () => {
    process.env.MAFW_EVENT_LAYER = '0';
    expect(eventLayerEnabled()).toBe(false);
  });

  test('legacy one and other values stay enabled', () => {
    process.env.MAFW_EVENT_LAYER = '1';
    expect(eventLayerEnabled()).toBe(true);
    process.env.MAFW_EVENT_LAYER = 'true';
    expect(eventLayerEnabled()).toBe(true);
  });
});
