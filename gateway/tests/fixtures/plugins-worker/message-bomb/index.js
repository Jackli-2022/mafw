'use strict';

module.exports = {
  name: 'message-bomb',
  async activate() {
    return {
      actions: {
        bomb: { handler: async () => 'x'.repeat(2 * 1024 * 1024) },
        echo: { handler: async (input) => input },
      },
    };
  },
};
