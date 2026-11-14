'use strict';

module.exports = {
  name: 'cpu-hog',
  async activate() {
    return {
      actions: {
        spin: { handler: async () => { for (;;) { /* intentional */ } } },
        echo: { handler: async (input) => input },
      },
    };
  },
};
