module.exports = {
  name: 'kitchen-sink',
  async activate(ctx) {
    // Observer state is plain activation-local state: it dies with this
    // revision, so nothing has to be registered through ctx.effect.
    let auditCount = 0;

    // (5) http — served at /api/plugins/kitchen-sink/api/ping. Routes can only
    // be registered while activate() runs; they are retired with this revision.
    ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));

    return {
      // (1) actions — invoked from the UI (or the desktop panel below).
      actions: {
        echo: {
          title: 'Echo the input',
          handler: (input) => {
            // Declared event types are the only ones ctx.emit accepts. Emitting
            // here shows the action -> event direction without a timer.
            ctx.emit({ type: 'plugin:kitchen-sink:ping', properties: { at: Date.now() } });
            // `audited` is the observer's count; the observer never mutates the
            // event, it only observes and reports through package-local state.
            return { echo: input ?? null, audited: auditCount };
          },
        },
      },

      // (2) events — must live in this package's namespace and be declared.
      events: [
        {
          type: 'plugin:kitchen-sink:ping',
          title: 'Ping',
          schema: { type: 'object', properties: { at: { type: 'number' } } },
        },
      ],

      // (3) tools — agent-side tools; the host prefixes the name with
      // `plugin:kitchen-sink:` so it can never collide with gateway tools.
      tools: [
        {
          name: 'lookup',
          description: 'Return a fixed value: the reference shape of an agent tool.',
          inputSchema: { type: 'object' },
          handler: () => ({ value: 'lookup-ok' }),
        },
      ],

      // (4) observers — read-only consumers of already-emitted events. The
      // filter bounds what this observer receives; the handler never mutates it.
      observers: [
        {
          id: 'audit',
          title: 'Audit counter',
          description: 'Counts ping events; never mutates them.',
          filter: { types: ['plugin:kitchen-sink:ping'] },
          onEvent: () => {
            auditCount += 1;
          },
        },
      ],

      // Desktop panel: `viewAction` must reference an action of this package.
      ui: {
        panels: [{ id: 'sink', title: 'Kitchen sink', viewAction: 'echo' }],
      },
    };
  },
};
