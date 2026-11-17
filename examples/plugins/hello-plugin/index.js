let timer;

module.exports = {
  name: 'hello-plugin',
  async activate(ctx) {
    // Broadcast one tick per second; the cleanup is owned by ctx.effect, so
    // unload / replace / failed check all stop it.
    timer = setInterval(() => {
      ctx.emit({ type: 'plugin:hello-plugin:tick', properties: { at: Date.now() } });
    }, 1000);
    ctx.effect(() => clearInterval(timer));

    return {
      actions: {
        now: {
          title: 'Current time',
          handler: () => ({ now: new Date().toISOString() }),
        },
      },
      events: [
        {
          type: 'plugin:hello-plugin:tick',
          title: 'Tick',
          schema: { type: 'object', properties: { at: { type: 'number' } } },
        },
      ],
    };
  },
};
