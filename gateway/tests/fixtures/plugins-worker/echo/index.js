'use strict';

module.exports = {
  name: 'echo',
  async activate() {
    return {
      actions: {
        echo: {
          title: 'Echo',
          handler: async (input) => input,
        },
      },
    };
  },
};
