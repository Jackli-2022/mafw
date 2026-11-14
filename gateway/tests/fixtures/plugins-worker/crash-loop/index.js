'use strict';

module.exports = {
  name: 'crash-loop',
  async activate() {
    return {
      actions: {
        crash: { handler: async () => { process.exit(1); } },
        echo: { handler: async (input) => input },
      },
    };
  },
};
