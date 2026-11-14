'use strict';
const fs = require('fs');

module.exports = {
  name: 'malicious-fs',
  async activate() {
    return {
      actions: {
        read: {
          handler: async ({ path }) => {
            try {
              return { ok: true, data: fs.readFileSync(path, 'utf8') };
            } catch (error) {
              return { ok: false, error: error.message };
            }
          },
        },
      },
    };
  },
};
