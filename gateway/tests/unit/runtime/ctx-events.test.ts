import { createRuntimePluginContext } from '../../../src/runtime/loader';

describe('ctx.events', () => {
  it('make() constructs shape-A envelope with sessionID merged into properties', () => {
    const ctx = createRuntimePluginContext();
    const evt = ctx.events.make('turn.completed', { extra: 1 }, 's1');
    expect(evt).toEqual({
      payload: { type: 'turn.completed', properties: { extra: 1, sessionID: 's1' } },
    });
  });

  it('make() omits sessionID key when absent (key stability)', () => {
    const evt = createRuntimePluginContext().events.make('turn.completed', { projectDir: '/p' });
    expect('sessionID' in evt.payload.properties).toBe(false);
  });

  it('make() still returns the event on unknown type (fail-open) — warn is log-only', () => {
    const evt = createRuntimePluginContext().events.make('my_custom_event');
    expect(evt.payload.type).toBe('my_custom_event');
  });

  it('check() delegates to field contract', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.events.check({ type: 'turn.completed', properties: { sessionID: 's1' } })).toEqual([]);
    expect(ctx.events.check({ type: 'turn.completed', properties: {} }).length).toBeGreaterThan(0);
  });
});
