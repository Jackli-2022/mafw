module.exports = {
  name: 'hello-plugin',
  async activate(ctx) {
    // Broadcast one tick per second. The timer lives in this activation's
    // closure, so the cleanup below can only ever stop this activation's timer.
    const timer = setInterval(() => {
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
