import { HookManager } from '../../../src/hooks/hook-manager';

describe('All hooks registration', () => {
  test('all event types can be registered and dispatched', async () => {
    const manager = new HookManager({ failBehavior: 'continue', timeout: 5000 });

    const events: string[] = [];

    // Wave 1: Memory internal
    manager.register({ name: 'test-write', event: 'memory.write', handler: async () => { events.push('memory.write'); }, priority: 100 });
    manager.register({ name: 'test-recall', event: 'memory.recall', handler: async () => { events.push('memory.recall'); }, priority: 100 });
    manager.register({ name: 'test-contradiction', event: 'memory.contradiction', handler: async () => { events.push('memory.contradiction'); }, priority: 100 });
    manager.register({ name: 'test-decay', event: 'memory.decay', handler: async () => { events.push('memory.decay'); }, priority: 100 });

    // Wave 2: Platform bridge
    manager.register({ name: 'test-session-start', event: 'session.start', handler: async () => { events.push('session.start'); }, priority: 10 });
    manager.register({ name: 'test-session-end', event: 'session.end', handler: async () => { events.push('session.end'); }, priority: 100 });
    manager.register({ name: 'test-tool-before', event: 'tool.execute.before', handler: async () => { events.push('tool.execute.before'); }, priority: 100 });
    manager.register({ name: 'test-tool-after', event: 'tool.execute.after', handler: async () => { events.push('tool.execute.after'); }, priority: 50 });
    manager.register({ name: 'test-user-prompt', event: 'user.prompt.submit', handler: async () => { events.push('user.prompt.submit'); }, priority: 50 });
    manager.register({ name: 'test-llm-after', event: 'llm.call.after', handler: async () => { events.push('llm.call.after'); }, priority: 50 });
    manager.register({ name: 'test-session-compacting', event: 'session.compacting', handler: async () => { events.push('session.compacting'); }, priority: 100 });

    // Wave 3: Handoff
    manager.register({ name: 'test-handoff', event: 'session.handoff', handler: async () => { events.push('session.handoff'); }, priority: 100 });

    // Dispatch each event and verify it fires
    const allEvents = [
      'memory.write', 'memory.recall', 'memory.contradiction', 'memory.decay',
      'session.start', 'session.end', 'tool.execute.before', 'tool.execute.after',
      'user.prompt.submit', 'llm.call.after', 'session.compacting', 'session.handoff'
    ];

    for (const event of allEvents) {
      await manager.execute(event, {});
    }

    // Verify each event was fired (each registered handler pushes its event name)
    for (const event of allEvents) {
      expect(events).toContain(event);
    }
  });
});
