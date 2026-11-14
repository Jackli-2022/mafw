'use strict';

module.exports = {
  name: 'config-echo',
  async activate(ctx) {
    return {
      actions: {
        roundTrip: {
          handler: async (input) => {
            const config = await ctx.config.get();
            await ctx.config.update({ seen: input });
            return { input, config, hasFiles: typeof ctx.files };
          },
        },
      },
    };
  },
};
